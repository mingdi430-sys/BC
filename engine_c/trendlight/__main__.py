"""CLI: python -m trendlight <step> [옵션]

steps: probe | youtube | bigkinds | burst | collect | lifecycle | report | all
"""
from __future__ import annotations

import argparse
import json
import logging
import sys

from . import logging_setup

log = logging.getLogger("trendlight")


def _client(synthetic: bool):
    if synthetic:
        from .datalab.synthetic import SyntheticDatalabClient
        return SyntheticDatalabClient()
    from .datalab.client import DatalabClient, MissingCredentials
    try:
        return DatalabClient.from_env()
    except MissingCredentials as e:
        log.error("%s  (--synthetic 으로 배관만 확인 가능)", e)
        sys.exit(2)


def cmd_probe(a):
    """앵커 후보 1회 호출 → 소수 자릿수·앵커 채택 로그."""
    from .datalab.client import PRECISION_FILE
    from .datalab.collect import Collector, probe_anchor
    c = Collector(_client(a.synthetic))
    anchor = probe_anchor(c.client, c.start, c.end)
    print(f"채택 앵커: {anchor}")
    pf = PRECISION_FILE
    if a.synthetic:
        from .datalab.synthetic import PRECISION_FILE_SYNTHETIC as pf
    if pf.exists():
        print("정밀도:", pf.read_text(encoding="utf-8"))


def cmd_youtube(a):
    from .candidates.youtube import YouTubeCollector
    df = YouTubeCollector().run(weeks_back=a.weeks, max_calls=a.max_calls)
    print(df.head(20).to_string() if len(df) else "(빈 테이블)")


def cmd_plan(a):
    """남은 YouTube 작업량과 키 수별 소요일."""
    from .candidates.youtube import load_keys, plan_summary
    n = len(load_keys())
    print(f"등록된 YouTube 키: {n}개 (YOUTUBE_API_KEYS 쉼표 구분)")
    print(f"{'weeks':>6} {'tasks':>6} {'남음':>6} | " + " ".join(f"키{k}:{'일':>3}" for k in (1, 2, 3, 4)))
    for w in (26, 40, 52, 78, 104):
        row = [plan_summary(w, k) for k in (1, 2, 3, 4)]
        print(f"{w:>6} {row[0]['tasks']:>6} {row[0]['remaining']:>6} | " + " ".join(f"{r['days']:>7}" for r in row))


def cmd_bigkinds(a):
    from .candidates import bigkinds
    df = bigkinds.run()
    print(df.head(20).to_string() if len(df) else "(빈 테이블 — 스텁)")


def cmd_burst(a):
    from .candidates import burst
    df = burst.run(top=a.top)
    print(df.head(30).to_string() if len(df) else "(후보 없음)")


def cmd_collect(a):
    from .datalab.collect import Collector, build_keyword_specs, build_segments
    specs = build_keyword_specs(include_candidates=not a.labels_only, variants=a.variants)
    segs = build_segments()
    if a.segments == "all-only":
        segs = segs[:1]
    log.info("키워드 %d개 × 세그먼트 %d개 → 요청 약 %d회", len(specs), len(segs), (len(specs) // 4 + 1) * len(segs))
    df = Collector(_client(a.synthetic)).run(specs, segs)
    if len(df):
        print(df.head(10).to_string())
        print(df.groupby(["gender", "age"]).size())


def cmd_collect_daily(a):
    from .datalab.collect import collect_daily_labels
    df = collect_daily_labels(_client(a.synthetic))
    print(df.groupby("keyword").agg(n=("date", "size"), max_norm=("value_norm", "max")))


def cmd_lifecycle(a):
    import pandas as pd
    from .common.paths import CURVES_PARQUET, PROCESSED
    from .datalab.collect import CURVES_DAILY_PARQUET
    from .lifecycle.halflife import evaluate, diagnosis
    from .lifecycle.stage import rolling_stages
    curves = pd.read_parquet(CURVES_PARQUET)
    daily = pd.read_parquet(CURVES_DAILY_PARQUET) if CURVES_DAILY_PARQUET.exists() else None
    table, maes = evaluate(curves, daily=daily)
    print(table.to_string()); print("MAE:", maes); print("\n".join(diagnosis(table, maes)))
    base = curves[(curves.gender == "all") & (curves.age == "all")]
    parts = []
    for kw, g in base.groupby("keyword"):
        st = rolling_stages(g); st["keyword"] = kw; parts.append(st)
    stages = pd.concat(parts, ignore_index=True)
    stages.to_parquet(PROCESSED / "stages.parquet", index=False)
    print(stages.groupby("stage").size())


def cmd_forecast(a):
    """TimesFM: 전 키워드 26주 예측 + 라벨 백테스트."""
    import pandas as pd
    from .common.paths import CURVES_PARQUET
    from .lifecycle.forecast import backtest_all, forecast_all, per_keyword_metrics
    curves = pd.read_parquet(CURVES_PARQUET)
    fc = forecast_all(curves)
    print(fc.groupby("keyword").first()[["p_keep", "median_ratio", "signal"]].round(3).to_string())
    if not a.no_backtest:
        bt, m = backtest_all(curves)
        print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in m.items()})
        print(per_keyword_metrics(bt).to_string(index=False))


def cmd_report(a):
    from .eval.report import build_report, REPORT
    build_report()
    print(f"리포트: {REPORT}")


def cmd_all(a):
    cmd_youtube(a); cmd_bigkinds(a); cmd_burst(a); cmd_collect(a); cmd_lifecycle(a)
    a.no_backtest = False; cmd_forecast(a); cmd_report(a)


def main(argv=None):
    p = argparse.ArgumentParser(prog="trendlight")
    p.add_argument("--synthetic", action="store_true", help="데이터랩 대신 합성 클라이언트 (키 없이 배관 확인)")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("probe").set_defaults(fn=cmd_probe)
    y = sub.add_parser("youtube"); y.add_argument("--weeks", type=int, default=52); y.add_argument("--max-calls", type=int)
    y.set_defaults(fn=cmd_youtube)
    sub.add_parser("plan", help="YouTube 남은 작업량·키 수별 소요일").set_defaults(fn=cmd_plan)
    sub.add_parser("bigkinds").set_defaults(fn=cmd_bigkinds)
    b = sub.add_parser("burst"); b.add_argument("--top", type=int, default=20); b.set_defaults(fn=cmd_burst)
    c = sub.add_parser("collect"); c.add_argument("--labels-only", action="store_true")
    c.add_argument("--variants", action="store_true", help="접미어 변형까지 수집(호출 수 증가)")
    c.add_argument("--segments", choices=["all", "all-only"], default="all"); c.set_defaults(fn=cmd_collect)
    sub.add_parser("collect-daily", help="반감기 라벨 4개 일간 곡선 (1회 호출)").set_defaults(fn=cmd_collect_daily)
    sub.add_parser("lifecycle").set_defaults(fn=cmd_lifecycle)
    f = sub.add_parser("forecast", help="TimesFM 26주 예측 + 백테스트"); f.add_argument("--no-backtest", action="store_true"); f.set_defaults(fn=cmd_forecast)
    sub.add_parser("report").set_defaults(fn=cmd_report)
    al = sub.add_parser("all"); al.add_argument("--weeks", type=int, default=52); al.add_argument("--max-calls", type=int)
    al.add_argument("--top", type=int, default=20); al.add_argument("--labels-only", action="store_true")
    al.add_argument("--variants", action="store_true"); al.add_argument("--segments", default="all"); al.set_defaults(fn=cmd_all)
    a = p.parse_args(argv)
    logging_setup.setup(logging.DEBUG if a.verbose else logging.INFO)
    a.fn(a)


if __name__ == "__main__":
    main()
