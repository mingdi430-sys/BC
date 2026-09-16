import React from "react";
import { AGE_GROUPS, GENDER_GROUPS, industryLabel, money, ageLabels, genderLabels } from "../data";

const GENDER_COLOR = { "1": "#2554C7", "2": "#E8398F" };

// 5, 10, 20, 50 ... 단위로 보기 좋은 눈금 간격을 고른다
function niceStep(max) {
  const raw = max / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const norm = raw / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return mult * mag;
}

export function GenderAgeChart({ genderAge, label, industry }) {
  const total = AGE_GROUPS.reduce(
    (s, a) => s + GENDER_GROUPS.reduce((s2, g) => s2 + genderAge[g][a], 0),
    0,
  );
  if (total <= 0) {
    return (
      <p className="chart-narrative">
        {label} {industryLabel(industry)}의 성별·연령 데이터가 없습니다.
      </p>
    );
  }
  const pct = (g, a) => (genderAge[g][a] / total) * 100;
  const ageTotal = AGE_GROUPS.map((a) => GENDER_GROUPS.reduce((s, g) => s + pct(g, a), 0));
  const axisMax = Math.max(niceStep(Math.max(...ageTotal, 1)) * 5, 5);
  const step = niceStep(axisMax);
  const ticks = [];
  for (let t = 0; t <= axisMax + 0.001; t += step) ticks.push(Math.round(t));

  const W = 480, H = 210, padL = 74, padR = 16, padT = 10, padB = 24;
  const chartW = W - padL - padR;
  const rowH = (H - padT - padB) / AGE_GROUPS.length;
  const x0 = padL;
  const xAt = (v) => x0 + (v / axisMax) * chartW;

  const ranked = [];
  GENDER_GROUPS.forEach((g) => AGE_GROUPS.forEach((a) => ranked.push({ g, a, v: pct(g, a) })));
  ranked.sort((a, b) => b.v - a.v);
  const topLabel = (r) => (
    <b className="hl" key={r.g + r.a}>
      {ageLabels[r.a]} {genderLabels[r.g]}
    </b>
  );

  return (
    <>
      <p className="chart-narrative">
        {label} <b>{industryLabel(industry)}</b>은(는) {topLabel(ranked[0])}이 가장 많이 이용하며, 그
        다음은 {topLabel(ranked[1])}, {topLabel(ranked[2])} 순으로 고객 비중이 높게 나타납니다.
      </p>
      <div className="demo-body">
        <svg className="demo-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="성별 연령별 이용 비중">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={xAt(t)} x2={xAt(t)} y1={padT - 4} y2={H - padB} stroke="#e4e6ec" strokeWidth="1" />
              <text x={xAt(t)} y={H - padB + 15} fontSize="9.5" fill="#6B7080" textAnchor="middle">
                {t}
              </text>
            </g>
          ))}
          {AGE_GROUPS.map((a, i) => {
            const yc = padT + rowH * i + rowH / 2;
            const barH = rowH * 0.5;
            const maleW = xAt(pct("1", a)) - x0;
            const femaleW = xAt(pct("2", a)) - x0;
            return (
              <g key={a}>
                <text x={x0 - 10} y={yc + 3.5} fontSize="10.5" fill="#191B22" textAnchor="end" fontWeight="600">
                  {ageLabels[a]}
                </text>
                <rect x={x0} y={yc - barH / 2} width={maleW} height={barH} rx="2" fill={GENDER_COLOR["1"]} />
                <rect x={x0 + maleW} y={yc - barH / 2} width={femaleW} height={barH} rx="2" fill={GENDER_COLOR["2"]} />
              </g>
            );
          })}
        </svg>
        <table className="demo-table">
          <thead>
            <tr>
              <th>항목</th>
              {AGE_GROUPS.map((a) => (
                <th key={a}>{ageLabels[a]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GENDER_GROUPS.map((g) => (
              <tr key={g}>
                <td>
                  <span className="dot" style={{ background: GENDER_COLOR[g] }} />
                  {genderLabels[g]}
                </td>
                {AGE_GROUPS.map((a) => (
                  <td key={a}>{pct(g, a).toFixed(1)}%</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function CountPriceChart({ monthly, months, label, industry }) {
  const monthlyCnt = months.map((m) => monthly[m]?.count || 0);
  const monthlyAmt = months.map((m) => monthly[m]?.amount || 0);
  const avgPrice = months.map((_, i) => (monthlyCnt[i] > 0 ? monthlyAmt[i] / monthlyCnt[i] : 0));
  const monthLabel = (m) => `${m.slice(2, 4)}년 ${m.slice(4)}월`;

  const W = 480, H = 150, padL = 42, padR = 42, padT = 12, padB = 24;
  const chartW = W - padL - padR;
  const n = months.length;
  const gap = chartW / n;
  const barW = gap * 0.5;
  const leftMax = Math.max(niceStep(Math.max(...monthlyCnt, 1)) * 5, 1);
  const rightMax = Math.max(niceStep(Math.max(...avgPrice, 1)) * 5, 1);
  const yFor = (v, max) => H - padB - (v / max) * (H - padT - padB);

  const leftTicks = [];
  for (let t = 0; t <= leftMax + 0.001; t += leftMax / 4) leftTicks.push(Math.round(t));
  const rightTicks = [];
  for (let t = 0; t <= rightMax + 0.001; t += rightMax / 4) rightTicks.push(Math.round(t));

  const points = months.map((m, i) => {
    const x = padL + i * gap + gap / 2;
    const y = yFor(avgPrice[i], rightMax);
    return { x, y };
  });
  const linePath = points.map((p) => `${p.x},${p.y}`).join(" ");

  const last = n - 1, prev = n - 2;
  let narrative = null;
  if (prev >= 0) {
    const priceDiff = avgPrice[last] - avgPrice[prev];
    const pricePct = avgPrice[prev] > 0 ? (priceDiff / avgPrice[prev]) * 100 : null;
    const cntDiff = monthlyCnt[last] - monthlyCnt[prev];
    const cntPct = monthlyCnt[prev] > 0 ? (cntDiff / monthlyCnt[prev]) * 100 : null;
    narrative = (
      <p className="chart-narrative">
        {monthLabel(months[last])} {label} <b>{industryLabel(industry)}</b>의 평균 결제단가는{" "}
        <b className="hl">{Math.round(avgPrice[last]).toLocaleString("ko-KR")}원</b>이며, 이용건수는{" "}
        <b className="hl">{monthlyCnt[last].toLocaleString("ko-KR")}건</b>으로 나타납니다. 결제단가는 전월
        대비{" "}
        <b className={priceDiff >= 0 ? "up" : "down"}>
          {priceDiff >= 0 ? "+" : ""}
          {Math.round(priceDiff).toLocaleString("ko-KR")}원 (
          {pricePct === null ? "—" : `${pricePct >= 0 ? "+" : ""}${pricePct.toFixed(1)}%`}){priceDiff >= 0 ? "↑" : "↓"}
        </b>{" "}
        하였고, 이용건수는{" "}
        <b className={cntDiff >= 0 ? "up" : "down"}>
          {cntDiff >= 0 ? "+" : ""}
          {cntDiff.toLocaleString("ko-KR")}건 (
          {cntPct === null ? "—" : `${cntPct >= 0 ? "+" : ""}${cntPct.toFixed(1)}%`}){cntDiff >= 0 ? "↑" : "↓"}
        </b>{" "}
        한 것으로 나타납니다.
      </p>
    );
  }

  return (
    <>
      {narrative}
      <div className="demo-body">
        <svg className="demo-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="월별 이용건수와 결제단가">
          {leftTicks.map((t, i) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={yFor(t, leftMax)} y2={yFor(t, leftMax)} stroke="#eef0f4" strokeWidth="1" />
              <text x={padL - 7} y={yFor(t, leftMax) + 3.5} fontSize="9" fill="#6B7080" textAnchor="end">
                {t.toLocaleString("ko-KR")}
              </text>
              <text x={W - padR + 7} y={yFor(rightTicks[i] ?? 0, rightMax) + 3.5} fontSize="9" fill="#6B7080" textAnchor="start">
                {(rightTicks[i] ?? 0).toLocaleString("ko-KR")}
              </text>
            </g>
          ))}
          {months.map((m, i) => {
            const x = padL + i * gap + (gap - barW) / 2;
            const h = (monthlyCnt[i] / leftMax) * (H - padT - padB);
            return (
              <g key={m}>
                <rect x={x} y={H - padB - h} width={barW} height={h} rx="2.5" fill="#2554C7" />
                <text x={x + barW / 2} y={H - padB + 15} fontSize="9" fill="#6B7080" textAnchor="middle">
                  {m.slice(4)}월
                </text>
              </g>
            );
          })}
          <polyline points={linePath} fill="none" stroke="#0FA5A5" strokeWidth="2" />
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="2.8" fill="#fff" stroke="#0FA5A5" strokeWidth="1.6" />
          ))}
        </svg>
        <table className="demo-table">
          <thead>
            <tr>
              <th>항목</th>
              {months.map((m) => (
                <th key={m}>{monthLabel(m)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <span className="dot" style={{ background: "#2554C7" }} />
                이용건수
              </td>
              {monthlyCnt.map((v, i) => (
                <td key={i}>{v.toLocaleString("ko-KR")}건</td>
              ))}
            </tr>
            <tr>
              <td>
                <span className="dot" style={{ background: "#0FA5A5" }} />
                결제단가
              </td>
              {avgPrice.map((v, i) => (
                <td key={i}>{Math.round(v).toLocaleString("ko-KR")}원</td>
              ))}
            </tr>
            <tr>
              <td>
                <span className="dot" style={{ background: "#c2c7d2" }} />
                결제금액
              </td>
              {monthlyAmt.map((v, i) => (
                <td key={i}>{money(v)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
