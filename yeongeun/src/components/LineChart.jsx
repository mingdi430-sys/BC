import React from "react";
export function LineChart({ values, future, unit = "억 원" }) {
  const w = 800,
    h = 235,
    left = 44,
    top = 22,
    bottom = 200;
  const all = future ? [...values, ...future.slice(1)] : values,
    max = future ? 100 : Math.ceil((Math.max(...all) * 1.1) / 5) * 5;
  const step = (w - left - 20) / (all.length - 1),
    point = (v, i) =>
      `${left + i * step},${bottom - (v / max) * (bottom - top)}`,
    path = values.map((v, i) => (i ? "L" : "M") + point(v, i)).join(" ");
  let split = left + (values.length - 1) * step;
  return (
    <svg
      className="line-chart"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={
        future
          ? "관심도 추이: 실선은 과거 시연값, 점선은 미래 예측 시연값"
          : "최근 6개월 월별 소비 추이"
      }
    >
      <defs>
        <linearGradient
          id={future ? "trendFill" : "regionFill"}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0%" stopColor="#2f61b2" stopOpacity=".15" />
          <stop offset="100%" stopColor="#2f61b2" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line
            x1={left}
            y1={top + (i * (bottom - top)) / 4}
            x2={780}
            y2={top + (i * (bottom - top)) / 4}
            stroke="#e0e5ed"
            strokeDasharray="3 4"
          />
          <text x="0" y={top + (i * (bottom - top)) / 4 + 4} className="axis">
            {+(max * (1 - i / 4)).toFixed(1)}
          </text>
        </g>
      ))}
      {future && (
        <>
          <rect
            x={split}
            y="6"
            width={780 - split}
            height={bottom - 6}
            fill="#e8ecf2"
          />
          <text x={split + 17} y="27" className="forecast-label">
            예측 구간
          </text>
          <line
            x1={split}
            y1="6"
            x2={split}
            y2={bottom}
            stroke="#91a1bb"
            strokeDasharray="4 4"
          />
        </>
      )}
      <path
        d={`${path} L${split},${bottom} L${left},${bottom} Z`}
        fill={`url(#${future ? "trendFill" : "regionFill"})`}
      />
      <path
        d={path}
        stroke="#244986"
        strokeWidth="3"
        strokeLinejoin="round"
        fill="none"
      />
      {future && (
        <path
          d={future
            .map((v, i) => (i ? "L" : "M") + point(v, values.length - 1 + i))
            .join(" ")}
          fill="none"
          stroke="#3166ba"
          strokeWidth="3"
          strokeDasharray="7 6"
        />
      )}
      {values.map((v, i) => (
        <circle
          key={i}
          cx={left + i * step}
          cy={bottom - (v / max) * (bottom - top)}
          r={future ? 2.5 : 4}
          fill="#fff"
          stroke="#244986"
          strokeWidth="2"
        >
          <title>
            {future ? `${i + 1}번째 월` : `2026년 ${i + 3}월`}: {v} {unit}
          </title>
        </circle>
      ))}
      {(future
        ? ["25.09", "25.12", "26.03", "26.06", "26.08", "26.11"]
        : ["3월", "4월", "5월", "6월", "7월", "8월"]
      ).map((m, i, arr) => (
        <text
          key={m}
          x={
            future
              ? left + [0, 3, 6, 9, 11, 14][i] * step
              : left + i * (736 / (arr.length - 1))
          }
          y="226"
          textAnchor="middle"
          className="axis"
        >
          {m}
        </text>
      ))}
    </svg>
  );
}
