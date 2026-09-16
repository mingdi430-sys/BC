import React from "react";
import { LineChart } from "./LineChart";
export function TrendChart({ trend }) {
  return (
    <div className="trend-graph">
      <div className="chart-title">
        <h4>검색 관심도 추이</h4>
        <div className="chart-key">
          <span>
            <i />
            과거 관측값
          </span>
          <span>
            <i className="dashed" />
            예측값
          </span>
          <small>상대 관심도 · 시연 데이터</small>
        </div>
      </div>
      <LineChart values={trend.values} future={trend.future} unit="관심도" />
    </div>
  );
}
