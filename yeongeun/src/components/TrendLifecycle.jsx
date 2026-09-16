import React from "react";
import { stages } from "../mockData";
export function TrendLifecycle({ trend, keyword }) {
  const coords = [
    [45, 137],
    [173, 101],
    [301, 38],
    [429, 23],
    [557, 94],
    [685, 124],
  ];
  return (
    <div className="lifecycle">
      <div>
        <span className="eyebrow">TREND LIFECYCLE</span>
        <h3>지금, 흐름의 어느 지점일까요?</h3>
        <p>
          <strong>{keyword}</strong>의 현재 단계는{" "}
          <b className="green">{stages[trend.stage]}</b>입니다.
          <br />
          {trend.stage === 5
            ? "관심도가 비교적 일정하게 유지되고 있습니다."
            : "최근 검색 관심도가 지속적으로 증가하고 있습니다."}
        </p>
      </div>
      <div className="lifecycle-visual">
        <svg
          viewBox="0 0 730 195"
          role="img"
          aria-label={`트렌드 생애주기: 현재 ${stages[trend.stage]}`}
        >
          <path
            d="M45 137 C130 138 180 108 230 72 S330 9 405 20 S481 54 526 79 S596 128 685 124"
            fill="none"
            stroke="#c8d0dd"
            strokeWidth="3"
          />
          {coords.map(([x, y], i) => (
            <g key={i}>
              {i === trend.stage && (
                <circle cx={x} cy={y} r="17" fill="#d0d8e4" />
              )}
              <circle
                cx={x}
                cy={y}
                r={i === trend.stage ? 7 : 4}
                fill={i === trend.stage ? "#1c3968" : "#a9b6cb"}
              />
              <text
                x={x}
                y="174"
                textAnchor="middle"
                fill={i === trend.stage ? "#1c3968" : "#7989a3"}
                fontWeight={i === trend.stage ? 700 : 400}
              >
                {stages[i]}
              </text>
              {i === trend.stage && (
                <text
                  x={x}
                  y={y - 25}
                  textAnchor="middle"
                  className="current-label"
                >
                  현재 위치
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
