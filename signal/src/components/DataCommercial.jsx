import React, { useState, useMemo } from "react";
import { ArrowRight, ArrowUpRight, MapPin, Info } from "lucide-react";
import { IndustryModal } from "./Shared";
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
  subcategoryMix,
} from "../data";
import { GenderAgeChart, CountPriceChart } from "./DemoCharts";
import { municipalityGroups, municipalityName } from "../data";
import { MapPanel } from "./GeoMapPanel";
import { SubcategoryMix } from "./SubcategoryMix";
import { TrendHero } from "./TrendHero";
const METRIC_HELP = {
  amount: [
    "기간 결제금액",
    `${period} 6개월 동안 BC카드로 결제된 금액을 모두 더한 값이에요. 이 값이 큰 지역일수록 위에 나와요.`,
  ],
  count: [
    "기간 결제 건수",
    `${period} 6개월 동안 BC카드로 결제된 횟수를 모두 더한 값이에요. 금액이 아니라 결제가 몇 번 일어났는지 봐요.`,
  ],
  growth: [
    "최근 월 증감률",
    "가장 최근 달의 결제금액이 바로 앞 달보다 몇 % 늘거나 줄었는지예요. (이번 달 ÷ 지난달 − 1)",
  ],
  amountPerStore: [
    "점포당 결제금액(근사)",
    "기간 결제금액을 그 지역의 해당 업종 점포 수로 나눈 값이에요. 점포 수는 상가정보와 근사 매칭한 값이라 참고용이에요.",
  ],
};
export function RegionInfoPanel({
  records,
  region,
  setSelected,
  industry,
  province,
  sort,
}) {
  if (!region)
    return (
      <aside className="region-info">
        <h3>지역별 상권 현황</h3>
        <p className="metric-note">
          <b>{METRIC_HELP[sort][0]}순</b>
          {METRIC_HELP[sort][1]}
        </p>
        <div className="region-list">
          {[...records]
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
                <span className={r.growth < 0 ? "negative" : "green"}>
                  {signed(r.growth)}
                </span>
                <ArrowRight size={14} />
              </button>
            ))}
        </div>
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
      {!industry ? (
        <div className="hero">
          <div className="hero-copy">
            <h1>
              지금 뜨는 트렌드, 얼마나 갈까?
              <br />
              검색 데이터로 미리 읽는 상권의 신호
            </h1>
            <button className="primary" onClick={() => setModal(true)}>
              분석 시작하기 <ArrowUpRight size={18} />
            </button>
          </div>
          <TrendHero />
        </div>
      ) : (
        <>
          <div className="analysis-title">
            <h3>
              {industryLabel(industry)}
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
              sort={metric}
            />
          </div>
          {region?.hasData ? (
            <RegionDetailAnalysis region={region} industry={industry} />
          ) : (
            null
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
