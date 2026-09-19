import React, { useState } from "react";
import { ArrowUpRight, ArrowRight, Search, ChartNoAxesCombined } from "lucide-react";
import { getRecords, resolveRegion, industryLabel, genderAgeFor, AGE_GROUPS, GENDER_GROUPS, ageLabels } from "../data";
import {
  getTrend, trendKeywords, trendWeeks, keywordsForIndustry, candidatesForIndustry, trendMeta, generatedAt,
  STAGE_LABEL, SIGNAL_LABEL, SIGNAL_COLOR, AGE_LABEL, recentMean,
} from "../trend";
import { SectionHeading, shortIndustry } from "./Shared";
import { Curve } from "./TrendCurve";

const PROVINCE_TO_CITY = { 서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 광주광역시: "광주", 대전광역시: "대전" };
const STAGE_COLOR = { emerging: "#1E9C58", surging: "#D99A06", peak: "#D4413A", declining: "#D4413A", stable: "#dfe4ec" };

function argmax(arr) { let bi = -1, bv = -Infinity; (arr || []).forEach((v, i) => { if (v != null && v > bv) { bv = v; bi = i; } }); return bi; }

function SignalLamp({ signal }) {
  return (
    <span className="signal-lamp" aria-label={`신호 ${SIGNAL_LABEL[signal]}`}>
      {["red", "amber", "green"].map((c) => <i key={c} style={c === signal ? { background: SIGNAL_COLOR[c], boxShadow: `0 0 10px ${SIGNAL_COLOR[c]}` } : undefined} />)}
    </span>
  );
}

// 결론 한 문장 + 근거 두 줄
function verdict(keyword, t) {
  const fc = t.forecast, p = fc ? Math.round(fc.p_keep * 100) : null, rel = t.current.rel, stage = t.current.stage;
  const head = !fc ? `${keyword}은(는) 아직 예측이 없습니다`
    : t.signal === "green" ? `${keyword}, 지금 들어가도 됩니다`
    : t.signal === "amber" ? `${keyword}은(는) 6개월 뒤가 불확실합니다`
    : `${keyword}은(는) 지금 시작하기엔 늦었습니다`;
  const why1 = fc ? `6개월 뒤에도 지금 수요의 70% 이상 남을 확률 ${p}%` : "검색 곡선은 있지만 예측 모델 결과가 아직 없습니다";
  const afterFad = stage === "stable" && rel != null && rel < 0.25;
  const why2 = afterFad ? `지금은 정점(${t.peak_week.slice(0, 7)})의 ${Math.round(rel * 100)}% 수준에서 안정, 유행 아이템이 아니라 일반 메뉴로 봐야 합니다`
    : stage === "stable" ? "급변 없이 유지되는 안정 수요, 유행 위험은 낮습니다"
    : stage === "emerging" ? "검색이 막 늘기 시작한 초입입니다"
    : stage === "surging" ? "최근 4주 검색이 50% 넘게 뛰었습니다, 이미 알려진 상태라 정점이 멀지 않을 수 있습니다"
    : stage === "peak" ? "성장이 멈추고 꺾이기 시작했습니다" : "검색이 최근 4주 연속 줄고 있습니다";
  const guard = fc && t.signal === "amber" && fc.p_keep < trendMeta.red_max ? " (예측은 비관적이지만 상승 구간이라 노랑으로 표시)" : "";
  return { head, why1, why2: why2 + guard };
}

function AgeBars({ title, rows }) {
  const max = Math.max(...rows.map((r) => r.v), 1e-9);
  return (
    <div className="tc-bars">
      <div className="tc-bars-t">{title}</div>
      {rows.map((r) => (
        <div key={r.k} className="tc-bar-row">
          <span>{r.label}</span>
          <i><b style={{ width: `${(r.v / max) * 100}%` }} /></i>
          <small>{r.text}</small>
        </div>
      ))}
    </div>
  );
}

export function TrendAnalysis({ industry, selected }) {
  const initial = new URLSearchParams(window.location.search).get("item") || "";
  const [query, setQuery] = useState(initial), [keyword, setKeyword] = useState(getTrend(initial) ? initial : ""), [error, setError] = useState("");
  const [fullRange, setFullRange] = useState(false), [showAge, setShowAge] = useState(false);
  const t = keyword ? getTrend(keyword) : null;
  const industryKeywords = industry ? keywordsForIndustry(industry) : [];
  const industryCandidates = industry ? candidatesForIndustry(industry, 8) : [];
  const suggestions = industryKeywords.length ? industryKeywords : trendKeywords.slice(0, 8);
  const region = resolveRegion(getRecords(industry), selected);

  function search(value) {
    const clean = value.trim();
    if (!clean) { setError("분석할 아이템을 입력해주세요."); return; }
    if (!getTrend(clean)) { setError(`'${clean}'의 검색 곡선이 아직 없습니다. 급등 후보는 다음 수집에서 추가됩니다.`); return; }
    setKeyword(clean); setQuery(clean); setError("");
  }

  let body = null;
  if (t) {
    const v = verdict(keyword, t), fc = t.forecast;
    const XW = fc ? trendWeeks.concat(fc.weeks) : trendWeeks;
    const pad = fc ? fc.weeks.map(() => null) : [], hist = trendWeeks.map(() => null);
    const from = fullRange ? 0 : Math.max(0, trendWeeks.length - 104);
    const peakIdx = trendWeeks.indexOf(t.peak_week);
    const searchAge = ["2", "3", "4", "5", "6"].map((a) => ({ k: a, label: AGE_LABEL[a], v: recentMean(t.age[a]) }));
    const sTot = searchAge.reduce((s, r) => s + r.v, 0) || 1;
    searchAge.forEach((r) => { r.text = `${Math.round((r.v / sTot) * 100)}%`; });
    let cardAge = null;
    if (region?.hasData && industry) {
      const ga = genderAgeFor(region, industry);
      const tot = AGE_GROUPS.reduce((s, a) => s + GENDER_GROUPS.reduce((s2, g) => s2 + ga[g][a], 0), 0) || 1;
      cardAge = AGE_GROUPS.map((a) => { const val = GENDER_GROUPS.reduce((s, g) => s + ga[g][a], 0); return { k: a, label: ageLabels[a], v: val, text: `${Math.round((val / tot) * 100)}%` }; });
    }
    const topSearch = searchAge.slice().sort((a, b) => b.v - a.v)[0];
    const topCard = cardAge ? cardAge.slice().sort((a, b) => b.v - a.v)[0] : null;
    const cities = ["서울", "부산", "대구", "광주", "대전"].filter((c) => t.region[c]);
    const sp = t.region["서울"] ? argmax(t.region["서울"]) : null;
    const lagRows = cities.map((c) => { const p = argmax(t.region[c]); return { c, peak: trendWeeks[p].slice(0, 7), lag: sp == null || c === "서울" ? 0 : p - sp }; });
    const myCity = region ? PROVINCE_TO_CITY[region.province] : null;
    const myLag = lagRows.find((r) => r.c === myCity);
    const strip = []; let i0 = 0;
    t.stages.forEach(([s, n]) => { const a = Math.max(i0, from), b = i0 + n; if (b > a) strip.push({ s, w: b - a, from: trendWeeks[a], to: trendWeeks[b - 1] }); i0 += n; });

    body = (
      <div className="trend-result" aria-live="polite">
        <div className="trend-verdict" data-signal={t.signal}>
          <SignalLamp signal={t.signal} />
          <div>
            <h3>{v.head}</h3>
            <p><b>{v.why1}</b></p>
            <p>{v.why2}</p>
          </div>
        </div>

        <div className="tc-block">
          <div className="tc-block-h">
            <h4>검색 흐름과 6개월 예측</h4>
            <button className="tc-link" onClick={() => setFullRange(!fullRange)}>{fullRange ? "최근 2년만 보기" : "2020년부터 전체 보기"}</button>
          </div>
          <Curve series={[
            { name: keyword, color: "#244986", values: t.all.concat(pad), fill: true },
            ...(fc ? [{ name: "예측 구간", color: "#3166ba", band: { lo: hist.concat(fc.q10), hi: hist.concat(fc.q90) } },
              { name: "예측 중앙값", color: "#3166ba", values: hist.slice(0, -1).concat([t.all[t.all.length - 1]]).concat(fc.median), dash: true }] : []),
          ]} xweeks={XW} from={from} peakIdx={peakIdx} todayIdx={fc ? trendWeeks.length - 1 : null} h={240} />
          <div className="tc-strip" aria-label="단계 이력">
            {strip.map((s, k) => <i key={k} style={{ flex: s.w, background: STAGE_COLOR[s.s] }} title={`${STAGE_LABEL[s.s]} · ${s.from} ~ ${s.to}`} />)}
          </div>
          <p className="forecast-note">실선 관측값, 음영 26주 예측 10~90% 구간, 점선 중앙값 · 아래 띠는 주별 단계(초록 태동, 노랑 급등, 빨강 정점·하락, 회색 안정) · 검색 지수는 쿠팡 평균=100 기준</p>
        </div>

        <div className="tc-two">
          <div className="tc-block">
            <div className="tc-block-h"><h4>누가 찾는가</h4></div>
            <p className="tc-lead">
              {`${keyword}을(를) 가장 많이 검색하는 세대는 ${topSearch.label}`}
              {topCard ? `, ${region.name} ${industryLabel(shortIndustry(industry))} 결제는 ${topCard.label}이 가장 많음` : ""}
              {topCard ? (topCard.k === topSearch.k ? " → 찾는 세대와 사는 세대가 같습니다" : " → 찾는 세대와 사는 세대가 다릅니다") : ""}
            </p>
            <button className="tc-link" onClick={() => setShowAge(!showAge)}>{showAge ? "접기" : "연령별 비중 보기"}</button>
            {showAge && (
              <div className="tc-two">
                <AgeBars title={`'${keyword}' 검색 비중 (최근 26주)`} rows={searchAge} />
                {cardAge && <AgeBars title={`${region.name} ${industryLabel(shortIndustry(industry))} 결제 비중`} rows={cardAge} />}
              </div>
            )}
          </div>
          <div className="tc-block">
            <div className="tc-block-h"><h4>어디서 먼저 뜨는가</h4></div>
            {cities.length ? (
              <>
                <p className="tc-lead">
                  {myLag && myCity !== "서울" ? `${myCity}은(는) 서울보다 ${myLag.lag > 0 ? `${myLag.lag}주 늦게` : myLag.lag < 0 ? `${-myLag.lag}주 먼저` : "같은 시기에"} 정점` : `서울 정점 ${lagRows[0]?.peak}, 다른 도시와의 차이는 아래`}
                </p>
                <div className="tc-lags">
                  {lagRows.map((r) => <span key={r.c} className={r.c === myCity ? "on" : ""}>{r.c} <b>{r.c === "서울" ? "기준" : r.lag > 0 ? `+${r.lag}주` : r.lag < 0 ? `${r.lag}주` : "같음"}</b></span>)}
                </div>
              </>
            ) : <p className="tc-lead">지역별 곡선은 아직 없습니다</p>}
          </div>
        </div>

        <details className="tc-details">
          <summary>어떻게 계산했나요</summary>
          <ul>
            <li>지금 단계 <b>{STAGE_LABEL[t.current.stage]}</b> · 최근 4주 vs 직전 4주 {t.current.growth == null ? "–" : `${t.current.growth > 0 ? "+" : ""}${Math.round(t.current.growth * 100)}%`} · 역대 최고 대비 {t.current.rel == null ? "–" : `${Math.round(t.current.rel * 100)}%`} · 정점 {t.peak_week.slice(0, 7)}</li>
            <li>반감기(정점 → 절반) {t.halflife_days == null ? "미도달" : `${t.halflife_days}일`}{t.expected_halflife_days ? ` (코리아헤럴드 기사 ${t.expected_halflife_days}일)` : ""}</li>
            <li>검색 곡선: 네이버 검색어 트렌드 주간, 2020년~, 앵커 '쿠팡' 평균을 100으로 정규화</li>
            <li>6개월 예측: {trendMeta.model}, 26주 분위수 예측에서 "지금의 70% 이상"일 확률을 읽음 · 라벨 백테스트 AUC {trendMeta.backtest?.auc}, 초록 판정의 실제 유지율 {trendMeta.backtest ? Math.round(trendMeta.backtest.green_precision * 100) : "–"}%</li>
            <li>단계는 매주 그 주까지의 데이터만으로 판정(미래 정보 없음) · 데이터 기준일 {generatedAt}</li>
          </ul>
        </details>
      </div>
    );
  }

  return (
    <section id="trend">
      <SectionHeading number="02" title="트렌드 분석" description="이 아이템, 지금 들어가도 될까요?" />
      <form className="search-form" onSubmit={(e) => { e.preventDefault(); search(query); }}>
        <Search size={23} />
        <input aria-label="관심 아이템" list="trend-keywords" placeholder="예: 비빔밥, 탕후루, 두바이 초콜릿" value={query} onChange={(e) => setQuery(e.target.value)} />
        <datalist id="trend-keywords">{trendKeywords.map((k) => <option key={k} value={k} />)}</datalist>
        <button className="primary" type="submit">분석 <ArrowRight size={17} /></button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="suggestions">
        <span>{industry ? `${industryLabel(shortIndustry(industry))} 아이템` : "아이템"}</span>
        {suggestions.map((k) => <button key={k} onClick={() => search(k)}>{k}<ArrowUpRight size={12} /></button>)}
        {industryCandidates.length > 0 && <>
          <span>요즘 뜨는 후보 (YouTube 자동 탐지)</span>
          {industryCandidates.map((c) => <button key={c.phrase} className={c.has_curve ? "" : "pending"} title={c.has_curve ? "" : "곡선 수집 예정"} onClick={() => search(c.phrase)}>{c.phrase}</button>)}
        </>}
      </div>
      {body || (
        <div className="trend-empty">
          <ChartNoAxesCombined size={28} />
          <div>
            <h3>아이템 하나를 고르면 신호등으로 답합니다</h3>
            <p>지금 들어가도 되는지, 6개월 뒤에도 수요가 남는지, 누가 어디서 찾는지</p>
          </div>
          <span>SEARCH → SIGNAL</span>
        </div>
      )}
    </section>
  );
}
