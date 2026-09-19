import React, { useMemo, useState } from "react";
import { Info } from "lucide-react";

import { CommercialAnalysis } from "./components/DataCommercial";
import { TrendAnalysis } from "./components/TrendAnalysis";
import { ChatPanel } from "./components/ChatPanel";
import { getRecords, resolveRegion } from "./data";
export default function App() {
  const [industry, setIndustry] = useState(""),
    [selected, setSelected] = useState(""),
    [view, setView] = useState(window.location.hash === "#trend" ? "trend" : "commercial"),
    [province, setProvinceState] = useState(""),
    [metric, setMetric] = useState("amount");

  const all = useMemo(() => getRecords(industry), [industry]);
  const region = resolveRegion(all, selected);

  function setProvince(p) {
    setProvinceState(p);
    setSelected("");
  }
  function choose(id) {
    setSelected(id);
    if (id) {
      const target = resolveRegion(all, id);
      if (target) setProvinceState(target.province);
    }
  }
  function chooseIndustry(value) {
    setIndustry(value);
    setSelected("");
  }
  return (
    <>
      <header>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setView("commercial");
          }}
        >
          <span className="signal-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <strong>신호등</strong>
          <span className="brand-description">상권의 흐름을 읽는 신호</span>
        </a>
        <nav>
          <a
            href="#commercial"
            className={view === "commercial" ? "active" : ""}
            onClick={(e) => {
              e.preventDefault();
              setView("commercial");
            }}
          >
            상권 분석
          </a>
          <a
            href="#trend"
            className={view === "trend" ? "active" : ""}
            onClick={(e) => {
              e.preventDefault();
              setView("trend");
            }}
          >
            트렌드 분석
          </a>
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
        <div className={`app-layout ${industry ? "" : "no-chat"}`}>
          {view === "commercial" ? (
            <CommercialAnalysis
              industry={industry}
              setIndustry={chooseIndustry}
              selected={selected}
              setSelected={choose}
              province={province}
              setProvince={setProvince}
              metric={metric}
              setMetric={setMetric}
              all={all}
              region={region}
            />
          ) : (
            <TrendAnalysis industry={industry} selected={selected} />
          )}
          {industry ? (
            <ChatPanel
              industry={industry}
              setIndustry={chooseIndustry}
              selected={selected}
              setSelected={choose}
              province={province}
              metric={metric}
              setMetric={setMetric}
              all={all}
              region={region}
              view={view}
            />
          ) : null}
        </div>
        <div className="data-disclaimer">
          <Info size={16} />
          <p>
            상권 분석은 제공된 ABP_CONTEST_DATA.csv의 2026년 1~6월 집계입니다.
            금액은 원 단위입니다. 점포 수는 소상공인시장진흥공단 상가(상권)정보(2026.06)를
            업종별로 근사 매칭한 값입니다. 트렌드 분석은 네이버 검색어 트렌드 곡선(2020년~)과
            YouTube 급등 후보, TimesFM 6개월 예측을 사용하며 상권 데이터와 기간·출처가 다릅니다.
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
