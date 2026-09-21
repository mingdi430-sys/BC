import React, { useMemo, useState } from "react";

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
          <img className="brand-logo" src="/logo-icon.svg" alt="" aria-hidden="true" />
          <strong>
            Market<span>Signal</span>
          </strong>
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
      </header>
      <main>
        <div className={`app-layout ${industry && view === "commercial" ? "" : "no-chat"}`}>
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
            <TrendAnalysis industry={industry} selected={selected} goCommercial={() => setView("commercial")} />
          )}
          {industry && view === "commercial" ? (
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
      </main>
      <footer>
        <a className="brand" href="#">
          <img className="brand-logo" src="/logo-icon.svg" alt="" aria-hidden="true" />
          <strong>
            Market<span>Signal</span>
          </strong>
        </a>
        <small>
          © 2026 MarketSignal. Read the signals, understand the market.
        </small>
      </footer>
    </>
  );
}
