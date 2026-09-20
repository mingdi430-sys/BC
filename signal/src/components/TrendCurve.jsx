import React, { useState } from "react";
import { trendWeeks, idx, AGE_LABEL, recentMean } from "../trend";

const STAGE_FILL = { emerging: "#1E9C58", surging: "#D99A06", peak: "#D4413A", declining: "#D4413A" };

function argmax(arr) {
  let bi = -1, bv = -Infinity;
  (arr || []).forEach((v, i) => { if (v != null && v > bv) { bv = v; bi = i; } });
  return bi;
}

// 주간 곡선 + (선택) 26주 예측 부채꼴 + (선택) 단계 띠. 모든 시리즈는 xweeks 인덱스 기준.
export function Curve({ series, xweeks = trendWeeks, from = 0, h = 260, bands = [], peakIdx = null, todayIdx = null, todayLabel = "오늘", compact = false, refY = null, refLabel = "", refFrom = null }) {
  const [hover, setHover] = useState(null);
  const W = compact ? 400 : 900, H = h, m = { t: 16, r: 14, b: 26, l: 42 };
  const n = xweeks.length;
  const xs = (i) => m.l + ((i - from) / (n - 1 - from)) * (W - m.l - m.r);
  let max = 0;
  series.forEach((s) => (s.band ? s.band.hi : s.values).forEach((v, i) => { if (i >= from && v != null && v > max) max = v; }));
  if (!(max > 0)) max = 1;
  const ys = (v) => m.t + (1 - v / max) * (H - m.t - m.b);
  const ticks = [0, 1, 2, 3, 4].map((k) => (max * k) / 4);
  const years = [];
  for (let i = from; i < n; i++) if (xweeks[i].slice(5, 7) === "01" && (i === from || xweeks[i - 1].slice(0, 4) !== xweeks[i].slice(0, 4))) years.push(i);
  const pathOf = (vals, dash) => {
    let d = "", pen = false;
    vals.forEach((v, i) => { if (i < from) return; if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${xs(i).toFixed(1)} ${ys(v).toFixed(1)} `; pen = true; });
    return d;
  };
  return (
    <div className="tc-wrap">
      <svg className="tc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="검색 지수 추이"
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; let i = Math.round(from + ((px - m.l) / (W - m.l - m.r)) * (n - 1 - from)); i = Math.max(from, Math.min(n - 1, i)); setHover(i); }}
        onMouseLeave={() => setHover(null)}>
        {bands.map((b, k) => b.to >= from && <rect key={k} x={xs(Math.max(b.from, from))} y={m.t} width={Math.max(0, xs(b.to) - xs(Math.max(b.from, from)))} height={H - m.t - m.b} fill={b.color} opacity=".14" />)}
        {ticks.map((v, k) => <g key={k}><line x1={m.l} x2={W - m.r} y1={ys(v)} y2={ys(v)} stroke="#e0e5ed" strokeDasharray="3 4" /><text x={m.l - 6} y={ys(v) + 4} textAnchor="end" className="axis">{idx(v)}</text></g>)}
        {years.map((i) => <g key={i}><line x1={xs(i)} x2={xs(i)} y1={m.t} y2={H - m.b} stroke="#e8ecf2" /><text x={xs(i) + 4} y={H - m.b + 15} className="axis">{xweeks[i].slice(0, 4)}</text></g>)}
        {series.map((s, k) => {
          if (s.band) {
            const ii = []; s.band.hi.forEach((v, i) => { if (i >= from && v != null && s.band.lo[i] != null) ii.push(i); });
            if (!ii.length) return null;
            const up = ii.map((i) => `${xs(i).toFixed(1)} ${ys(s.band.hi[i]).toFixed(1)}`).join(" L ");
            const dn = ii.slice().reverse().map((i) => `${xs(i).toFixed(1)} ${ys(s.band.lo[i]).toFixed(1)}`).join(" L ");
            return <path key={k} d={`M ${up} L ${dn} Z`} fill={s.color} opacity=".16" />;
          }
          const d = pathOf(s.values);
          return <g key={k}>
            {s.fill && <path d={`${d}L${xs(lastIdx(s.values, from))} ${H - m.b} L${xs(from)} ${H - m.b} Z`} fill={s.color} opacity=".09" />}
            <path d={d} fill="none" stroke={s.color} strokeWidth={s.width || 2.2} strokeLinejoin="round" strokeDasharray={s.dash ? "6 4" : undefined} />
          </g>;
        })}
        {peakIdx != null && peakIdx >= from && series[0].values[peakIdx] != null && <g>
          <circle cx={xs(peakIdx)} cy={ys(series[0].values[peakIdx])} r="5" fill={series[0].color} stroke="#fff" strokeWidth="2" />
          <text x={xs(peakIdx) + (xs(peakIdx) > W - 110 ? -8 : 8)} y={ys(series[0].values[peakIdx]) - 8} textAnchor={xs(peakIdx) > W - 110 ? "end" : "start"} className="axis" fontWeight="600">정점 {xweeks[peakIdx].slice(0, 7)}</text>
        </g>}
        {refY != null && refFrom != null && <g>
          <line x1={xs(refFrom)} x2={xs(n - 1)} y1={ys(refY)} y2={ys(refY)} stroke="#9aa8bd" strokeDasharray="3 3" strokeWidth="1" opacity=".8" />
          {refLabel && <text x={xs(n - 1)} y={ys(refY) - 5} textAnchor="end" className="axis">{refLabel}</text>}
        </g>}
        {todayIdx != null && <g><line x1={xs(todayIdx)} x2={xs(todayIdx)} y1={m.t} y2={H - m.b} stroke="#91a1bb" strokeDasharray="4 4" /><text x={xs(todayIdx) + 4} y={m.t + 10} className="forecast-label">{todayLabel}</text></g>}
        {hover != null && <line x1={xs(hover)} x2={xs(hover)} y1={m.t} y2={H - m.b} stroke="#7e8ea8" strokeDasharray="2 3" />}
      </svg>
      {hover != null && <div className="tc-tip" style={{ left: `${(xs(hover) / W) * 100}%` }}>
        <b>{xweeks[hover]} 주</b>{series.filter((s) => !s.band).map((s, k) => <span key={k}>{s.name}: {s.values[hover] == null ? "–" : idx(s.values[hover])}</span>)}
      </div>}
    </div>
  );
}
function lastIdx(vals, from) { for (let i = vals.length - 1; i >= from; i--) if (vals[i] != null) return i; return from; }

export function stageBands(rle, minWeeks = 3) {
  const out = []; let i = 0;
  rle.forEach(([s, n]) => { if (s !== "stable" && n >= minWeeks) out.push({ from: i, to: i + n - 1, color: STAGE_FILL[s] }); i += n; });
  return out;
}

// 전체·성별·연령·지역 탭
export function TrendCurvePanel({ keyword, t }) {
  const [view, setView] = useState("all");
  const fc = t.forecast;
  const XW = fc ? trendWeeks.concat(fc.weeks) : trendWeeks;
  const pad = fc ? fc.weeks.map(() => null) : [];
  const hist = trendWeeks.map(() => null);
  const peakIdx = trendWeeks.indexOf(t.peak_week);
  const from3y = Math.max(0, trendWeeks.length - 156);
  const tabs = [["all", "전체 곡선"], ["gender", "성별"], ["age", "연령별"], ["region", "지역 시차"]];
  return (
    <div className="trend-graph">
      <div className="chart-title">
        <h4>검색 지수 추이</h4>
        <div className="chart-key">
          <span><i />관측값</span>
          {fc && <span><i className="dashed" />예측 중앙값 · 음영 10~90%</span>}
          <small>네이버 검색어 트렌드 · 주간 · 쿠팡 평균=100</small>
        </div>
      </div>
      <div className="tc-tabs" role="tablist">
        {tabs.map(([v, l]) => <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{l}</button>)}
      </div>
      {view === "all" && <>
        <Curve series={[
          { name: keyword, color: "#244986", values: t.all.concat(pad), fill: true },
          ...(fc ? [{ name: "예측 구간", color: "#3166ba", band: { lo: hist.concat(fc.q10), hi: hist.concat(fc.q90) } },
            { name: "예측 중앙값", color: "#3166ba", values: hist.slice(0, -1).concat([t.all[t.all.length - 1]]).concat(fc.median), dash: true }] : []),
        ]} xweeks={XW} bands={stageBands(t.stages)} peakIdx={peakIdx} todayIdx={fc ? trendWeeks.length - 1 : null} h={280} />
        <p className="forecast-note">색 띠는 그 주까지의 데이터만으로 내린 단계 판정(초록 태동, 노랑 급등, 빨강 정점·하락, 3주 이상 지속분). 예측은 TimesFM 2.5 zero-shot.</p>
      </>}
      {view === "gender" && <>
        <Curve series={[{ name: "남성", color: "#2554C7", values: t.gender.m }, { name: "여성", color: "#E8398F", values: t.gender.f }]} h={260} />
        <p className="forecast-note">세그먼트별 별도 요청이라 절대 수준은 전체 곡선과 다를 수 있습니다.</p>
      </>}
      {view === "age" && <div className="tc-multi">
        {["1", "2", "3", "4", "5", "6"].map((a, i) => <div key={a} className="tc-cell">
          <div className="tc-cell-t"><span>{AGE_LABEL[a]}</span><small>최근 26주 평균 {idx(recentMean(t.age[a]))}</small></div>
          <Curve series={[{ name: AGE_LABEL[a], color: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"][i], values: t.age[a], fill: true }]} from={from3y} h={120} compact />
        </div>)}
        <p className="forecast-note">최근 3년, 칸마다 세로축 개별 척도.</p>
      </div>}
      {view === "region" && <div className="tc-multi">
        {["서울", "부산", "대구", "광주", "대전"].map((r, i) => {
          const v = t.region[r]; if (!v) return <div key={r} className="tc-cell"><div className="tc-cell-t"><span>{r}</span></div><p className="forecast-note">미수집</p></div>;
          const p = argmax(v), sp = t.region["서울"] ? argmax(t.region["서울"]) : null;
          const lag = sp == null || r === "서울" ? null : p - sp;
          return <div key={r} className="tc-cell">
            <div className="tc-cell-t"><span>{r}</span><small>정점 {trendWeeks[p].slice(0, 7)}{lag == null ? "" : ` · 서울 대비 ${lag > 0 ? "+" : ""}${lag}주`}</small></div>
            <Curve series={[{ name: `${r} ${keyword}`, color: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"][i], values: v, fill: true }]} from={from3y} h={120} compact peakIdx={p} />
          </div>;
        })}
        <p className="forecast-note">"지역명 + 아이템" 검색 곡선(최근 3년). 정점 시점 차이로 지역 시차를 봅니다.</p>
      </div>}
    </div>
  );
}
