// ===== 상수 =====
const BIZ_LIST = ['갈비전문점','대형할인점','서양음식','슈퍼 마켓','스넥','일반한식','일식회집','제 과 점','중국음식','편 의 점','한정식'];

const SIDO_PREFIX = {
  '서울특별시':'11','부산광역시':'21','대구광역시':'22','인천광역시':'23',
  '광주광역시':'24','대전광역시':'25','울산광역시':'26','세종특별자치시':'29',
  '경기도':'31','강원특별자치도':'32','충청북도':'33','충청남도':'34',
  '전북특별자치도':'35','전라남도':'36','경상북도':'37','경상남도':'38',
  '제주특별자치도':'39'
};
// 2013년 기준 GeoJSON과 현재 행정구역명이 다른 경우 보정
const ALIASES = {
  '29|세종특별자치시': '29|세종시',
  '23|미추홀구': '23|남구',
  '22|군위군': '37|군위군'
};

let REGION_DATA = null;   // { months: [...], data: { 시도: { 구: {업종: {...}} } } }
let GEO_MUNI = null;
let GEO_PROV = null;
let map = null;
let geoLayer = null;
let geoIndex = {};        // "prefix|name" -> geojson feature
// geoFeatureKey -> [rawGuName, ...]  (한 폴리곤에 여러 원본 구가 매칭되는 경우, 예: 화성시)
let featureToRaw = {};

const fmtWon = v => {
  if (v === null || v === undefined) return '—';
  if (v >= 1e8) return (v/1e8).toFixed(1).replace(/\.0$/,'') + '억원';
  if (v >= 1e4) return Math.round(v/1e4).toLocaleString() + '만원';
  return v.toLocaleString() + '원';
};
const fmtCnt = v => v === null || v === undefined ? '—' : v.toLocaleString() + '건';

// ===== 데이터 로드 =====
async function loadAll() {
  const [regionRes, muniRes, provRes] = await Promise.all([
    fetch('data/region_biz.json'),
    fetch('data/skorea_municipalities_geo_simple.json'),
    fetch('data/skorea_provinces_geo_simple.json')
  ]);
  REGION_DATA = await regionRes.json();
  GEO_MUNI = await muniRes.json();
  GEO_PROV = await provRes.json();

  GEO_MUNI.features.forEach(f => {
    const prefix = f.properties.code.slice(0,2);
    const key = prefix + '|' + f.properties.name;
    geoIndex[key] = f;
  });

  initControls();
  initMap();
  onSidoOrBizChange();
}

function initControls() {
  const sidoSelect = document.getElementById('sidoSelect');
  Object.keys(REGION_DATA.data).forEach(sido => {
    const o = document.createElement('option'); o.value = sido; o.textContent = sido;
    sidoSelect.appendChild(o);
  });
  sidoSelect.value = '서울특별시';

  const bizSelect = document.getElementById('bizSelect');
  BIZ_LIST.forEach(b => {
    const o = document.createElement('option'); o.value = b; o.textContent = b.trim();
    bizSelect.appendChild(o);
  });
  bizSelect.value = '서양음식';

  sidoSelect.addEventListener('change', onSidoOrBizChange);
  bizSelect.addEventListener('change', onSidoOrBizChange);
}

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: false }).setView([36.2, 127.8], 7);
}

// 구 이름(공백포함, 예: "고양시 덕양구") -> GeoJSON용 공백없는 이름
function toNoSpace(name){ return name.replace(/\s+/g, ''); }

// 시도+구 이름으로 geoIndex에서 폴리곤 찾기 (직접매칭 실패 시 상위 도시명으로 폴백)
function resolveFeature(sido, gu) {
  const prefix = SIDO_PREFIX[sido];
  const ns = toNoSpace(gu);
  const aliasKey = ALIASES[prefix + '|' + ns];
  if (aliasKey && geoIndex[aliasKey]) return { key: aliasKey, feature: geoIndex[aliasKey] };
  const directKey = prefix + '|' + ns;
  if (geoIndex[directKey]) return { key: directKey, feature: geoIndex[directKey] };
  const m = ns.match(/^(.+?[시군])/);
  if (m) {
    const cityKey = prefix + '|' + m[1];
    if (geoIndex[cityKey]) return { key: cityKey, feature: geoIndex[cityKey] };
  }
  return null;
}

// ===== 지도 렌더링 =====
function onSidoOrBizChange() {
  const sido = document.getElementById('sidoSelect').value;
  const biz = document.getElementById('bizSelect').value;
  const guData = REGION_DATA.data[sido];

  featureToRaw = {};
  const featureAmt = {}; // geoKey -> 합산 amt6 (병합 폴리곤 대비)

  Object.keys(guData).forEach(gu => {
    const resolved = resolveFeature(sido, gu);
    if (!resolved) return;
    const bizInfo = guData[gu][biz];
    const amt = bizInfo ? bizInfo.amt6 : 0;
    featureToRaw[resolved.key] = featureToRaw[resolved.key] || [];
    featureToRaw[resolved.key].push(gu);
    featureAmt[resolved.key] = (featureAmt[resolved.key] || 0) + amt;
  });

  const maxAmt = Math.max(1, ...Object.values(featureAmt));

  if (geoLayer) map.removeLayer(geoLayer);

  const features = Object.keys(featureToRaw).map(k => geoIndex[k]);
  geoLayer = L.geoJSON(features, {
    style: (feature) => {
      const prefix = feature.properties.code.slice(0,2);
      const key = prefix + '|' + feature.properties.name;
      const amt = featureAmt[key] || 0;
      const intensity = amt / maxAmt;
      return {
        fillColor: colorScale(intensity),
        color: '#0E1420',
        weight: 1,
        fillOpacity: 0.85
      };
    },
    onEachFeature: (feature, layer) => {
      const prefix = feature.properties.code.slice(0,2);
      const key = prefix + '|' + feature.properties.name;
      const rawGus = featureToRaw[key] || [];
      layer.bindTooltip(feature.properties.name, { sticky: true });
      layer.on('click', () => selectRegion(sido, rawGus, biz));
      layer.on('mouseover', () => layer.setStyle({ weight: 2.5, color: '#EAEDF5' }));
      layer.on('mouseout', () => layer.setStyle({ weight: 1, color: '#0E1420' }));
    }
  }).addTo(map);

  if (geoLayer.getBounds().isValid()) {
    map.fitBounds(geoLayer.getBounds(), { padding: [16,16] });
  }

  document.getElementById('contextTag').textContent = `BC카드 결제 · ${sido} · ${biz.trim()}`;
}

function colorScale(t) {
  // 0(연함) ~ 1(진함), 파란 계열
  const stops = [
    [21,27,43], [40,55,95], [70,95,160], [107,135,214], [143,165,224]
  ];
  const idx = Math.min(stops.length-2, Math.floor(t*(stops.length-1)));
  const localT = t*(stops.length-1) - idx;
  const c0 = stops[idx], c1 = stops[idx+1];
  const rgb = c0.map((v,i) => Math.round(v + (c1[i]-v)*localT));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

// ===== 우측 분석 패널 =====
function selectRegion(sido, rawGus, biz) {
  const guData = REGION_DATA.data[sido];
  const months = REGION_DATA.months;

  // 여러 구가 하나의 폴리곤에 매칭된 경우(예: 화성시 하위 구) 합산
  let amt6=0, cnt6=0, monthly = new Array(months.length).fill(0);
  let anyData = false, lowSampleAny = false;
  rawGus.forEach(gu => {
    const b = guData[gu][biz];
    if (!b) return;
    anyData = true;
    amt6 += b.amt6; cnt6 += b.cnt6;
    b.monthly.forEach((v,i)=> monthly[i]+=v);
    if (b.lowSample) lowSampleAny = true;
  });

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('statsBody').style.display = 'block';

  const label = rawGus.length===1 ? rawGus[0] : rawGus.join(' + ');
  document.querySelector('.panel-header h2').textContent = `지역 수요 — ${label}`;

  if (!anyData) {
    document.getElementById('statAmt').textContent = '0원';
    document.getElementById('statCnt').textContent = '0건';
    document.getElementById('statPrice').textContent = '—';
    document.getElementById('statRank').textContent = '데이터 없음';
    document.getElementById('statGrowth').textContent = '—';
    document.getElementById('monthlyChart').innerHTML = '';
    document.getElementById('topGuTable').querySelector('tbody').innerHTML = '';
    document.getElementById('lowSampleWarn').style.display = 'none';
    return;
  }

  const avgPrice = cnt6>0 ? Math.round(amt6/cnt6) : 0;
  document.getElementById('statAmt').textContent = fmtWon(amt6);
  document.getElementById('statCnt').textContent = fmtCnt(cnt6);
  document.getElementById('statPrice').textContent = fmtWon(avgPrice);

  // 전국 순위: 대표 구(첫번째) 기준값 사용, 병합 케이스는 참고용
  const repInfo = guData[rawGus[0]][biz];
  if (repInfo && repInfo.natRank) {
    document.getElementById('statRank').textContent = `${repInfo.natRank}위 / ${repInfo.natTotal}`;
  } else {
    document.getElementById('statRank').textContent = '해당없음';
  }
  const growth = monthly[0]>0 ? (((monthly[monthly.length-1]-monthly[0])/monthly[0])*100).toFixed(1) : null;
  document.getElementById('statGrowth').textContent = growth===null ? '—' : (growth>=0?'+':'')+growth+'%';

  renderMonthlyChart(monthly, months);
  renderTopGuTable(sido, biz, rawGus);

  if (lowSampleAny) {
    document.getElementById('lowSampleWarn').style.display = 'block';
    document.getElementById('lowSampleWarn').textContent =
      `${label}은(는) 6개월 중 일부 달만 결제가 잡혀 표본이 작습니다. 지역 수요 신호는 참고용으로만 활용하세요.`;
  } else {
    document.getElementById('lowSampleWarn').style.display = 'none';
  }
}

function renderMonthlyChart(monthly, months) {
  const svg = document.getElementById('monthlyChart');
  const W=560, H=170, padL=10, padR=10, padT=20, padB=26;
  const max = Math.max(...monthly, 1);
  const barW = (W-padL-padR) / monthly.length * 0.6;
  const gap = (W-padL-padR) / monthly.length;

  let bars = monthly.map((v,i)=>{
    const h = (v/max) * (H-padT-padB);
    const x = padL + i*gap + (gap-barW)/2;
    const y = H-padB-h;
    const monthLabel = months[i].slice(4)+'월';
    return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="#6B87D6"/>
      <text x="${x+barW/2}" y="${H-8}" font-size="11" fill="#8A93A8" text-anchor="middle">${monthLabel}</text>
      ${v>0 ? `<text x="${x+barW/2}" y="${y-6}" font-size="10" fill="#EAEDF5" text-anchor="middle">${fmtWon(v)}</text>` : ''}`;
  }).join('');
  svg.innerHTML = bars;
}

function renderTopGuTable(sido, biz, excludeGus) {
  const guData = REGION_DATA.data[sido];
  const rows = Object.keys(guData).map(gu => {
    const b = guData[gu][biz];
    return { gu, amt: b ? b.amt6 : 0 };
  }).sort((a,b)=>b.amt-a.amt).slice(0,8);

  const total = rows.reduce((s,r)=>s+r.amt,0) || 1;
  const tbody = document.querySelector('#topGuTable tbody');
  tbody.innerHTML = rows.map(r => {
    const highlight = excludeGus.includes(r.gu);
    return `<tr style="${highlight?'color:#8FA5E0;font-weight:600;':''}">
      <td>${r.gu}</td><td>${fmtWon(r.amt)}</td><td>${(r.amt/total*100).toFixed(0)}%</td>
    </tr>`;
  }).join('');
}

loadAll();
