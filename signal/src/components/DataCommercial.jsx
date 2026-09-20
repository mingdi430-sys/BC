import React, { useState, useMemo } from "react";
import { ArrowRight, ArrowUpRight, MapPin, Info } from "lucide-react";
import { SectionHeading, IndustryModal } from "./Shared";
import {
  meta,
  industries,
  provinces,
  months,
  period,
  money,
  signed,
  metrics,
  metricText,
  topRegions,
  industryLabel,
  genderAgeFor,
  densityMeta,
  opportunityRegions,
  subcategoryMix,
} from "../data";
import { GenderAgeChart, CountPriceChart } from "./DemoCharts";
import { municipalityGroups, municipalityName } from "../data";
import { MapPanel } from "./GeoMapPanel";
import { SubcategoryMix } from "./SubcategoryMix";
export function RegionInfoPanel({
  records,
  region,
  setSelected,
  industry,
  province,
}) {
  const [sort, setSort] = useState("amount");
  const [onlyOpportunity, setOnlyOpportunity] = useState(false);
  const opportunity = useMemo(() => opportunityRegions(records), [records]);
  if (!region)
    return (
      <aside className="region-info">
        <span className="eyebrow">REGIONAL OVERVIEW</span>
        <h3>지역별 상권 현황</h3>
        <p className="muted">
          {province || "전국"} · {records.length}개 지역 · 업종 자료{" "}
          {records.filter((r) => r.hasData).length}개
        </p>
        <div className="sort-tabs">
          {Object.entries(metrics).map(([k, v]) => (
            <button
              className={k === sort ? "active" : ""}
              onClick={() => setSort(k)}
              key={k}
            >
              {v}순
            </button>
          ))}
        </div>
        <label className="opportunity-toggle">
          <input
            type="checkbox"
            checked={onlyOpportunity}
            onChange={(e) => setOnlyOpportunity(e.target.checked)}
          />
          기회 후보만 보기 <small>({opportunity.regions.length}곳)</small>
        </label>
        {onlyOpportunity && (
          <p className="opportunity-note">
            6개월 결제금액 추세가 이 범위 평균보다 월 몇 %p 빠른지(오른쪽 숫자)와 점포당 결제금액 상위 25%
            {opportunity.threshold != null &&
              `(${money(Math.round(opportunity.threshold))} 이상)`}
            인 지역입니다. 점포 수는 근사 매칭이며 자료 월이 적거나 점포
            10개 미만인 지역은 제외했습니다. 참고용 필터이지 창업 가능 판정이 아닙니다.
          </p>
        )}
        <div className="region-list">
          {(onlyOpportunity ? opportunity.regions : [...records])
            .sort(
              (a, b) =>
                (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity) ||
                a.id.localeCompare(b.id, "ko"),
            )
            .map((r) => (
              <button key={r.id} onClick={() => setSelected(r.id)}>
                <div>
                  <strong>{r.name}</strong>
                  <small>
                    {r.province} · {metricText(r, sort)}
                  </small>
                </div>
                {onlyOpportunity && r.excessTrend != null ? (
                  <span className="green">
                    추세 +{(r.excessTrend * 100).toFixed(1)}%p
                  </span>
                ) : (
                  <span className={r.growth < 0 ? "negative" : "green"}>
                    {signed(r.growth)}
                  </span>
                )}
                <ArrowRight size={14} />
              </button>
            ))}
        </div>
        <small className="list-note">
          시 전체는 하위 구를 합산하고, 구·군은 원자료 단위로 표시합니다.
        </small>
      </aside>
    );
  if (!region.hasData)
    return (
      <aside className="region-info">
        <span className="eyebrow">{region.province}</span>
        <h3>
          {region.name} · {industryLabel(industry)}
        </h3>
        <p>선택 업종의 자료가 없습니다.</p>
        <p className="muted">
          지역은 CSV에 존재하지만 이 업종의 행은 없습니다. 결제금액 0으로
          해석하지 않습니다.
        </p>
        <button className="text-button" onClick={() => setSelected("")}>
          ← 지역 전체 보기
        </button>
      </aside>
    );
  return (
    <aside className="region-info">
      <button className="text-button" onClick={() => setSelected("")}>
        ← 지역 전체 보기
      </button>
      <div className="region-title">
        <span className="eyebrow">{region.province}</span>
        <h3>
          {region.name}
          <span> · {industryLabel(industry)}</span>
        </h3>
      </div>
      <div className="main-stat">
        <span>기간 결제금액 합계 · {period}</span>
        <strong>{money(region.amount)}</strong>
        <p className={region.growth < 0 ? "negative" : "green"}>
          {signed(region.growth)} <span>6월 금액 / 5월 대비</span>
        </p>
      </div>
      <dl>
        <div>
          <dt>기간 결제 건수</dt>
          <dd>{region.count.toLocaleString("ko-KR")}건</dd>
        </div>
        <div>
          <dt>건당 결제금액</dt>
          <dd>
            {region.count
              ? Math.round(region.amount / region.count).toLocaleString("ko-KR")
              : "산출 불가"}
          </dd>
        </div>
        <div>
          <dt>점포 수 (상가정보)</dt>
          <dd>
            {region.stores != null
              ? `${region.stores.toLocaleString("ko-KR")}개`
              : "자료 없음"}
          </dd>
        </div>
        <div>
          <dt>점포당 결제금액</dt>
          <dd>
            {region.amountPerStore != null
              ? money(Math.round(region.amountPerStore))
              : "산출 불가"}
          </dd>
        </div>
        <div>
          <dt>자료가 있는 월</dt>
          <dd>
            {Object.keys(region.monthly).length} / {months.length}개월
          </dd>
        </div>
        <div>
          <dt>기간 전체 증감률</dt>
          <dd className={region.periodGrowth < 0 ? "negative" : ""}>
            {signed(region.periodGrowth)}
            <small> · 1월/6월 대비</small>
          </dd>
        </div>
        {!region.isAggregate && region.nationalRank && (
          <div>
            <dt>전국 동일 업종 순위</dt>
            <dd>
              {region.nationalRank}위 / {region.nationalTotal}개 지역
            </dd>
          </div>
        )}
      </dl>
      <p className="supply-note">
        점포 수: 소상공인시장진흥공단 상가(상권)정보 {densityMeta.stdrYm.slice(0, 4)}.
        {densityMeta.stdrYm.slice(4)} 기준. 업종 매칭은 근사치
        {densityMeta.mapping[industry] ? ` (${densityMeta.mapping[industry]})` : ""}
        이며, 점포당 결제금액이 높을수록 수요 대비 점포가 적다는 뜻입니다.
      </p>
      {region.lowSample && (
        <p className="low-sample-warn">
          <Info size={14} /> 6개월 중 자료가 있는 달이 2개월 이하로 표본이
          작습니다. 참고용으로만 활용하세요.
        </p>
      )}
      <div className="insight">
        <Info size={17} />
        <p>
          {region.growth == null
            ? "최근 두 달을 비교할 수 있는 자료가 부족합니다."
            : `6월 결제금액은 5월보다 ${Math.abs(region.growth).toFixed(1)}% ${region.growth >= 0 ? "증가" : "감소"}했습니다.`}{" "}
          {region.isAggregate
            ? "시 전체는 CSV의 하위 구 " +
              region.memberIds.length +
              "개를 합산합니다. 자료가 있는 구: " +
              region.availableMembers +
              "개."
            : "지역은 CSV의 “" + region.name + "” 단위를 그대로 사용합니다."}
        </p>
      </div>
      <TopRegionsTable records={records} selectedId={region.id} />
    </aside>
  );
}
function TopRegionsTable({ records, selectedId }) {
  const top = topRegions(records, 8);
  if (!top.length) return null;
  return (
    <div className="top-regions">
      <span className="eyebrow">이 범위 내 결제액 상위 지역</span>
      <table>
        <tbody>
          {top.map((r, i) => (
            <tr key={r.id} className={r.id === selectedId ? "active" : ""}>
              <td className="rank">{i + 1}</td>
              <td>{r.name}</td>
              <td>{money(r.amount)}</td>
              <td className="share">{r.share.toFixed(0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function RegionDetailAnalysis({ region, industry }) {
  const genderAge = genderAgeFor(region, industry);
  const mix = subcategoryMix(region, industry);
  return (
    <section className="region-detail" id="region-detail">
      <div className="detail-heading">
        <h3>
          {region.province} {region.name} · {industryLabel(industry)}
        </h3>
        <small>{period} · CSV 집계값</small>
      </div>
      <div className="demo-section">
        <h4>a. 성별·연령별</h4>
        <GenderAgeChart genderAge={genderAge} label={region.name} industry={industry} />
      </div>
      <div className="demo-section">
        <h4>b. 이용 건수 / 결제 단가</h4>
        <CountPriceChart monthly={region.monthly} months={months} label={region.name} industry={industry} />
      </div>
      {mix && (
        <div className="demo-section">
          <h4>c. 세부 업종별 점포 구성</h4>
          <SubcategoryMix mix={mix} label={region.name} industry={industry} />
        </div>
      )}
    </section>
  );
}
export function CommercialAnalysis({
  industry,
  setIndustry,
  selected,
  setSelected,
  province,
  setProvince,
  metric,
  setMetric,
  all,
  region,
}) {
  const [modal, setModal] = useState(false);
  const groups = useMemo(() => municipalityGroups(all), [all]);
  const choices = groups.filter((r) => r.province === province);
  const city = region ? municipalityName(region) : "";
  const cityGroup = choices.find((r) => r.name === city);
  const districts = cityGroup?.isAggregate
    ? all.filter((r) => cityGroup.memberIds.includes(r.id))
    : [];
  // 성남시처럼 하위 구가 있는 시는 그 구들 전체로, 밀양시처럼 하위 구가
  // 없는 단일 시·군은 선택된 그 지역 하나로 지도를 좁혀서 확대한다.
  const focusIds = cityGroup?.isAggregate
    ? cityGroup.memberIds
    : cityGroup && selected === cityGroup.id
      ? [cityGroup.id]
      : undefined;
  const visible = cityGroup?.isAggregate
    ? districts
    : province
      ? choices
      : groups;
  const metro = /특별시|광역시/.test(province);
  const cityLabel = metro
    ? "구·군"
    : province === "세종특별자치시"
      ? "지역"
      : "시·군";
  return (
    <section id="commercial">
      <SectionHeading
        title="상권 분석"
        description="전국의 소비 흐름, 제공된 데이터의 지역 단위 그대로."
      />
      {!industry ? (
        <div className="intro">
          <div className="intro-copy">
            <span className="pill">BC카드 공모전 CSV 기반</span>
            <h1>
              전국의 상권을,
              <br />
              실제 소비 데이터로.
            </h1>
            <p>
              {meta.provinceCount}개 시도 · {meta.regionCount}개 지역 ·{" "}
              {industries.length}개 업종
              <br />
              {period}의 결제 흐름을 살펴보세요.
            </p>
            <button className="primary" onClick={() => setModal(true)}>
              분석 시작하기 <ArrowUpRight size={18} />
            </button>
          </div>
          <div className="intro-art national-intro">
            <span className="eyebrow">FROM THE SOURCE</span>
            <strong>시 · 군 · 구</strong>
            <p>
              강릉시 · 기장군 · 성남시 분당구
              <br />
              세종특별자치시
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="analysis-title">
            <h3>
              {industryLabel(industry)} <span>상권 분석</span>
            </h3>
            <button className="change-industry-button" onClick={() => setModal(true)}>
              업종 변경 ↗
            </button>
          </div>
          <div className="filters">
            <div className="location-filters">
              <MapPin size={17} />
              <label className="area-field">
                <span>시·도</span>
                <select
                  aria-label="시도"
                  value={province}
                  onChange={(e) => setProvince(e.target.value)}
                >
                  <option value="">전국</option>
                  {provinces.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <span className="filter-step" aria-hidden="true">
                ›
              </span>
              <label className="area-field">
                <span>{cityLabel}</span>
                <select
                  aria-label={cityLabel}
                  disabled={!province}
                  value={cityGroup?.id || ""}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">
                    {province ? cityLabel + " 전체" : "시·도를 먼저 선택"}
                  </option>
                  {choices.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              {!metro && (
                <>
                  <span className="filter-step" aria-hidden="true">
                    ›
                  </span>
                  <label className="area-field">
                    <span>구</span>
                    <select
                      aria-label="구"
                      disabled={!districts.length}
                      value={
                        region && !region.isAggregate && districts.length
                          ? selected
                          : ""
                      }
                      onChange={(e) =>
                        setSelected(e.target.value || cityGroup?.id || "")
                      }
                    >
                      <option value="">
                        {districts.length
                          ? city + " 전체"
                          : city
                            ? "하위 구 없음"
                            : "시·군을 먼저 선택"}
                      </option>
                      {districts.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name.slice(city.length).trim()}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
            <label>
              표시 기준{" "}
              <select
                aria-label="지도 표시 기준"
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
              >
                {Object.entries(metrics).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="source-strip">
            {period} · CSV {meta.rowCount.toLocaleString("ko-KR")}행 집계 ·
            금액은 원 단위 · 증감률은 6월/5월 대비
          </p>
          <div className="explorer">
            <MapPanel
              records={all}
              province={province}
              setProvince={setProvince}
              selected={selected}
              setSelected={setSelected}
              metric={metric}
              areaIds={focusIds}
              areaName={focusIds ? city : ""}
              aggregateSelected={!!region?.isAggregate}
              onClearArea={() => setSelected("")}
            />
            <RegionInfoPanel
              records={visible}
              region={region}
              setSelected={setSelected}
              industry={industry}
              province={province}
            />
          </div>
          {region?.hasData ? (
            <RegionDetailAnalysis region={region} industry={industry} />
          ) : (
            <p className="selection-hint">
              <Info size={14} />
              시도 또는 지역을 선택해 분석하세요. CSV의 모든 지역을 표시하며,
              선택 업종의 행이 없으면 자료 없음으로 구분합니다.
            </p>
          )}
        </>
      )}
      {modal && (
        <IndustryModal
          current={industry}
          onClose={() => setModal(false)}
          onSubmit={(value) => {
            setIndustry(value);
            setModal(false);
          }}
        />
      )}
    </section>
  );
}
