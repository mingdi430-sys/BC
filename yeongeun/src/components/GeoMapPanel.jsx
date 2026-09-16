import React, { useState, useEffect, useMemo, useRef } from "react";
import { geoMercator, geoPath, geoArea } from "d3-geo";
import { MapPin, Plus, Minus, Maximize, ArrowLeft, Layers } from "lucide-react";
import { provinces, summarize, metrics, metricText } from "../data";
const labelOffsets = {
  서울특별시: [-39, -20],
  인천광역시: [-64, 8],
  경기도: [16, 16],
  세종특별자치시: [-32, -8],
  대전광역시: [-19, 16],
  광주광역시: [-25, 0],
  부산광역시: [21, 9],
};
const names = {
  서울특별시: "서울",
  부산광역시: "부산",
  대구광역시: "대구",
  인천광역시: "인천",
  광주광역시: "광주",
  대전광역시: "대전",
  울산광역시: "울산",
  세종특별자치시: "세종",
  경기도: "경기",
  강원특별자치도: "강원",
  충청북도: "충북",
  충청남도: "충남",
  전북특별자치도: "전북",
  전라남도: "전남",
  경상북도: "경북",
  경상남도: "경남",
  제주특별자치도: "제주",
};
function orient(collection) {
  return {
    ...collection,
    features: collection.features.map((f) => {
      if (geoArea(f) < Math.PI * 2) return f;
      const g = f.geometry;
      return {
        ...f,
        geometry: {
          ...g,
          coordinates:
            g.type === "Polygon"
              ? g.coordinates.map((r) => [...r].reverse())
              : g.coordinates.map((p) => p.map((r) => [...r].reverse())),
        },
      };
    }),
  };
}
function labelPoint(feature, path) {
  if (feature.geometry.type !== "MultiPolygon") return path.centroid(feature);
  const pieces = feature.geometry.coordinates.map((c) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: c },
    properties: {},
  }));
  return path.centroid(pieces.sort((a, b) => geoArea(b) - geoArea(a))[0]);
}
export function MapPanel({
  records,
  province,
  setProvince,
  selected,
  setSelected,
  metric,
  areaIds,
  areaName,
  aggregateSelected,
  onClearArea,
}) {
  const areaKey = (areaIds || []).join(";");
  const [geo, setGeo] = useState(null),
    [error, setError] = useState(""),
    [hover, setHover] = useState(null),
    [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef(null),
    didDrag = useRef(false);
  useEffect(() => {
    let active = true;
    Promise.all(
      ["/maps/provinces.json", "/maps/districts.json"].map((url) =>
        fetch(url)
          .then((r) => {
            if (!r.ok) throw new Error("경계 파일을 불러올 수 없습니다.");
            return r.json();
          })
          .then(orient),
      ),
    )
      .then(([sido, sgg]) => {
        if (active) setGeo({ sido, sgg });
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setView({ k: 1, x: 0, y: 0 });
    setHover(null);
  }, [province, areaKey]);
  const districtRecords = useMemo(
    () => new Map(records.map((r) => [r.id, r])),
    [records],
  );
  const grouped = useMemo(
    () =>
      new Map(
        provinces.map((name) => [
          name,
          { name, ...summarize(records.filter((r) => r.province === name)) },
        ]),
      ),
    [records],
  );
  const features = useMemo(
    () =>
      !geo
        ? []
        : province
          ? geo.sgg.features.filter(
              (f) =>
                f.properties.sidonm === province &&
                (!areaIds?.length ||
                  areaIds.includes(
                    f.properties.sidonm + "|" + f.properties.sggnm,
                  )),
            )
          : geo.sido.features,
    [geo, province, areaKey],
  );
  const collection = useMemo(
    () => ({ type: "FeatureCollection", features }),
    [features],
  );
  const projection = useMemo(
    () =>
      features.length
        ? geoMercator().fitExtent(
            [
              [42, 36],
              [718, 480],
            ],
            collection,
          )
        : null,
    [collection],
  );
  const path = useMemo(
    () => (projection ? geoPath(projection) : null),
    [projection],
  );
  function recordFor(f) {
    return province
      ? districtRecords.get(f.properties.sidonm + "|" + f.properties.sggnm)
      : grouped.get(f.properties.sidonm);
  }
  const vals = features
      .map((f) => recordFor(f)?.[metric])
      .filter((v) => v != null),
    low = Math.min(...vals),
    high = Math.max(...vals);
  function fill(r) {
    if (!r || r[metric] == null) return "#e5e9ee";
    const rate = high === low ? 0.5 : (r[metric] - low) / (high - low);
    return `hsl(215 55% ${89 - rate * 40}%)`;
  }
  const mapped = new Set(
    features.map((f) => f.properties.sidonm + "|" + f.properties.sggnm),
  );
  const unmatched = province
    ? records.filter(
        (r) =>
          r.province === province &&
          (!areaIds?.length || areaIds.includes(r.id)) &&
          !mapped.has(r.id),
      )
    : [];
  function zoom(mult) {
    setView((v) => {
      const k = Math.min(5, Math.max(1, v.k * mult));
      const ratio = k / v.k;
      return { k, x: 380 + (v.x - 380) * ratio, y: 260 + (v.y - 260) * ratio };
    });
  }
  function pick(f) {
    if (didDrag.current) return;
    const r = recordFor(f);
    if (province) {
      if (r) setSelected(r.id);
    } else setProvince(f.properties.sidonm);
  }
  return (
    <div className="geo-panel">
      <div className="geo-toolbar">
        <span>
          <MapPin size={15} />
          {province || "대한민국"}
          {areaName ? " · " + areaName : ""}
          <small>{province ? "시·군·구" : "전국 시도"}</small>
        </span>
        {areaName && (
          <button onClick={onClearArea}>
            <ArrowLeft size={14} />
            {province} 전체
          </button>
        )}
        {province && !areaName && (
          <button onClick={() => setProvince("")}>
            <ArrowLeft size={14} /> 전국 보기
          </button>
        )}
      </div>
      <div className="geo-canvas">
        <div className="geo-controls">
          <button aria-label="지도 확대" onClick={() => zoom(1.4)}>
            <Plus size={18} />
          </button>
          <button aria-label="지도 축소" onClick={() => zoom(1 / 1.4)}>
            <Minus size={18} />
          </button>
          <button
            aria-label="지도 초기 위치"
            onClick={() => setView({ k: 1, x: 0, y: 0 })}
          >
            <Maximize size={16} />
          </button>
        </div>
        <div className="north-arrow">
          N<span>↑</span>
        </div>
        {error ? (
          <p role="alert">{error} 위의 지역 필터로 계속 탐색할 수 있습니다.</p>
        ) : !geo ? (
          <p className="geo-loading">행정 경계를 불러오는 중입니다…</p>
        ) : (
          <svg
            viewBox="0 0 760 520"
            className="geo-svg"
            role="group"
            aria-label={
              province
                ? `${province}${areaName ? " " + areaName : ""} 실제 시군구 경계 지도`
                : "전국 실제 시도 경계 지도"
            }
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              drag.current = { x: e.clientX, y: e.clientY, v: view };
              didDrag.current = false;
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const dx =
                  ((e.clientX - drag.current.x) * 760) /
                  e.currentTarget.getBoundingClientRect().width,
                dy =
                  ((e.clientY - drag.current.y) * 760) /
                  e.currentTarget.getBoundingClientRect().width;
              if (Math.abs(dx) + Math.abs(dy) > 5) {
                didDrag.current = true;
                setHover(null);
                setView({
                  ...drag.current.v,
                  x: drag.current.v.x + dx,
                  y: drag.current.v.y + dy,
                });
              }
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerLeave={() => {
              drag.current = null;
              setHover(null);
            }}
          >
            <defs>
              <pattern
                id="ocean-grid"
                width="48"
                height="48"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M48 0H0V48"
                  fill="none"
                  stroke="#cddce6"
                  strokeWidth=".5"
                  opacity=".35"
                />
              </pattern>
            </defs>
            <rect width="760" height="520" fill="url(#ocean-grid)" />
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {!province &&
                [
                  ["서해", 124.7, 35.9],
                  ["동해", 130.5, 36.3],
                  ["남해", 128, 33.8],
                ].map(([name, lon, lat]) => {
                  const [x, y] = projection([lon, lat]);
                  return (
                    <text className="sea-label" key={name} x={x} y={y}>
                      {name}
                    </text>
                  );
                })}
              {features.map((f) => {
                const r = recordFor(f),
                  id = province
                    ? f.properties.sidonm + "|" + f.properties.sggnm
                    : f.properties.sidonm,
                  active =
                    selected === id ||
                    (aggregateSelected && areaIds?.includes(id));
                return (
                  <path
                    key={id}
                    d={path(f)}
                    fill={active ? "#244e89" : fill(r)}
                    className={active ? "geo-region selected" : "geo-region"}
                    role="button"
                    tabIndex={r ? 0 : -1}
                    aria-label={`${province ? f.properties.sggnm : f.properties.sidonm} ${province ? "상세 분석" : "지역 탐색"}`}
                    aria-pressed={active}
                    onClick={() => pick(f)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        didDrag.current = false;
                        pick(f);
                      }
                    }}
                    onPointerEnter={() =>
                      setHover({
                        name: province
                          ? f.properties.sggnm
                          : f.properties.sidonm,
                        value: r ? metricText(r, metric) : "CSV 일치 지역 없음",
                      })
                    }
                    onFocus={() =>
                      setHover({
                        name: province
                          ? f.properties.sggnm
                          : f.properties.sidonm,
                        value: r ? metricText(r, metric) : "CSV 일치 지역 없음",
                      })
                    }
                  >
                    <title>
                      {province ? f.properties.sggnm : f.properties.sidonm} ·{" "}
                      {r ? metricText(r, metric) : "CSV 일치 지역 없음"}
                    </title>
                  </path>
                );
              })}
              {features.map((f) => {
                const id = province
                  ? f.properties.sidonm + "|" + f.properties.sggnm
                  : f.properties.sidonm;
                const [x, y] = labelPoint(f, path);
                const [dx, dy] = !province
                  ? labelOffsets[f.properties.sidonm] || [0, 0]
                  : [0, 0];
                const area = path.area(f);
                if (province && area < 300 && view.k < 1.5 && selected !== id)
                  return null;
                return (
                  <g key={id}>
                    {dx || dy ? (
                      <line
                        x1={x}
                        y1={y}
                        x2={x + dx}
                        y2={y + dy - 3}
                        stroke="#6d85a1"
                        strokeWidth=".6"
                        pointerEvents="none"
                      />
                    ) : null}
                    <text
                      className={`geo-label ${selected === id || (aggregateSelected && areaIds?.includes(id)) ? "selected" : ""}`}
                      x={x + dx}
                      y={y + dy}
                      textAnchor="middle"
                      fontSize={province ? 10 : 12}
                      transform={`rotate(0 ${x} ${y})`}
                    >
                      {province
                        ? f.properties.sggnm
                        : names[f.properties.sidonm] || f.properties.sidonm}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        {hover && (
          <div className="geo-tooltip">
            <strong>{hover.name}</strong>
            <span>
              {metrics[metric]} <b>{hover.value}</b>
            </span>
          </div>
        )}
        <div className="geo-hint">
          지역을 클릭해 분석 · + / − 확대 · 드래그 이동
        </div>
      </div>
      <div className="geo-legend">
        <span>
          <Layers size={14} />
          {metrics[metric]}
        </span>
        <div className="legend">
          <small>낮음</small>
          <i />
          <small>높음</small>
          <small className="missing-key">자료 없음</small>
        </div>
      </div>
      {unmatched.length > 0 && (
        <div className="unmatched-regions">
          <span>경계 미연결 · 목록으로 선택</span>
          {unmatched.map((r) => (
            <button key={r.id} onClick={() => setSelected(r.id)}>
              {r.name}
            </button>
          ))}
        </div>
      )}
      <div className="geo-attribution">
        경계 2026.04 · 단순화 적용 ·{" "}
        <a
          href="https://github.com/vuski/admdongkor"
          target="_blank"
          rel="noreferrer"
        >
          SGIS / vuski · CC BY 4.0
        </a>
      </div>
    </div>
  );
}
