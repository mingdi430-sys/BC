import React from "react";
import { STAGE_INDEX, STAGE_LABEL, STAGE_TEXT } from "../trend";

const LABELS = ["초기", "성장", "급성장", "정점", "하락", "안정"];

// stage: 엔진 C 규칙 단계(emerging/surging/peak/declining/stable) → 6단계 곡선 위 위치
export function TrendLifecycle({ stage, keyword, rel = null, peakWeek = "" }) {
  const cur = STAGE_INDEX[stage] ?? 5;
  const afterFad = stage === "stable" && rel != null && rel < 0.25;
  const coords = [[45, 137], [173, 101], [301, 38], [429, 23], [557, 94], [685, 124]];
  return (
    <div className="lifecycle">
      <div>
        <span className="eyebrow">TREND LIFECYCLE</span>
        <h3>지금, 흐름의 어느 지점일까요?</h3>
        <p>
          <strong>{keyword}</strong>의 현재 단계는 <b className="green">{STAGE_LABEL[stage]}</b>입니다.
          <br />{afterFad ? `유행이 지나간 뒤 정점(${peakWeek.slice(0, 7)})의 ${Math.round(rel * 100)}% 수준에서 안정됐습니다.` : STAGE_TEXT[stage]}
        </p>
        <small className="lifecycle-note">단계는 최근 4주 성장률·가속·최고치 대비 수준으로 매주 판정하며, 미래 데이터는 쓰지 않습니다.</small>
      </div>
      <div className="lifecycle-visual">
        <svg viewBox="0 0 730 195" role="img" aria-label={`트렌드 생애주기: 현재 ${STAGE_LABEL[stage]}`}>
          <path d="M45 137 C130 138 180 108 230 72 S330 9 405 20 S481 54 526 79 S596 128 685 124" fill="none" stroke="#c8d0dd" strokeWidth="3" />
          {coords.map(([x, y], i) => (
            <g key={i}>
              {i === cur && <circle cx={x} cy={y} r="17" fill="#d0d8e4" />}
              <circle cx={x} cy={y} r={i === cur ? 7 : 4} fill={i === cur ? "#1c3968" : "#a9b6cb"} />
              <text x={x} y="174" textAnchor="middle" fill={i === cur ? "#1c3968" : "#7989a3"} fontWeight={i === cur ? 700 : 400}>{LABELS[i]}</text>
              {i === cur && <text x={x} y={y - 25} textAnchor="middle" className="current-label">현재 위치</text>}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
