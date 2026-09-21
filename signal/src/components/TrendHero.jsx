import React, { useEffect, useMemo, useRef, useState } from "react";
import { getTrend, trendMeta, trendWeeks, STAGE_LABEL, SIGNAL_COLOR } from "../trend";

const ITEM = "두쫀쿠";
const CHIPS = ["두바이 초콜릿", "디진다돈까스", "탕후루", "버터떡"];
const CHIP_LABEL = {};  // 칩 이름은 실제 데이터 이름 그대로 (다른 아이템 곡선에 다른 이름을 붙이지 않는다)
const RISK = { green: "유행 리스크 낮음", amber: "유행 리스크 중간", red: "유행 리스크 높음" };
const STAGE_TONE = { emerging: "#1E9C58", surging: "#D99A06", peak: "#D4413A", declining: "#D4413A", stable: "#5b6b84" };
const sigOf = (p) => (p >= trendMeta.green_min ? "green" : p < trendMeta.red_max ? "red" : "amber");
const pText = (p) =>
  p >= trendMeta.green_min ? "수요가 남을 가능성 높음" : p < trendMeta.red_max ? "수요가 줄어들 가능성 높음" : "수요가 불확실";

const CH = { W: 760, H: 404, l: 40, r: 16, t: 34, b: 58 };

function useReducedMotion() {
  const [reduce, setReduce] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return undefined;
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

// target 값으로 부드럽게 따라가는 숫자. reduce면 즉시 target.
function useTween(target, { ms = 900, initial = target, reduce = false, delay = 0 } = {}) {
  const [v, setV] = useState(reduce ? target : initial);
  const cur = useRef(reduce ? target : initial);
  useEffect(() => {
    if (reduce) {
      cur.current = target;
      setV(target);
      return undefined;
    }
    const from = cur.current;
    let raf;
    let timer;
    const run = () => {
      const t0 = performance.now();
      const step = () => {
        const p = Math.min(1, Math.max(0, (performance.now() - t0) / ms));
        const e = 1 - Math.pow(1 - p, 3);
        cur.current = from + (target - from) * e;
        setV(cur.current);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    if (delay) timer = setTimeout(run, delay);
    else run();
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, ms, reduce, delay]);
  return v;
}

const utcDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

function useTrendData() {
  return useMemo(() => {
    const t = getTrend(ITEM);
    if (!t || !t.history?.length) return null;
    const all = t.all;
    const first = all.findIndex((v) => v != null);
    let last = all.length - 1;
    while (last > 0 && all[last] == null) last--;
    const snaps = t.history
      .map((h) => ({ ...h, wi: trendWeeks.indexOf(h.week) }))
      .filter((h) => h.wi >= 0);
    const a = Math.max(0, first - 1);
    const b = last + 26;
    let max = 0;
    all.forEach((v) => v != null && v > max && (max = v));
    snaps.forEach((s) => s.q90.forEach((v) => v > max && (max = v)));
    const baseLast = trendWeeks.length - 1;
    const dateAt = (i) => {
      if (i <= baseLast) return trendWeeks[i];
      const d = utcDate(trendWeeks[baseLast]);
      d.setUTCDate(d.getUTCDate() + 7 * (i - baseLast));
      return d.toISOString().slice(0, 10);
    };
    const ticks = [];
    for (let i = a; i <= b; i++) {
      const d = dateAt(i);
      const mo = Number(d.slice(5, 7));
      if ([1, 4, 7, 10].includes(mo) && Number(d.slice(8, 10)) <= 7) ticks.push({ i, label: `${d.slice(2, 4)}.${d.slice(5, 7)}` });
    }
    return { t, all, first, last, snaps, a, b, max: max * 1.1, dateAt, ticks, peakIdx: trendWeeks.indexOf(t.peak_week) };
  }, []);
}

function Chart({ data, si, reduce, onPick }) {
  const { W, H, l, r, t, b } = CH;
  const snap = data.snaps[si];
  const reveal = useTween(snap.wi, { ms: 1100, initial: data.snaps[0].wi, reduce });
  const x = (i) => l + ((i - data.a) / (data.b - data.a)) * (W - l - r);
  const y = (v) => t + (1 - v / data.max) * (H - t - b);
  const plotBottom = H - b;
  const sig = snap.signal || sigOf(snap.p_keep);
  const col = SIGNAL_COLOR[sig];

  const actual = useMemo(() => {
    let d = "";
    for (let i = data.first; i <= data.last; i++) {
      const v = data.all[i];
      if (v == null) continue;
      d += `${d ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const area = `${actual}L${x(data.last).toFixed(1)} ${plotBottom} L${x(data.first).toFixed(1)} ${plotBottom} Z`;

  const fan = useMemo(() => {
    const base = data.all[snap.wi];
    const xs0 = x(snap.wi);
    const pts = (arr) => arr.map((v, k) => `${x(snap.wi + 1 + k).toFixed(1)} ${y(v).toFixed(1)}`);
    const up = pts(snap.q90).join(" L ");
    const dn = pts(snap.q10).reverse().join(" L ");
    const start = `${xs0.toFixed(1)} ${y(base).toFixed(1)}`;
    return {
      band: `M ${start} L ${up} L ${dn} Z`,
      median: `M ${start} L ${pts(snap.median).join(" L ")}`,
      endX: x(snap.wi + 26),
      endY: y(snap.median[25]),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, si]);

  const rx = x(reveal);
  const cur = data.all[Math.max(data.first, Math.min(data.last, Math.round(reveal)))];
  const bubble = data.dateAt(snap.wi);
  const bubbleW = 92;
  const bx = Math.min(Math.max(rx - bubbleW / 2, l), W - r - bubbleW);
  const peakVisible = data.peakIdx >= 0 && reveal >= data.peakIdx - 0.5;

  return (
    <svg className="th-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="두쫀쿠 검색 추이와 시점별 6개월 예측">
      <defs>
        <clipPath id="th-clip">
          <rect x={l - 2} y="0" width={Math.max(0, rx - l + 2)} height={H} />
        </clipPath>
        <linearGradient id="th-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f6fe6" stopOpacity=".28" />
          <stop offset="1" stopColor="#2f6fe6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={l} x2={W - r} y1={t + (1 - f) * (plotBottom - t)} y2={t + (1 - f) * (plotBottom - t)} stroke="#e7ebf2" strokeDasharray="3 5" />
      ))}
      {data.ticks.map((tk) => (
        <text key={tk.i} x={x(tk.i)} y={plotBottom + 16} textAnchor="middle" className="th-axis">
          {tk.label}
        </text>
      ))}
      <path d={actual} fill="none" stroke="#c3cddd" strokeWidth="2" strokeDasharray="4 5" strokeLinejoin="round" />
      <g clipPath="url(#th-clip)">
        <path d={area} fill="url(#th-area)" />
        <path d={actual} className="th-line" pathLength="1" fill="none" stroke="#1d5fd6" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />
      </g>
      {peakVisible && (
        <g className="th-peak">
          <circle cx={x(data.peakIdx)} cy={y(data.all[data.peakIdx])} r="5.5" fill="#fff" stroke="#1d5fd6" strokeWidth="2.6" />
          <text x={x(data.peakIdx) + 9} y={y(data.all[data.peakIdx]) - 6} className="th-axis" fontWeight="700" fill="#1b2a44">
            정점
          </text>
        </g>
      )}
      <g key={si} className="th-fan">
        <path d={fan.band} fill={col} opacity=".16" />
        <path d={fan.median} fill="none" stroke={col} strokeWidth="2.4" strokeDasharray="6 5" strokeLinecap="round" />
        <g transform={`translate(${Math.min(fan.endX, W - r - 44)},${Math.max(fan.endY - 12, t + 4)})`}>
          <rect x="-2" y="-14" width="48" height="20" rx="10" fill={col} />
          <text x="22" y="0" textAnchor="middle" className="th-fan-label">
            {Math.round(snap.p_keep * 100)}%
          </text>
        </g>
      </g>
      <g>
        <line x1={rx} x2={rx} y1={t - 6} y2={plotBottom} stroke="#8a9ab3" strokeDasharray="4 4" />
        <circle cx={rx} cy={y(cur ?? 0)} r="6" fill="#fff" stroke="#1d5fd6" strokeWidth="3" />
        <g transform={`translate(${bx},${t - 30})`}>
          <rect width={bubbleW} height="22" rx="11" fill="#1b2a44" />
          <text x={bubbleW / 2} y="15" textAnchor="middle" className="th-bubble">
            {bubble} 시점
          </text>
        </g>
      </g>
      <g>
        <line x1={x(data.snaps[0].wi)} x2={x(data.snaps[data.snaps.length - 1].wi)} y1={H - 14} y2={H - 14} stroke="#dbe2ee" strokeWidth="4" strokeLinecap="round" />
        {data.snaps.map((s, k) => {
          const on = k === si;
          const c = SIGNAL_COLOR[s.signal || sigOf(s.p_keep)];
          return (
            <g key={s.week} className="th-dot" role="button" tabIndex={0} aria-label={`${s.week} 시점 보기`} onClick={() => onPick(k)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick(k)}>
              <circle cx={x(s.wi)} cy={H - 14} r="14" fill="transparent" />
              <circle cx={x(s.wi)} cy={H - 14} r={on ? 7.5 : 5} fill={c} stroke="#fff" strokeWidth="2" style={{ transition: "r .3s" }} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function Pod({ snap, reduce }) {
  const sig = snap.signal || sigOf(snap.p_keep);
  const col = SIGNAL_COLOR[sig];
  const pv = useTween(snap.p_keep * 100, { ms: 900, reduce });
  const lit = { red: 0, amber: 1, green: 2 }[sig];
  return (
    <div className="th-card th-pod" style={{ "--d": ".25s", "--c": col }}>
      <div className="th-float">
        <h4>6개월 뒤 유지 확률</h4>
        <div className="th-pod-body">
          <svg viewBox="0 0 60 138" className="th-light" role="img" aria-label={`신호등 ${RISK[sig]}`}>
            <rect x="2" y="2" width="56" height="134" rx="18" fill="#16253d" />
            {[0, 1, 2].map((k) => {
              const c = ["#D4413A", "#D99A06", "#1E9C58"][k];
              const on = k === lit;
              return (
                <circle key={k} cx="30" cy={30 + k * 39} r="15" fill={on ? c : "#2c3d59"} className={on ? "th-bulb on" : "th-bulb"} style={{ "--bc": c }} />
              );
            })}
          </svg>
          <div className="th-pod-num">
            <strong style={{ color: col }}>{Math.round(pv)}%</strong>
            <span className="th-risk" style={{ background: `${col}1f`, color: col }}>
              {RISK[sig]}
            </span>
          </div>
        </div>
        <p>
          그 시점까지의 검색 곡선만 보고 예측한 값이에요. 이후 데이터는 보지 않았어요.
        </p>
      </div>
    </div>
  );
}

function HorizonCard({ label, p, delay, reduce }) {
  const sig = sigOf(p);
  const col = SIGNAL_COLOR[sig];
  const v = useTween(p * 100, { ms: 1500, initial: 0, reduce, delay: 500 + delay * 1000 });
  return (
    <div className="th-card th-h" style={{ "--d": `${0.5 + delay}s` }}>
      <span className="th-h-top">
        <i style={{ background: col }} />
        {label}
      </span>
      <strong style={{ color: col }}>{Math.round(v)}%</strong>
      <small>{pText(p)}</small>
    </div>
  );
}

function Chip({ name, label, style }) {
  const t = getTrend(name);
  if (!t?.forecast) return null;
  const sig = t.forecast.signal || sigOf(t.forecast.p_keep);
  return (
    <div className="th-chip" style={style}>
      <div className="th-float">
        <i style={{ background: SIGNAL_COLOR[sig] }} />
        <b>{label || name}</b>
        <span>6개월 뒤 {Math.round(t.forecast.p_keep * 100)}%</span>
      </div>
    </div>
  );
}

export function TrendHero() {
  const data = useTrendData();
  const reduce = useReducedMotion();
  const [si, setSi] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = data?.snaps.length || 0;

  useEffect(() => {
    if (!data) return;
    if (reduce) {
      setSi(n - 1);
      return undefined;
    }
    if (paused) return undefined;
    const id = setInterval(() => setSi((k) => (k + 1) % n), 3600);
    return () => clearInterval(id);
  }, [data, reduce, paused, n]);

  if (!data) return null;
  const snap = data.snaps[si];
  const stage = snap.stage || "stable";
  const hz = data.t.horizons;
  return (
    <div className="th-stage" aria-label="MarketSignal 트렌드 분석 미리보기">
      <span className="th-blob th-blob-a" />
      <span className="th-blob th-blob-b" />

      <div className="th-card th-main" style={{ "--d": "0s" }} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div className="th-main-head">
          <div>
            <b>{ITEM}</b>
            <span className="th-ind">{data.t.industry} · 검색 관심도</span>
          </div>
          <div className="th-time">
            <span className="th-stage-badge" style={{ color: STAGE_TONE[stage], background: `${STAGE_TONE[stage]}1a` }}>
              {STAGE_LABEL[stage]}
            </span>
            <span className="th-tm">그 시점에 봤다면</span>
          </div>
        </div>
        <Chart data={data} si={si} reduce={reduce} onPick={setSi} />
      </div>

      <Pod snap={snap} reduce={reduce} />

      <div className="th-h-row">
        <HorizonCard label="3개월 뒤" p={hz["13"]} delay={0} reduce={reduce} />
        <HorizonCard label="6개월 뒤" p={hz["26"]} delay={0.15} reduce={reduce} />
        <HorizonCard label="12개월 뒤" p={hz["52"]} delay={0.3} reduce={reduce} />
      </div>
      <span className="th-h-cap">{data.dateAt(data.last)} 주 데이터 기준 유지 확률</span>

      <Chip name={CHIPS[0]} style={{ left: "-1%", top: "5px", "--d": ".7s", "--f": "0s" }} />
      <Chip name={CHIPS[1]} label={CHIP_LABEL[CHIPS[1]]} style={{ right: "2%", top: "392px", "--d": ".9s", "--f": "-2s" }} />
      <Chip name={CHIPS[2]} style={{ right: "12%", top: "468px", "--d": "1.1s", "--f": "-4s" }} />
      <Chip name={CHIPS[3]} style={{ left: "62%", top: "548px", "--d": "1.3s", "--f": "-1s" }} />
    </div>
  );
}
