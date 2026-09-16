import React, { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Search,
  ChartNoAxesCombined,
  MoveUpRight,
  Leaf,
  Info,
} from "lucide-react";
import { trends, stages } from "../mockData";
import { getRecords, signed, direction, resolveRegion, industryLabel } from "../data";
import { SectionHeading, shortIndustry } from "./Shared";
import { TrendChart } from "./TrendChart";
import { TrendLifecycle } from "./TrendLifecycle";
export function TrendAnalysis({ industry, selected }) {
  const [query, setQuery] = useState(""),
    [keyword, setKeyword] = useState(""),
    [error, setError] = useState("");
  const trend = trends[keyword];
  function search(value) {
    const clean = value.trim();
    if (!trends[clean]) {
      setError(
        clean
          ? "현재 시연에서는 말차, 베이글, 그릭요거트를 분석할 수 있어요."
          : "분석할 아이템을 입력해주세요.",
      );
      return;
    }
    setKeyword(clean);
    setQuery(clean);
    setError("");
  }
  const region = resolveRegion(getRecords(industry), selected);
  return (
    <section id="trend">
      <SectionHeading
        number="02"
        title="트렌드 분석"
        description="관심 있는 메뉴나 아이템, 지금 어떤 흐름일까요?"
      />
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
      >
        <Search size={23} />
        <input
          aria-label="관심 아이템"
          placeholder="말차, 베이글, 그릭요거트 등"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="primary" type="submit">
          분석 <ArrowRight size={17} />
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="suggestions">
        <span>탐색 키워드</span>
        {Object.keys(trends).map((k) => (
          <button key={k} onClick={() => search(k)}>
            {k}
            <ArrowUpRight size={12} />
          </button>
        ))}
      </div>
      {trend ? (
        <div className="trend-result" aria-live="polite">
          <div className="trend-summary">
            <div>
              <span className="eyebrow">KEYWORD INSIGHT</span>
              <h3>
                {keyword}
                <span className="stage-badge">
                  <Leaf size={13} />
                  {stages[trend.stage]}
                </span>
              </h3>
            </div>
            <div className="trend-change">
              <small>최근 관심도 변화 · 전월 대비</small>
              <strong>
                +{trend.change}
                <span>%</span>
                <MoveUpRight size={23} />
              </strong>
            </div>
          </div>
          <TrendChart trend={trend} />
          <p className="forecast-note">
            <Info size={14} /> 관측값과 예측값 모두 시연용 데이터이며, 예측은
            실제 미래 결과를 보장하지 않습니다.
          </p>
          <TrendLifecycle trend={trend} keyword={keyword} />
          {region?.hasData && industry && (
            <div className="combined">
              <div>
                <span className="eyebrow">CONNECT THE DOTS</span>
                <h3>
                  함께 살펴보기 <ArrowUpRight size={20} />
                </h3>
                <p>
                  상권은 CSV 집계(2026년 1~6월), 트렌드는 가상 시연값입니다.
                  기간과 출처가 다릅니다.
                </p>
              </div>
              <div className="combined-facts">
                <div>
                  <span>
                    {region.province} {region.name} {industryLabel(shortIndustry(industry))}{" "}
                    소비
                  </span>
                  <strong>
                    {direction(region.growth)}{" "}
                    <small>{signed(region.growth)}</small>
                  </strong>
                </div>
                <div>
                  <span>{keyword} 검색 관심도</span>
                  <strong>
                    최근 증가 <small>+{trend.change}%</small>
                  </strong>
                </div>
                <div>
                  <span>{keyword} 트렌드 단계</span>
                  <strong>{stages[trend.stage]}</strong>
                </div>
              </div>
              <small>
                서로 다른 데이터의 흐름을 함께 표시한 것으로, 인과관계나 창업
                성과를 의미하지 않습니다.
              </small>
            </div>
          )}
        </div>
      ) : (
        <div className="trend-empty">
          <ChartNoAxesCombined size={28} />
          <div>
            <h3>관심에서 시작해, 흐름을 발견하세요.</h3>
            <p>
              키워드를 검색하면 관심도 추이와 트렌드 생애주기를 함께 보여드려요.
            </p>
          </div>
          <span>SEARCH → DISCOVER</span>
        </div>
      )}
    </section>
  );
}
