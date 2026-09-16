import React, { useState } from "react";
import { Info } from "lucide-react";

import { CommercialAnalysis } from "./components/DataCommercial";
import { TrendAnalysis } from "./components/TrendAnalysis";
export default function App() {
  const [industry, setIndustry] = useState(""),
    [selected, setSelected] = useState("");
  return (
    <>
      <header>
        <a href="#" className="brand">
          <span className="signal-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <strong>신호등</strong>
          <span className="brand-description">상권의 흐름을 읽는 신호</span>
        </a>
        <nav>
          <a href="#commercial">상권 분석</a>
          <a href="#trend">트렌드 분석</a>
        </nav>
        <span className="demo-badge">
          <i />
          공모전 DEMO
        </span>
      </header>
      <main>
        <div className="page-intro">
          <span>DATA INTO PERSPECTIVE</span>
          <p>좋은 시작을 위한, 데이터의 새로운 관점.</p>
          <span className="data-badge">BC카드 소비 × 검색 트렌드</span>
        </div>
        <CommercialAnalysis
          industry={industry}
          setIndustry={setIndustry}
          selected={selected}
          setSelected={setSelected}
        />
        <TrendAnalysis industry={industry} selected={selected} />
        <div className="data-disclaimer">
          <Info size={16} />
          <p>
            상권 분석은 제공된 ABP_CONTEST_DATA.csv의 2026년 1~6월 집계입니다.
            금액은 원 단위입니다. 검색 트렌드와 예측만 별도 시연 데이터입니다.
          </p>
        </div>
      </main>
      <footer>
        <a className="brand" href="#">
          <span className="signal-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <strong>신호등</strong>
          <span>창업의 다음 걸음, 데이터의 신호로.</span>
        </a>
        <small>
          © 2026 SINHODEUNG. Read the signals, understand the market.
        </small>
      </footer>
    </>
  );
}
