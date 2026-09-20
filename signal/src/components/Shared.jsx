import React, { useState, useRef, useEffect } from "react";
import { ArrowRight, X } from "lucide-react";
import { industries, industryLabel } from "../data";
export const shortIndustry = (i) => i.split(" / ")[0];
export const fmt = (r, k) =>
  k === "amount"
    ? `${r.amount}억 원`
    : k === "count"
      ? `${r.count}만 건`
      : `+${r.growth}%`;
export function SectionHeading({ title, description }) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
    </div>
  );
}
export function IndustryModal({ current, onClose, onSubmit }) {
  const [value, setValue] = useState(current || "");
  const ref = useRef();
  useEffect(() => {
    const old = document.activeElement;
    ref.current.showModal();
    return () => old?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <button className="icon-button close" onClick={onClose} aria-label="닫기">
        <X size={20} />
      </button>
      <span className="eyebrow">START YOUR EXPLORATION</span>
      <h2>어떤 업종을 분석할까요?</h2>
      <p>관심 업종의 지역별 소비 흐름을 살펴보세요.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(value);
        }}
      >
        <label htmlFor="industry">
          관심 업종 <span className="green">*</span>
        </label>
        <select
          id="industry"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
        >
          <option value="" disabled>
            업종을 선택해주세요
          </option>
          {industries.map((i) => (
            <option key={i} value={i}>
              {industryLabel(i)}
            </option>
          ))}
        </select>
        <button className="primary full" type="submit">
          분석 시작 <ArrowRight size={17} />
        </button>
      </form>
      <small>지역은 다음 화면의 지도에서 선택할 수 있어요.</small>
    </dialog>
  );
}
