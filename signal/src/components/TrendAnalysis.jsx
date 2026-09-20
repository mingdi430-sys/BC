import React, { useState } from "react";
import { ArrowUpRight, ArrowRight, Search, ChartNoAxesCombined } from "lucide-react";
import { getRecords, resolveRegion, industryLabel, genderAgeFor, AGE_GROUPS, GENDER_GROUPS, ageLabels } from "../data";
import {
  getTrend, trendKeywords, trendWeeks, keywordsForIndustry, candidatesForIndustry, trendMeta, generatedAt, registerTrend,
  STAGE_LABEL, SIGNAL_LABEL, SIGNAL_COLOR, AGE_LABEL, recentMean, trending,
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

// 결론 한 문장 + 근거 두 줄. h = 판정 시점(타임머신), null 이면 현재
function verdict(keyword, t, h) {
  const now = !h || h.idx === trendWeeks.length - 1;
  const when = now ? "지금" : `${h.week.slice(0, 7)} 시점에`;
  const p = h ? Math.round(h.p_keep * 100) : t.forecast ? Math.round(t.forecast.p_keep * 100) : null;
  const signal = h ? h.signal : t.signal, stage = h ? h.stage : t.current.stage;
  const vals = t.all.slice(0, (h ? h.idx : trendWeeks.length - 1) + 1).filter((x) => x != null);
  const cur = vals.slice(-4).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(4, vals.length));
  const peakSoFar = Math.max(...vals), peakIdx = vals.indexOf(peakSoFar);
  const rel = peakSoFar > 0 ? cur / peakSoFar : null;
  const early = vals.slice(0, 26); const earlyMean = early.reduce((a, b) => a + b, 0) / Math.max(1, early.length);
  const hadFad = earlyMean > 0 && peakSoFar / earlyMean >= 3;
  const head = p == null ? `${keyword}, 아직 예측이 없습니다`
    : signal === "green" ? `${keyword}, ${when} 보면 6개월 뒤에도 수요가 남을 가능성이 높습니다`
    : signal === "amber" ? `${keyword}, ${when} 보면 6개월 뒤 수요가 불확실합니다`
    : `${keyword}, ${when} 보면 6개월 뒤 수요가 줄어들 가능성이 높습니다`;
  const risk = signal === "green" ? "유행 리스크 낮음" : signal === "amber" ? "유행 리스크 중간" : signal === "red" ? "유행 리스크 높음" : "";
  const why1 = p == null ? "검색 곡선은 있지만 예측 모델 결과가 아직 없습니다" : `${risk} · 유지 확률은 ${when === "지금" ? "지금" : "그때"} 수요의 70% 이상이 남을 확률`;
  let why2;
  if (stage === "stable") {
    if (rel != null && rel < 0.25 && hadFad) why2 = `유행이 꺼진 뒤 정점(${t.peak_week.slice(0, 7)})의 ${Math.round(rel * 100)}% 수준에서 안정, 유행 아이템이 아니라 일반 메뉴로 봐야 합니다`;
    else if (hadFad) why2 = `한때 유행했지만 정점의 ${Math.round(rel * 100)}% 수준에서 수요가 남아 정착한 아이템`;
    else why2 = "원래 급변 없이 유지되는 기본 수요, 유행 위험은 낮고 차별화는 다른 데서 만들어야 합니다";
  } else if (stage === "emerging") why2 = "검색이 막 늘기 시작한 초입, 가장 좋은 타이밍이지만 유행이 되는지는 아직 확정 아님";
  else if (stage === "surging") why2 = "최근 4주 검색이 50% 넘게 뛰었습니다, 이미 알려진 상태라 정점이 멀지 않을 수 있음";
  else if (stage === "peak") why2 = "성장이 멈추고 꺾이기 시작했습니다";
  else why2 = "검색이 최근 4주 연속 줄고 있습니다";
  const guard = p != null && signal === "amber" && (h ? h.p_keep : t.forecast.p_keep) < trendMeta.red_max ? " (예측은 비관적이지만 상승 구간이라 노랑으로 표시)" : "";
  const nowLabel = stage === "stable" ? (rel != null && rel < 0.25 && hadFad ? "꺼진 유행" : hadFad ? "정착한 유행" : "기본 수요")
    : stage === "emerging" ? "유행 초입" : stage === "surging" ? "급등 중" : stage === "peak" ? "정점" : "하락 중";
  const nowColor = stage === "emerging" ? "green" : stage === "surging" ? "amber" : stage === "peak" || stage === "declining" ? "red"
    : (rel != null && rel < 0.25 && hadFad) ? "grey" : "green";
  const sigOf = (pp) => (pp == null ? "grey" : pp >= trendMeta.green_min ? "green" : pp < trendMeta.red_max ? "red" : "amber");
  const pText = (pp) => (pp >= trendMeta.green_min ? "수요가 남을 가능성 높음" : pp < trendMeta.red_max ? "수요가 줄어들 가능성 높음" : "불확실");
  const steps = !h && t.horizons ? [
    { label: "현재", value: nowLabel, color: nowColor, note: why2 },
    { label: "3개월 뒤", value: `${Math.round(t.horizons["13"] * 100)}%`, color: sigOf(t.horizons["13"]), note: pText(t.horizons["13"]) },
    { label: "6개월 뒤", value: `${Math.round(t.horizons["26"] * 100)}%`, color: signal, note: pText(t.horizons["26"]) + guard },
  ] : null;
  return { head, why1, why2: why2 + guard, signal, steps };
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
  const atParam = new URLSearchParams(window.location.search).get("at");
  const [fetching, setFetching] = useState("");
  const API_BASE = import.meta.env.VITE_CHAT_API || "http://localhost:8000";
  const [tm, setTm] = useState(() => {
    const t0 = getTrend(initial); if (!t0 || !atParam || !t0.history) return null;
    const i = t0.history.findIndex((x) => x.week >= atParam); return i < 0 || i === t0.history.length - 1 ? null : i;
  }); // 타임머신: history 배열 인덱스, null = 현재
  const t = keyword ? getTrend(keyword) : null;
  const industryKeywords = industry ? keywordsForIndustry(industry) : [];
  const industryCandidates = industry ? candidatesForIndustry(industry, 8) : [];
  const suggestions = industryKeywords.length ? industryKeywords : trendKeywords.slice(0, 8);
  const region = resolveRegion(getRecords(industry), selected);

  async function search(value) {
    const clean = value.trim();
    if (!clean) { setError("분석할 아이템을 입력해주세요."); return; }
    if (!getTrend(clean)) {
      // 풀에 없으면 백엔드가 네이버에서 즉석 수집 (20~30초)
      setError(""); setFetching(clean);
      try {
        const q = industry ? `?industry=${encodeURIComponent(industry.replace(/\s+/g, ""))}` : "";
        const res = await fetch(`${API_BASE}/trend/${encodeURIComponent(clean)}${q}`);
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || `HTTP ${res.status}`); }
        const data = await res.json();
        registerTrend(clean, data.entry);
      } catch (e) {
        setFetching(""); setError(`'${clean}' 곡선을 받아오지 못했습니다 (${e.message}). 백엔드가 켜져 있고 네이버 키가 있어야 합니다.`); return;
      }
      setFetching("");
    }
    setKeyword(clean); setQuery(clean); setError(""); setTm(null);
  }

  let body = null;
  if (t) {
    const H = t.history || [];
    const h = tm == null ? null : H[tm];
    const v = verdict(keyword, t, h), fc = t.forecast;
    const XW = fc ? trendWeeks.concat(fc.weeks) : trendWeeks;
    const pad = fc ? fc.weeks.map(() => null) : [], hist = trendWeeks.map(() => null);
    const from = fullRange ? 0 : Math.max(0, trendWeeks.length - 104);
    const peakIdx = trendWeeks.indexOf(t.peak_week);
    // 타임머신이면 그 시점까지만 보여주고, 그 시점의 예측 부채꼴을 얹는다
    const cutIdx = h ? h.idx : trendWeeks.length - 1;
    const shown = t.all.map((x, i) => (i <= cutIdx ? x : null)).concat(pad);
    const fanLo = XW.map(() => null), fanHi = XW.map(() => null), fanMed = XW.map(() => null);
    const src = h ? h : fc ? { median: fc.median, q10: fc.q10, q90: fc.q90 } : null;
    if (src) { const ev = src.fan_every || 1; fanMed[cutIdx] = t.all[cutIdx]; for (let k = 0; k < src.median.length; k++) { const j = cutIdx + ev * (k + 1); if (j >= XW.length) break; fanLo[j] = src.q10[k]; fanHi[j] = src.q90[k]; fanMed[j] = src.median[k]; } }
    const actualAfter = h ? t.all.map((x, i) => (i > cutIdx ? x : null)).concat(pad) : null;
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
        <div className="trend-verdict" data-signal={v.signal}>
          <SignalLamp signal={v.signal} />
          <div>
            {h && <span className="tc-tm-badge">타임머신 · {h.week} 시점의 판정 (그 뒤 데이터는 안 봄)</span>}
            <h3>{v.head}</h3>
            {v.steps ? (
              <div className="tc-steps">
                {v.steps.map((st, i) => (
                  <div key={st.label} className="tc-step" data-color={st.color}>
                    <small>{st.label}{i > 0 ? " · 지금 수요의 70% 이상 남을 확률" : ""}</small>
                    <b><i style={{ background: SIGNAL_COLOR[st.color] }} />{st.value}</b>
                    <span>{st.note}</span>
                  </div>
                ))}
              </div>
            ) : (<><p><b>{v.why1}</b></p><p>{v.why2}</p></>)}
          </div>
        </div>

        <div className="tc-block">
          <div className="tc-block-h">
            <h4>검색 흐름과 6개월 예측</h4>
            <button className="tc-link" onClick={() => setFullRange(!fullRange)}>{fullRange ? "최근 2년만 보기" : "2020년부터 전체 보기"}</button>
          </div>
          <Curve series={[
            { name: keyword, color: "#244986", values: shown, fill: true },
            ...(actualAfter ? [{ name: "실제 (그 뒤)", color: "#9aa8bd", values: actualAfter }] : []),
            ...(src ? [{ name: "예측 구간", color: "#3166ba", band: { lo: fanLo, hi: fanHi } },
              { name: "예측 중앙값", color: "#3166ba", values: fanMed, dash: true }] : []),
          ]} xweeks={XW} from={h ? Math.min(from, Math.max(0, cutIdx - 52)) : from} peakIdx={h ? null : peakIdx} todayIdx={cutIdx} todayLabel={h ? "판정 시점" : "오늘"} h={240} />
          {H.length > 2 && (
            <div className="tc-tm">
              <label htmlFor="tm-slider">이 시점에 봤다면</label>
              <input id="tm-slider" type="range" min="0" max={H.length - 1} value={tm == null ? H.length - 1 : tm}
                onChange={(e) => { const i = +e.target.value; setTm(i === H.length - 1 ? null : i); }} />
              <span>{h ? h.week : "지금"}</span>
              {h && <button className="tc-link" onClick={() => setTm(null)}>지금으로</button>}
            </div>
          )}
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
            {t.horizons && <li>유지 확률 3개월 {Math.round(t.horizons["13"] * 100)}% · 6개월 {Math.round(t.horizons["26"] * 100)}% · 12개월 {Math.round(t.horizons["52"] * 100)}%</li>}
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
      {fetching && <p className="tc-fetching" role="status">'{fetching}' 검색 곡선을 네이버에서 받아 판정하는 중입니다 (20~30초)…</p>}
      <div className="suggestions">
        <span>{industry ? `${industryLabel(shortIndustry(industry))} 아이템` : "아이템"}</span>
        {suggestions.map((k) => <button key={k} onClick={() => search(k)}>{k}<ArrowUpRight size={12} /></button>)}
        {industryCandidates.length > 0 && <>
          <span>요즘 뜨는 후보 (YouTube 자동 탐지)</span>
          {industryCandidates.map((c) => <button key={c.phrase} className={c.has_curve ? "" : "pending"} title={c.has_curve ? "" : "곡선 수집 예정"} onClick={() => search(c.phrase)}>{c.phrase}</button>)}
        </>}
      </div>
      {!t && trending.length > 0 && (
        <div className="tc-trending">
          <div className="tc-block-h"><h4>지금 YouTube에서 뜨는 것</h4><small>최근 4주 영상 언급이 직전 8주 대비 2배 이상, 계속 오르는 명사구 · 기준 {trending[0].last_week}</small></div>
          <div className="tc-trend-grid">
            {trending.map((x) => (
              <button key={x.phrase} className="tc-trend-card" onClick={() => search(x.phrase)} title="클릭하면 검색 곡선으로 판정">
                <div className="tc-trend-top"><b>{x.phrase}</b><small>{x.industry}</small></div>
                <div className="tc-spark">{x.spark.map((v, i) => <i key={i} style={{ height: `${Math.max(8, (v / Math.max(...x.spark, 1)) * 100)}%` }} />)}</div>
                <div className="tc-trend-bot"><span>4주 {x.recent_sum}건 · ×{x.ratio.toFixed(1)}</span>{x.signal ? <span className="tc-sig" style={{ color: SIGNAL_COLOR[x.signal] }}>● {STAGE_LABEL[x.stage]}</span> : <span className="muted">클릭해 판정</span>}</div>
              </button>
            ))}
          </div>
        </div>
      )}
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
