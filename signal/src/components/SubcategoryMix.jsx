import React from "react";
import { industryLabel } from "../data";

const tag = (ratio) =>
  ratio >= 1.3 ? "전국보다 많음" : ratio <= 0.7 ? "전국보다 적음" : "전국과 비슷";
const MIN_COUNT = 10; // 이보다 점포가 적으면 비율이 크게 흔들려 판정을 붙이지 않는다.
const pct = (v) => (v * 100).toFixed(v < 0.1 ? 1 : 0) + "%";

export function SubcategoryMix({ mix, label, industry }) {
  const top = mix.rows[0];
  // 전국 비중이 3% 미만인 세부 업종은 비율이 극단적으로 튀므로 문장 요약에서 제외한다.
  const major = mix.rows.filter((r) => r.nationalShare >= 0.03 && r.count >= MIN_COUNT);
  const over = [...major].sort((a, b) => b.ratio - a.ratio)[0];
  const under = [...major].sort((a, b) => a.ratio - b.ratio)[0];
  return (
    <>
      <p className="chart-narrative">
        {label} <b>{industryLabel(industry)}</b> 점포 {mix.total.toLocaleString("ko-KR")}개 중{" "}
        <b className="hl">{top.name}</b>이(가) {pct(top.share)}로 가장 많습니다.
        {over && over.ratio >= 1.3 && (
          <>
            {" "}전국 구성과 비교하면 <b className="hl">{over.name}</b>은(는) {over.ratio.toFixed(1)}배로
            몰려 있고
          </>
        )}
        {under && under.ratio <= 0.7 && (
          <>
            {over && over.ratio >= 1.3 ? ", " : " 전국 구성과 비교하면 "}
            <b className="hl">{under.name}</b>은(는) {under.ratio.toFixed(1)}배로 적은 편
          </>
        )}
        {(over?.ratio >= 1.3 || under?.ratio <= 0.7) && "입니다."}
      </p>
      <table className="demo-table mix-table">
        <thead>
          <tr>
            <th>세부 업종</th>
            <th>점포 수</th>
            <th>이 지역 구성 (회색: 전국)</th>
            <th>전국 대비</th>
          </tr>
        </thead>
        <tbody>
          {mix.rows.map((r) => (
            <tr key={r.code}>
              <td>{r.name}</td>
              <td>{r.count.toLocaleString("ko-KR")}</td>
              <td>
                <div className="mix-bar" aria-label={`이 지역 ${pct(r.share)}, 전국 ${pct(r.nationalShare)}`}>
                  <i style={{ width: r.share * 100 + "%" }} />
                  <em style={{ width: r.nationalShare * 100 + "%" }} />
                </div>
                <small>
                  {pct(r.share)} <span>· 전국 {pct(r.nationalShare)}</span>
                </small>
              </td>
              <td>
                {!r.count
                  ? "점포 없음"
                  : r.count < MIN_COUNT
                    ? "점포가 적어 비교 제외"
                    : `${r.ratio.toFixed(1)}배 · ${tag(r.ratio)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {mix.missing > 0 && (
        <p className="chart-caption">하위 지역 {mix.missing}곳은 점포 자료가 없어 제외했습니다.</p>
      )}
    </>
  );
}
