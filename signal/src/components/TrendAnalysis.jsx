import React, { useState } from "react";
import { ArrowUpRight, ArrowRight, Search, ChartNoAxesCombined, Info, Leaf } from "lucide-react";
import { getRecords, signed, direction, resolveRegion, industryLabel } from "../data";
import {
  getTrend, trendKeywords, keywordsForIndustry, candidatesForIndustry, trendMeta, generatedAt,
  STAGE_LABEL, STAGE_TEXT, SIGNAL_LABEL, SIGNAL_COLOR, idx,
} from "../trend";
import { SectionHeading, shortIndustry } from "./Shared";
import { TrendCurvePanel } from "./TrendCurve";
import { TrendLifecycle } from "./TrendLifecycle";

function SignalLamp({ signal }) {
  return (
    <span className="signal-lamp" aria-label={`신호 ${SIGNAL_LABEL[signal]}`}>
      {["red", "amber", "green"].map((c) => <i key={c} className={c === signal ? `on ${c}` : ""} style={c === signal ? { background: SIGNAL_COLOR[c], boxShadow: `0 0 10px ${SIGNAL_COLOR[c]}` } : undefined} />)}
    </span>
  );
}

function stageText(t) {
  if (t.current.stage === "stable" && t.current.rel != null && t.current.rel < 0.25)
    return `유행이 지나간 뒤 정점(${t.peak_week.slice(0, 7)})의 ${Math.round(t.current.rel * 100)}% 수준에서 안정됐습니다. 지금은 유행 아이템이 아니라 일반 메뉴로 봐야 합니다.`;
  return STAGE_TEXT[t.current.stage];
}

function verdictText(keyword, t) {
  const fc = t.forecast;
  if (!fc) return `${keyword}은(는) 아직 6개월 예측이 없습니다.`;
  const p = Math.round(fc.p_keep * 100);
  if (t.signal === "green") return `${keyword}, 지금 들어가도 됩니다. 6개월 뒤에도 수요가 남을 확률 ${p}%.`;
  if (t.signal === "amber") return `${keyword}은(는) 6개월 뒤가 불확실합니다(유지 확률 ${p}%). 유행 의존을 줄여 설계하세요.`;
  return `${keyword}로 지금 시작하는 건 늦었습니다. 6개월 뒤 수요 유지 확률 ${p}%.`;
}

export function TrendAnalysis({ industry, selected }) {
  const initial = new URLSearchParams(window.location.search).get("item") || "";
  const [query, setQuery] = useState(initial),
    [keyword, setKeyword] = useState(getTrend(initial) ? initial : ""),
    [error, setError] = useState("");
  const t = keyword ? getTrend(keyword) : null;
  const industryKeywords = industry ? keywordsForIndustry(industry) : [];
  const industryCandidates = industry ? candidatesForIndustry(industry) : [];
  const suggestions = industryKeywords.length ? industryKeywords : trendKeywords.slice(0, 10);

  function search(value) {
    const clean = value.trim();
    if (!clean) { setError("분석할 아이템을 입력해주세요."); return; }
    const hit = getTrend(clean);
    if (!hit) {
      setError(`'${clean}'의 검색 곡선이 아직 없습니다. 급등 후보로 잡힌 아이템은 다음 수집에서 곡선이 추가됩니다. 지금 볼 수 있는 아이템: ${trendKeywords.join(", ")}`);
      return;
    }
    setKeyword(clean); setQuery(clean); setError("");
  }
  const region = resolveRegion(getRecords(industry), selected);
  const fc = t?.forecast;
  const growth = t?.current?.growth;

  return (
    <section id="trend">
      <SectionHeading number="02" title="트렌드 분석" description="관심 있는 메뉴나 아이템, 지금 어떤 흐름이고 6개월 뒤에도 남아 있을까요?" />
      <form className="search-form" onSubmit={(e) => { e.preventDefault(); search(query); }}>
        <Search size={23} />
        <input aria-label="관심 아이템" list="trend-keywords" placeholder="예: 비빔밥, 탕후루, 두바이 초콜릿" value={query} onChange={(e) => setQuery(e.target.value)} />
        <datalist id="trend-keywords">{trendKeywords.map((k) => <option key={k} value={k} />)}</datalist>
        <button className="primary" type="submit">분석 <ArrowRight size={17} /></button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="suggestions">
        <span>{industry ? `${industryLabel(shortIndustry(industry))} 곡선 있는 아이템` : "곡선 있는 아이템"}</span>
        {suggestions.map((k) => <button key={k} onClick={() => search(k)}>{k}<ArrowUpRight size={12} /></button>)}
      </div>
      {industry && industryCandidates.length > 0 && (
        <div className="suggestions candidates">
          <span>YouTube에서 자동 탐지된 {industryLabel(shortIndustry(industry))} 급등 후보</span>
          {industryCandidates.map((c) => (
            <button key={c.phrase} className={c.has_curve ? "" : "pending"} title={`급등 시작 ${c.burst_week}${c.z != null ? ` · z ${c.z}` : ""}${c.has_curve ? "" : " · 곡선 수집 예정"}`} onClick={() => search(c.phrase)}>
              {c.phrase}<small>{c.burst_week.slice(5)}</small>
            </button>
          ))}
        </div>
      )}

      {t ? (
        <div className="trend-result" aria-live="polite">
          <div className="trend-verdict" data-signal={t.signal}>
            <SignalLamp signal={t.signal} />
            <div>
              <span className="eyebrow">SIGNAL · 6개월 뒤 수요 유지 확률 기준</span>
              <h3>{verdictText(keyword, t)}</h3>
              <p>{stageText(t)}{fc && t.signal !== "red" && t.forecast.p_keep < trendMeta.red_max ? " 예측은 비관적이지만 규칙상 상승 구간이라 노랑으로 낮춰 표시했습니다." : ""}</p>
            </div>
          </div>

          <div className="trend-summary">
            <div>
              <span className="eyebrow">KEYWORD INSIGHT</span>
              <h3>{keyword}<span className="stage-badge"><Leaf size={13} />{STAGE_LABEL[t.current.stage]}</span></h3>
            </div>
            <div className="trend-stats">
              {fc && <div><small>6개월 뒤 유지 확률</small><strong style={{ color: SIGNAL_COLOR[t.signal] }}>{Math.round(fc.p_keep * 100)}<span>%</span></strong></div>}
              <div><small>최근 4주 vs 직전 4주</small><strong>{growth == null ? "–" : (growth > 0 ? "+" : "") + (growth * 100).toFixed(0)}<span>%</span></strong></div>
              <div><small>역대 최고 대비</small><strong>{t.current.rel == null ? "–" : (t.current.rel * 100).toFixed(0)}<span>%</span></strong></div>
              <div><small>정점 시점</small><strong className="date">{t.peak_week.slice(0, 7)}</strong></div>
              <div><small>반감기 (정점→50%)</small><strong>{t.halflife_days == null ? "미도달" : t.halflife_days}<span>{t.halflife_days == null ? "" : "일"}</span></strong>{t.expected_halflife_days && <small>기사 {t.expected_halflife_days}일</small>}</div>
            </div>
          </div>

          <TrendCurvePanel keyword={keyword} t={t} />
          <p className="forecast-note">
            <Info size={14} /> 검색 지수는 앵커 '쿠팡'의 기간 평균을 100으로 둔 상대값입니다. 단계 판정은 각 주까지의 데이터만 사용합니다. 6개월 예측은 {trendMeta.model}이며 라벨 백테스트 AUC {trendMeta.backtest?.auc}, 초록 판정의 실제 유지율 {trendMeta.backtest ? Math.round(trendMeta.backtest.green_precision * 100) : "–"}%, 빨강 판정의 실제 하락율 {trendMeta.backtest ? Math.round(trendMeta.backtest.red_precision * 100) : "–"}%. 데이터 기준일 {generatedAt}.
          </p>
          <TrendLifecycle stage={t.current.stage} keyword={keyword} rel={t.current.rel} peakWeek={t.peak_week} />

          {region?.hasData && industry && (
            <div className="combined">
              <div>
                <span className="eyebrow">CONNECT THE DOTS</span>
                <h3>함께 살펴보기 <ArrowUpRight size={20} /></h3>
                <p>상권은 카드 결제 집계(2026년 1~6월), 트렌드는 검색 곡선(2020년~)입니다. 기간과 출처가 다릅니다.</p>
              </div>
              <div className="combined-facts">
                <div><span>{region.province} {region.name} {industryLabel(shortIndustry(industry))} 소비</span><strong>{direction(region.growth)} <small>{signed(region.growth)}</small></strong></div>
                <div><span>{keyword} 검색 관심도 (최근 4주)</span><strong>{growth == null ? "–" : growth > 0 ? "증가" : "감소"} <small>{growth == null ? "" : (growth > 0 ? "+" : "") + (growth * 100).toFixed(0) + "%"}</small></strong></div>
                <div><span>{keyword} 6개월 뒤 유지</span><strong>{fc ? `${Math.round(fc.p_keep * 100)}%` : "–"} <small>{SIGNAL_LABEL[t.signal]}</small></strong></div>
              </div>
              <small>서로 다른 데이터의 흐름을 함께 표시한 것으로, 인과관계나 창업 성과를 의미하지 않습니다.</small>
            </div>
          )}
        </div>
      ) : (
        <div className="trend-empty">
          <ChartNoAxesCombined size={28} />
          <div>
            <h3>관심에서 시작해, 흐름을 발견하세요.</h3>
            <p>키워드를 검색하면 검색 지수 추이, 지금 단계, 6개월 뒤 유지 확률을 함께 보여드려요. 곡선이 있는 아이템 {trendKeywords.length}개.</p>
          </div>
          <span>SEARCH → DISCOVER</span>
        </div>
      )}
    </section>
  );
}
