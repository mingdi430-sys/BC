import React, { useState } from "react";
import { ArrowUpRight, ArrowRight, Search } from "lucide-react";
import { getRecords, resolveRegion, industryLabel, genderAgeFor, AGE_GROUPS, GENDER_GROUPS, ageLabels } from "../data";
import {
  getTrend, trendKeywords, trendWeeks, trendMeta, generatedAt, registerTrend,
  STAGE_LABEL, SIGNAL_COLOR, AGE_LABEL, recentMean, trending, featuredKeywords,
} from "../trend";
import { SectionHeading, shortIndustry } from "./Shared";
import { Curve } from "./TrendCurve";

const STAGE_COLOR = { emerging: "#1E9C58", surging: "#D99A06", peak: "#D4413A", declining: "#D4413A", stable: "#dfe4ec" };
const GENDER_COLOR = { m: "#2554C7", f: "#E8398F" };            // 상권 탭과 같은 성별 색
const SIMILAR_COLORS = ["#0E9594", "#7B6BD6", "#E08A3C"];       // 닮은 사례 3개 (대상 남색과 구분)
const AGE_ON = "#244986", AGE_OFF = "#a9bcd4";

function argmax(arr) { let bi = -1, bv = -Infinity; (arr || []).forEach((v, i) => { if (v != null && v > bv) { bv = v; bi = i; } }); return bi; }

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
  let nowLabel = stage === "stable" ? (rel != null && rel < 0.25 && hadFad ? "꺼진 유행" : hadFad ? "정착한 유행" : "기본 수요")
    : stage === "emerging" ? "유행 초입" : stage === "surging" ? "급등 중" : stage === "peak" ? "정점" : "하락 중";
  let nowColor = stage === "emerging" ? "green" : stage === "surging" ? "amber" : stage === "peak" || stage === "declining" ? "red"
    : (rel != null && rel < 0.25 && hadFad) ? "grey" : "green";
  // 계절 아이템은 비수기에 낮은 것이 정상이라 "꺼진 유행"으로 읽히면 안 된다
  const sea = t.seasonality;
  if (!h && sea?.seasonal) {
    const nowM = Number(trendWeeks[trendWeeks.length - 1].slice(5, 7));
    const ni = Math.round(sea.index[nowM - 1]);
    nowLabel = "계절 아이템";
    nowColor = "green";
    why2 = `${sea.peak_month}월이 성수기인 계절 아이템, 지금(${nowM}월)은 연평균의 ${ni}% 수준`;
  }
  const sigOf = (pp) => (pp == null ? "grey" : pp >= trendMeta.green_min ? "green" : pp < trendMeta.red_max ? "red" : "amber");
  const pText = (pp) => (pp >= trendMeta.green_min ? "수요가 남을 가능성 높음" : pp < trendMeta.red_max ? "수요가 줄어들 가능성 높음" : "불확실");
  const steps = !h && t.horizons ? [
    { label: "현재", value: nowLabel, color: nowColor, note: why2 },
    { label: "3개월 뒤", value: `${Math.round(t.horizons["13"] * 100)}%`, color: sigOf(t.horizons["13"]), note: pText(t.horizons["13"]) },
    { label: "6개월 뒤", value: `${Math.round(t.horizons["26"] * 100)}%`, color: signal, note: pText(t.horizons["26"]) + guard },
  ] : null;
  return { head, why1, why2: why2 + guard, signal, steps };
}

// 정점을 0주에 맞춰 대상 곡선과 닮은 과거 사례를 겹쳐 그린다 (정점 = 100)
function PeakOverlay({ shape, similar, keyword }) {
  const W = 620, H = 200, m = { t: 14, r: 12, b: 26, l: 34 };
  const pre = shape.pre ?? 26, post = shape.post ?? 26, n = pre + post + 1;
  const x = (i) => m.l + (i / (n - 1)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - v / 100) * (H - m.t - m.b);
  const path = (vals) => {
    let d = "", pen = false;
    vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; pen = true; });
    return d;
  };
  const nowI = pre + Math.min(post, shape.weeks_since_peak);
  const COLORS = SIMILAR_COLORS;
  return (
    <svg className="tc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="정점 기준 곡선 비교">
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="#e0e5ed" strokeDasharray="3 4" />
          <text x={m.l - 6} y={y(v) + 4} textAnchor="end" className="axis">{v}</text>
        </g>
      ))}
      <line x1={x(pre)} x2={x(pre)} y1={m.t} y2={H - m.b} stroke="#b6c0d0" />
      <text x={x(pre)} y={H - m.b + 15} textAnchor="middle" className="axis">정점</text>
      <text x={x(0)} y={H - m.b + 15} className="axis">6개월 전</text>
      <text x={x(n - 1)} y={H - m.b + 15} textAnchor="end" className="axis">6개월 후</text>
      {similar.map((o, k) => <path key={o.keyword} d={path(o.values)} fill="none" stroke={COLORS[k] || "#c2d0e2"} strokeWidth="1.8" opacity=".85" />)}
      <path d={path(shape.values)} fill="none" stroke="#244986" strokeWidth="2.6" />
      {shape.weeks_since_peak >= 0 && shape.weeks_since_peak <= post && shape.values[nowI] != null && (
        <g><circle cx={x(nowI)} cy={y(shape.values[nowI])} r="4.5" fill="#244986" stroke="#fff" strokeWidth="2" />
          <text x={x(nowI) + 7} y={y(shape.values[nowI]) - 7} className="axis" fontWeight="600">지금</text></g>
      )}
    </svg>
  );
}

// 월별 계절 지수 (100 = 연평균). 지금 달과 6개월 뒤 달을 강조한다.
function SeasonBars({ sea, nowMonth }) {
  const plus6 = ((nowMonth - 1 + 6) % 12) + 1;
  const max = Math.max(...sea.index.filter((v) => v != null), 120);
  return (
    <div className="tc-season">
      {sea.index.map((v, i) => {
        const m = i + 1, hi = v >= 100, top = m === sea.peak_month;
        const mark = m === nowMonth ? "now" : m === plus6 ? "plus6" : "";
        return (
          <div key={m} className={`tc-season-col ${mark}`} title={`${m}월 · 연평균의 ${Math.round(v)}%`}>
            <div className="tc-season-bar"><i style={{ height: `${(v / max) * 100}%`, background: top ? "#1b3a6b" : hi ? "#3f6ea8" : "#c2cddd" }} /></div>
            <small>{m}</small>
          </div>
        );
      })}
    </div>
  );
}

function AgeBars({ title, rows, color = AGE_ON }) {
  const max = Math.max(...rows.map((r) => r.v), 1e-9);
  return (
    <div className="tc-bars">
      <div className="tc-bars-t">{title}</div>
      {rows.map((r) => (
        <div key={r.k} className="tc-bar-row">
          <span>{r.label}</span>
          <i><b style={{ width: `${(r.v / max) * 100}%`, background: r.v === max ? color : AGE_OFF }} /></i>
          <small>{r.text}</small>
        </div>
      ))}
    </div>
  );
}

// 남 / 여 비중 한 줄 (검색과 결제를 같은 줄에)
function GenderSplit({ label, m, f }) {
  const tot = m + f || 1, pm = (m / tot) * 100;
  return (
    <div className="tc-gender">
      <span className="tc-gender-l">{label}</span>
      <div className="tc-gender-bar">
        <i style={{ width: `${pm}%`, background: GENDER_COLOR.m }} />
        <i style={{ width: `${100 - pm}%`, background: GENDER_COLOR.f }} />
      </div>
      <small>남 {Math.round(pm)}% · 여 {Math.round(100 - pm)}%</small>
    </div>
  );
}

export function TrendAnalysis({ industry, selected, goCommercial }) {
  const initial = new URLSearchParams(window.location.search).get("item") || "";
  const [query, setQuery] = useState(initial), [keyword, setKeyword] = useState(getTrend(initial) ? initial : ""), [error, setError] = useState("");
  const [fullRange, setFullRange] = useState(false);
  const atParam = new URLSearchParams(window.location.search).get("at");
  const [fetching, setFetching] = useState("");
  const API_BASE = import.meta.env.VITE_CHAT_API || "http://localhost:8000";
  const [tm, setTm] = useState(() => {
    const t0 = getTrend(initial); if (!t0 || !atParam || !t0.history) return null;
    const i = t0.history.findIndex((x) => x.week >= atParam); return i < 0 || i === t0.history.length - 1 ? null : i;
  }); // 타임머신: history 배열 인덱스, null = 현재
  const t = keyword ? getTrend(keyword) : null;
  const suggestions = featuredKeywords(10);   // 트렌드 분석은 전국 기준, 업종으로 좁히지 않는다
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
    const peakV = Math.max(...t.all.filter((x) => x != null), 1e-9);
    const sc = (x) => (x == null ? null : (x / peakV) * 100);   // 정점 = 100 척도
    const shown = t.all.map((x, i) => (i <= cutIdx ? sc(x) : null)).concat(pad);
    const fanLo = XW.map(() => null), fanHi = XW.map(() => null), fanMed = XW.map(() => null);
    const src = h ? h : fc ? { median: fc.median, q10: fc.q10, q90: fc.q90 } : null;
    if (src) { const ev = src.fan_every || 1; fanMed[cutIdx] = sc(t.all[cutIdx]); for (let k = 0; k < src.median.length; k++) { const j = cutIdx + ev * (k + 1); if (j >= XW.length) break; fanLo[j] = sc(src.q10[k]); fanHi[j] = sc(src.q90[k]); fanMed[j] = sc(src.median[k]); } }
    const actualAfter = h ? t.all.map((x, i) => (i > cutIdx ? sc(x) : null)).concat(pad) : null;
    const searchAge = ["2", "3", "4", "5", "6"].map((a) => ({ k: a, label: AGE_LABEL[a], v: recentMean(t.age[a]) }));
    const sTot = searchAge.reduce((s, r) => s + r.v, 0) || 1;
    searchAge.forEach((r) => { r.text = `${Math.round((r.v / sTot) * 100)}%`; });
    let cardAge = null, cardGender = { m: 0, f: 0 };
    if (region?.hasData && industry) {
      const ga = genderAgeFor(region, industry);
      const tot = AGE_GROUPS.reduce((s, a) => s + GENDER_GROUPS.reduce((s2, g) => s2 + ga[g][a], 0), 0) || 1;
      cardAge = AGE_GROUPS.map((a) => { const val = GENDER_GROUPS.reduce((s, g) => s + ga[g][a], 0); return { k: a, label: ageLabels[a], v: val, text: `${Math.round((val / tot) * 100)}%` }; });
      cardGender = { m: AGE_GROUPS.reduce((s, a) => s + ga["1"][a], 0), f: AGE_GROUPS.reduce((s, a) => s + ga["2"][a], 0) };
    }
    const topSearch = searchAge.slice().sort((a, b) => b.v - a.v)[0];
    const topCard = cardAge ? cardAge.slice().sort((a, b) => b.v - a.v)[0] : null;

    body = (
      <div className="trend-result" aria-live="polite">
        <div className="trend-verdict" data-signal={v.signal}>
          <div>
            {h && <span className="tc-tm-badge">{h.week} 시점의 판정</span>}
            <h3>{v.head}</h3>
            {t.industry && <span className="tc-tag">{industryLabel(t.industry)}</span>}
            {v.steps ? (
              <div className="tc-steps">
                {v.steps.map((st, i) => (
                  <div key={st.label} className="tc-step" data-color={st.color}>
                    <small>{st.label}</small>
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
            ...(src ? [{ name: "예측 구간", color: SIGNAL_COLOR[v.signal] || "#3166ba", band: { lo: fanLo, hi: fanHi } },
              { name: "예측 중앙값", color: SIGNAL_COLOR[v.signal] || "#3166ba", values: fanMed, dash: true, width: 2.4 }] : []),
          ]} xweeks={XW} from={h ? Math.min(from, Math.max(0, cutIdx - 52)) : from} peakIdx={h ? null : peakIdx} todayIdx={cutIdx} todayLabel={h ? "판정 시점" : "오늘"} h={240}
            refY={src ? (() => { const vals = t.all.slice(Math.max(0, cutIdx - 3), cutIdx + 1).filter((x) => x != null); return vals.length ? sc(0.7 * vals.reduce((a, b) => a + b, 0) / vals.length) : null; })() : null}
            refLabel="" refFrom={cutIdx} yfmt={(v) => Math.round(v)} ymax={100} />
          {H.length > 2 && (
            <div className="tc-tm">
              <label htmlFor="tm-slider">이 시점에 봤다면</label>
              <input id="tm-slider" type="range" min="0" max={H.length - 1} value={tm == null ? H.length - 1 : tm}
                onChange={(e) => { const i = +e.target.value; setTm(i === H.length - 1 ? null : i); }} />
              <span>{h ? h.week : "지금"}</span>
              {h && <button className="tc-link" onClick={() => setTm(null)}>지금으로</button>}
            </div>
          )}
        </div>

        {t.seasonality?.seasonal && (() => {
          const sea = t.seasonality, nowM = Number(trendWeeks[trendWeeks.length - 1].slice(5, 7));
          const plus6 = ((nowM - 1 + 6) % 12) + 1, p6 = sea.index[plus6 - 1];
          return (
            <div className="tc-block">
              <div className="tc-block-h"><h4>계절 흐름</h4></div>
              <p className="tc-lead">
                {`${sea.peak_month}월에 가장 많이 찾고(연평균의 ${Math.round(sea.index[sea.peak_month - 1])}%) ${sea.low_month}월에 가장 적습니다. `}
                {`지금 준비를 시작해 6개월 뒤 ${plus6}월에 연다면 연평균의 ${Math.round(p6)}% 수준, ${p6 >= 115 ? "성수기에 맞습니다" : p6 <= 85 ? "비수기와 겹칩니다" : "평년 수준입니다"}.`}
              </p>
              <SeasonBars sea={sea} nowMonth={nowM} />
              <p className="tc-season-cap"><b>{nowM}월</b> 지금 · <b>{plus6}월</b> 6개월 뒤 · 가로선 100 = 연평균 ({sea.n_years}년 평균, 유행 추세 제거 후)</p>
            </div>
          );
        })()}
        {t.similar?.length > 0 && t.shape && (
          <div className="tc-block">
            <div className="tc-block-h"><h4>닮은 과거 유행</h4></div>
            <p className="tc-lead">
              {`${keyword}의 곡선은 ${t.similar.map((o) => o.keyword).join(", ")}과(와) 모양이 닮았습니다. `}
              {`그 아이템들은 정점 6개월 뒤 ${t.similar.map((o) => `${Math.round(o.after6m * 100)}%`).join(", ")} 수준으로 남았습니다.`}
            </p>
            <PeakOverlay shape={t.shape} similar={t.similar} keyword={keyword} />
            <div className="tc-legend">
              <span><i style={{ background: "#244986" }} />{keyword}</span>
              {t.similar.map((o, k) => (
                <span key={o.keyword}><i style={{ background: SIMILAR_COLORS[k] }} />{o.keyword}<small>{o.peak_week.slice(0, 7)} 정점 · 6개월 뒤 {Math.round(o.after6m * 100)}%</small></span>
              ))}
            </div>
          </div>
        )}
        <div className="tc-block">
            <div className="tc-block-h">
              <h4>누가 찾는가</h4>
              {cardAge ? <span className="tc-scope">{region.province} {region.name} · {industryLabel(shortIndustry(industry))} 결제와 비교</span>
                       : <button className="tc-link" onClick={goCommercial}>상권 분석에서 지역·업종을 고르면 결제 세대와 비교됩니다</button>}
            </div>
            <p className="tc-lead">
              {`${keyword}을(를) 가장 많이 검색하는 세대는 ${topSearch.label}${(() => { const m = recentMean(t.gender.m), f = recentMean(t.gender.f); const r = m / (m + f || 1); return r >= 0.6 ? ", 남성이 더 많이 찾습니다" : r <= 0.4 ? ", 여성이 더 많이 찾습니다" : ""; })()}`}
              {topCard ? `, ${region.name} ${industryLabel(shortIndustry(industry))} 결제는 ${topCard.label}이 가장 많음` : ""}
              {topCard ? (topCard.k === topSearch.k ? " → 찾는 세대와 사는 세대가 같습니다" : " → 찾는 세대와 사는 세대가 다릅니다") : ""}
            </p>
            <div className="tc-two">
              <div>
                <AgeBars title={`'${keyword}' 검색 비중 (최근 26주)`} rows={searchAge} />
                <GenderSplit label="검색" m={recentMean(t.gender.m)} f={recentMean(t.gender.f)} />
              </div>
              {cardAge && (
                <div>
                  <AgeBars title={`${region.name} ${industryLabel(shortIndustry(industry))} 결제 비중`} rows={cardAge} />
                  <GenderSplit label="결제" m={cardGender.m} f={cardGender.f} />
                </div>
              )}
            </div>
          </div>
        <details className="tc-details">
          <summary>어떻게 계산했나요</summary>
          <ul>
            <li>지금 단계 <b>{STAGE_LABEL[t.current.stage]}</b> · 최근 4주 vs 직전 4주 {t.current.growth == null ? "–" : `${t.current.growth > 0 ? "+" : ""}${Math.round(t.current.growth * 100)}%`} · 역대 최고 대비 {t.current.rel == null ? "–" : `${Math.round(t.current.rel * 100)}%`} · 정점 {t.peak_week.slice(0, 7)}</li>
            {t.horizons && <li>유지 확률 3개월 {Math.round(t.horizons["13"] * 100)}% · 6개월 {Math.round(t.horizons["26"] * 100)}% · 12개월 {Math.round(t.horizons["52"] * 100)}%</li>}
            <li>반감기(정점 → 절반) {t.halflife_days == null ? "미도달" : `${t.halflife_days}일`}{t.expected_halflife_days ? ` (코리아헤럴드 기사 ${t.expected_halflife_days}일)` : ""}</li>
            <li>그래프: 실선은 실제 검색 지수(이 아이템의 정점=100), 점선과 음영은 앞으로 26주 예측(중앙값과 10~90% 구간)이며 색은 신호, 가는 점선은 유지 기준(지금 수요의 70%)</li>
            <li>3개월·6개월 확률은 "지금 수요의 70% 이상이 남을 확률", 80% 이상 초록 · 50% 미만 빨강</li>
            <li>검색 곡선: 네이버 검색어 트렌드 주간, 2020년~, 앵커 '쿠팡' 평균으로 정규화</li>
            <li>6개월 예측: {trendMeta.model}, 26주 분위수 예측에서 "지금의 70% 이상"일 확률을 읽음 · 라벨 백테스트 AUC {trendMeta.backtest?.auc}, 초록 판정의 실제 유지율 {trendMeta.backtest ? Math.round(trendMeta.backtest.green_precision * 100) : "–"}%</li>
            <li>단계는 매주 그 주까지의 데이터만으로 판정(미래 정보 없음) · 데이터 기준일 {generatedAt}</li>
          </ul>
        </details>
      </div>
    );
  }

  return (
    <section id="trend">
      <SectionHeading title="트렌드 분석" description="이 아이템, 지금 들어가도 될까요?" />
      <form className="search-form" onSubmit={(e) => { e.preventDefault(); search(query); }}>
        <Search size={23} />
        <input aria-label="관심 아이템" list="trend-keywords" placeholder="예: 비빔밥, 탕후루, 두바이 초콜릿" value={query} onChange={(e) => setQuery(e.target.value)} />
        <datalist id="trend-keywords">{trendKeywords.map((k) => <option key={k} value={k} />)}</datalist>
        <button className="primary" type="submit">분석 <ArrowRight size={17} /></button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {fetching && <p className="tc-fetching" role="status">'{fetching}' 검색 곡선을 네이버에서 받아 판정하는 중입니다 (20~30초)…</p>}
      <div className="suggestions">
        {suggestions.map((k) => <button key={k} onClick={() => search(k)}>{k}<ArrowUpRight size={12} /></button>)}
      </div>
      {!t && trending.length > 0 && (
        <div className="tc-trending">
          <div className="tc-block-h"><h4>지금 YouTube에서 뜨는 것</h4></div>
          <div className="tc-trend-grid">
            {trending.map((x) => (
              <button key={x.phrase} className="tc-trend-card" onClick={() => search(x.phrase)} title="클릭하면 검색 곡선으로 판정">
                <div className="tc-trend-top"><b>{x.phrase}</b><small>{x.industry}</small></div>
                <div className="tc-spark">{x.spark.map((v, i) => <i key={i} style={{ height: `${Math.max(8, (v / Math.max(...x.spark, 1)) * 100)}%` }} />)}</div>
                <div className="tc-trend-bot"><span>4주 새 ×{x.ratio.toFixed(1)}</span>{x.signal && <span className="tc-sig" style={{ color: SIGNAL_COLOR[x.signal] }}>● {STAGE_LABEL[x.stage]}</span>}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {body}
    </section>
  );
}
