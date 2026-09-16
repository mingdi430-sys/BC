// ===== 상수 =====
const BIZ_LIST = ['갈비전문점','대형할인점','서양음식','슈퍼 마켓','스넥','일반한식','일식회집','제 과 점','중국음식','편 의 점','한정식'];

const SIDO_PREFIX = {
  '서울특별시':'11','부산광역시':'21','대구광역시':'22','인천광역시':'23',
  '광주광역시':'24','대전광역시':'25','울산광역시':'26','세종특별자치시':'29',
  '경기도':'31','강원특별자치도':'32','충청북도':'33','충청남도':'34',
  '전북특별자치도':'35','전라남도':'36','경상북도':'37','경상남도':'38',
  '제주특별자치도':'39'
};
const PREFIX_TO_SIDO = Object.fromEntries(Object.entries(SIDO_PREFIX).map(([k,v])=>[v,k]));
const SIDO_SHORT = {
  '서울특별시':'서울','부산광역시':'부산','대구광역시':'대구','인천광역시':'인천',
  '광주광역시':'광주','대전광역시':'대전','울산광역시':'울산','세종특별자치시':'세종',
  '경기도':'경기','강원특별자치도':'강원','충청북도':'충북','충청남도':'충남',
  '전북특별자치도':'전북','전라남도':'전남','경상북도':'경북','경상남도':'경남',
  '제주특별자치도':'제주'
};
// 2013년 기준 GeoJSON과 현재 행정구역명이 다른 경우 보정
const ALIASES = {
  '29|세종특별자치시': '29|세종시',
  '23|미추홀구': '23|남구',
  '22|군위군': '37|군위군'
};

let REGION_DATA = null;
let GEO_MUNI = null;
let GEO_PROV = null;
let map = null;
let geoLayer = null;
let labelLayer = null;
let geoIndex = {};       // "prefix|name" -> geojson feature (시군구)
let featureToRaw = {};   // geoKey -> [원본 구 이름들]
let currentLevel = 'country'; // 'country' | 'sido'

// ===== 숫자 포맷 =====
// 큰 합계(결제액 총액류) - 억원 단위, 소수1자리
const fmtEok = v => {
  if (v === null || v === undefined) return '—';
  if (v >= 1e8) {
    const eok = v/1e8;
    return eok.toLocaleString('ko-KR', {maximumFractionDigits:1, minimumFractionDigits: eok<10?1:0}) + '억원';
  }
  if (v >= 1e4) return Math.round(v/1e4).toLocaleString() + '만원';
  return Math.round(v).toLocaleString() + '원';
};
// 정확한 원 단위(객단가 등 정밀도가 중요한 값)
const fmtWonExact = v => v === null || v === undefined ? '—' : Math.round(v).toLocaleString() + '원';
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
    geoIndex[prefix + '|' + f.properties.name] = f;
  });

  initControls();
  initMap();
  renderCountryView();
}

function initControls() {
  const sidoSelect = document.getElementById('sidoSelect');
  const optAll = document.createElement('option'); optAll.value=''; optAll.textContent='전국 (전체보기)';
  sidoSelect.appendChild(optAll);
  Object.keys(REGION_DATA.data).forEach(sido => {
    const o = document.createElement('option'); o.value = sido; o.textContent = sido;
    sidoSelect.appendChild(o);
  });
  sidoSelect.value = '';

  const bizSelect = document.getElementById('bizSelect');
  BIZ_LIST.forEach(b => {
    const o = document.createElement('option'); o.value = b; o.textContent = b.trim();
    bizSelect.appendChild(o);
  });
  bizSelect.value = '서양음식';

  sidoSelect.addEventListener('change', () => {
    if (sidoSelect.value === '') renderCountryView();
    else renderSidoView(sidoSelect.value);
  });
  bizSelect.addEventListener('change', () => {
    if (sidoSelect.value === '') renderCountryView(); else renderSidoView(sidoSelect.value);
  });
  document.getElementById('itemInput').addEventListener('input', renderItemNote);
  renderItemNote();
}

function renderItemNote() {
  const val = document.getElementById('itemInput').value.trim();
  const el = document.getElementById('itemNote');
  if (!val) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.textContent = `관심 아이템: "${val}" — 이 화면은 표시만 하며, 유행 판정(반감기 규칙)은 아직 이 대시보드에 연동되지 않았습니다.`;
}

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: false, scrollWheelZoom: true })
    .setView([36.2, 127.8], 6.7);
}

function clearLayers() {
  if (geoLayer) { map.removeLayer(geoLayer); geoLayer = null; }
}

function toNoSpace(name){ return name.replace(/\s+/g, ''); }

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

// ===== 색상 스케일 (흰 배경에서 구별 잘 되는 블루 시퀀셜) =====
function colorScale(t) {
  const stops = ['#E7EEFC', '#B9CDF3', '#7FA2E8', '#3F6DD1', '#1B3E85'];
  const n = stops.length;
  const idx = Math.min(n-2, Math.floor(t*(n-1)));
  const localT = t*(n-1) - idx;
  const c0 = hexToRgb(stops[idx]), c1 = hexToRgb(stops[idx+1]);
  const rgb = c0.map((v,i) => Math.round(v + (c1[i]-v)*localT));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}
function hexToRgb(hex){
  const v = hex.replace('#','');
  return [parseInt(v.slice(0,2),16), parseInt(v.slice(2,4),16), parseInt(v.slice(4,6),16)];
}

function renderLegend(maxAmt) {
  const legend = document.getElementById('legend');
  const stops = ['#E7EEFC', '#B9CDF3', '#7FA2E8', '#3F6DD1', '#1B3E85'];
  legend.innerHTML = '<span>0</span>' + stops.map(c=>`<span class="swatch" style="background:${c};"></span>`).join('') + `<span>${fmtEok(maxAmt)}</span>`;
}

function addLabel(layerGroup, latlng, text) {
  const marker = L.marker(latlng, {
    icon: L.divIcon({ className: 'region-label', html: text, iconSize: [0,0] }),
    interactive: false
  });
  layerGroup.addLayer(marker);
}

// ===== 전국 뷰 (시도 단위) =====
function renderCountryView() {
  currentLevel = 'country';
  const biz = document.getElementById('bizSelect').value;
  clearLayers();

  const sidoAmt = {};
  Object.entries(REGION_DATA.data).forEach(([sido, guMap]) => {
    let sum = 0;
    Object.values(guMap).forEach(bizMap => { const b = bizMap[biz]; if (b) sum += b.amt6; });
    sidoAmt[sido] = sum;
  });
  const maxAmt = Math.max(1, ...Object.values(sidoAmt));

  const labelGroup = L.layerGroup();
  geoLayer = L.geoJSON(GEO_PROV, {
    style: (feature) => {
      const sido = PREFIX_TO_SIDO[feature.properties.code];
      const amt = sidoAmt[sido] || 0;
      return { fillColor: colorScale(amt/maxAmt), color:'#FFFFFF', weight:1.4, fillOpacity:0.92 };
    },
    onEachFeature: (feature, layer) => {
      const sido = PREFIX_TO_SIDO[feature.properties.code];
      if (!sido) return;
      const center = layer.getBounds().getCenter();
      // 서울은 면적이 작아 경기 라벨과 겹치므로 살짝 위로 띄움
      const labelPos = sido === '서울특별시' ? L.latLng(center.lat + 0.28, center.lng - 0.15) : center;
      addLabel(labelGroup, labelPos, SIDO_SHORT[sido] || sido);
      layer.on('click', () => {
        document.getElementById('sidoSelect').value = sido;
        renderSidoView(sido);
      });
      layer.on('mouseover', () => layer.setStyle({ weight:2.6 }));
      layer.on('mouseout', () => layer.setStyle({ weight:1.4 }));
      layer.bindTooltip(sido, { sticky:true });
    }
  }).addTo(map);
  labelGroup.addTo(map);
  geoLayer._labelGroup = labelGroup;

  map.setView([36.2, 127.8], 6.7);
  document.getElementById('contextTag').textContent = `BC카드 결제 · 전국 · ${biz.trim()}`;
  renderLegend(maxAmt);
}

// ===== 시도 뷰 (시군구 단위) =====
function renderSidoView(sido) {
  currentLevel = 'sido';
  const biz = document.getElementById('bizSelect').value;
  const guData = REGION_DATA.data[sido];
  clearLayers();

  featureToRaw = {};
  const featureAmt = {};
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

  const features = Object.keys(featureToRaw).map(k => geoIndex[k]);
  const labelGroup = L.layerGroup();

  geoLayer = L.geoJSON(features, {
    style: (feature) => {
      const key = feature.properties.code.slice(0,2) + '|' + feature.properties.name;
      const amt = featureAmt[key] || 0;
      return { fillColor: colorScale(amt/maxAmt), color:'#FFFFFF', weight:1.4, fillOpacity:0.92 };
    },
    onEachFeature: (feature, layer) => {
      const key = feature.properties.code.slice(0,2) + '|' + feature.properties.name;
      const rawGus = featureToRaw[key] || [];
      const label = rawGus.length===1 ? rawGus[0] : feature.properties.name;
      const center = layer.getBounds().getCenter();
      addLabel(labelGroup, center, label);
      layer.bindTooltip(label, { sticky: true });
      layer.on('click', () => selectRegion(sido, rawGus, biz));
      layer.on('mouseover', () => layer.setStyle({ weight:2.6 }));
      layer.on('mouseout', () => layer.setStyle({ weight:1.4 }));
    }
  }).addTo(map);
  labelGroup.addTo(map);
  geoLayer._labelGroup = labelGroup;

  if (geoLayer.getBounds().isValid()) map.fitBounds(geoLayer.getBounds(), { padding:[24,24] });
  document.getElementById('contextTag').textContent = `BC카드 결제 · ${sido} · ${biz.trim()}`;
  renderLegend(maxAmt);
}

// 라벨 레이어를 geoLayer 제거 시 같이 정리
const _origClearLayers = clearLayers;
clearLayers = function() {
  if (geoLayer) {
    if (geoLayer._labelGroup) map.removeLayer(geoLayer._labelGroup);
    map.removeLayer(geoLayer);
    geoLayer = null;
  }
};

// ===== 우측 분석 패널 =====
function selectRegion(sido, rawGus, biz) {
  const guData = REGION_DATA.data[sido];
  const months = REGION_DATA.months;

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

  const avgPrice = cnt6>0 ? amt6/cnt6 : 0;
  document.getElementById('statAmt').textContent = fmtEok(amt6);
  document.getElementById('statCnt').textContent = fmtCnt(cnt6);
  document.getElementById('statPrice').textContent = fmtWonExact(avgPrice);

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
  const W=560, H=170, padL=10, padR=10, padT=22, padB=26;
  const max = Math.max(...monthly, 1);
  const barW = (W-padL-padR) / monthly.length * 0.6;
  const gap = (W-padL-padR) / monthly.length;

  let bars = monthly.map((v,i)=>{
    const h = (v/max) * (H-padT-padB);
    const x = padL + i*gap + (gap-barW)/2;
    const y = H-padB-h;
    const monthLabel = months[i].slice(4)+'월';
    return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="#2554C7"/>
      <text x="${x+barW/2}" y="${H-8}" font-size="11" fill="#6B7080" text-anchor="middle">${monthLabel}</text>
      ${v>0 ? `<text x="${x+barW/2}" y="${y-6}" font-size="10.5" fill="#191B22" text-anchor="middle">${fmtEok(v)}</text>` : ''}`;
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
    return `<tr style="${highlight?'color:#2554C7;font-weight:700;':''}">
      <td>${r.gu}</td><td>${fmtEok(r.amt)}</td><td>${(r.amt/total*100).toFixed(0)}%</td>
    </tr>`;
  }).join('');
}

loadAll();
