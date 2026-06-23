/* ================================================================
   ORDER STATS DASHBOARD - app.js  (v3 — English schema)
   Single-page: load everything once, filter client-side + re-render
   ================================================================ */
'use strict';

const SUPABASE_URL = 'https://cvhwzjtxnbdjgdlbuksm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2aHd6anR4bmJkamdkbGJ1a3NtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxODEzNzgsImV4cCI6MjA5Nzc1NzM3OH0.vC37clY7IGDzaJW8aoiONPjZXdc9ccPMViNoSn1h4c0';
const TABLE = 'orders';
const DETAIL_PAGE = 50;

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

Chart.defaults.color = '#55637a';
Chart.defaults.borderColor = '#2a3040';
Chart.defaults.font.family = "'Sarabun', sans-serif";
Chart.defaults.font.size = 11;

// ── STATE ────────────────────────────────────────────────────────
let allData   = [];      // raw rows from Supabase
let filtered  = [];      // after applying filters
let detailPage = 1;
let editId     = null;
let deleteId   = null;
const charts   = {};

// ── Column mapping: DB (English) → display label (Thai) ──────────
// DB columns: id, order_date, platform, product_name, size, channel,
//             quantity, status, aluminum_color, glass_color,
//             pattern, mosquito_net, price
// Status values: 'success' | 'cancelled'

// ── UTILS ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const val = id => $(id)?.value ?? '';

function fmt(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDTLocal(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusBadge(s) {
  if (!s) return '<span class="badge b-gray">—</span>';
  const labels = { 'success': 'ส่งสำเร็จ', 'cancelled': 'ยกเลิก' };
  const cls    = { 'success': 'b-green',    'cancelled': 'b-red' };
  return `<span class="badge ${cls[s]||'b-gray'}">${labels[s]||s}</span>`;
}

function toast(msg, type='inf') {
  const c = $('toasts');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${type==='ok'?'✅':type==='err'?'❌':'ℹ️'}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
}

function countBy(rows, key) {
  const m = {};
  rows.forEach(r => { const v = r[key]||'—'; m[v] = (m[v]||0) + 1; });
  return m;
}

function sumQtyBy(rows, key) {
  const m = {};
  rows.forEach(r => { const v = r[key]||'—'; m[v] = (m[v]||0) + (r['quantity']||0); });
  return m;
}

function modeOf(rows, key) {
  const m = countBy(rows, key);
  return Object.entries(m).sort((a,b) => b[1]-a[1])[0]?.[0] ?? '—';
}

function makeBar(id, labels, data, color='#3b7ef5') {
  if (charts[id]) charts[id].destroy();
  const ctx = $(id); if (!ctx) return;
  charts[id] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: color,
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid:{ color:'#2a3040' }, ticks:{ color:'#55637a', maxRotation:45 } },
        y: { grid:{ color:'#2a3040' }, ticks:{ color:'#55637a', stepSize:1 } }
      }
    }
  });
}

// ── BUILD DROPDOWN OPTIONS ───────────────────────────────────────
function isCleanText(str) {
  return /^[\u0020-\u007E\u0E00-\u0E7F\s\d.,/-]*$/.test(String(str));
}

function buildDropdown(elId, values, currentVal='') {
  const el = $(elId); if (!el) return;
  const saved = currentVal || el.value;
  const sorted = [...new Set(values.filter(v => v && isCleanText(v)))].sort((a,b) => String(a).localeCompare(String(b)));
  el.innerHTML = `<option value="">ทั้งหมด</option>` + sorted.map(v => `<option value="${v}">${v}</option>`).join('');
  if (saved) el.value = saved;
}

function buildAllDropdowns(data) {
  buildDropdown('fPlatform',  data.map(r => r['platform']));

  // Status dropdown — show Thai labels but use English values
  const fStatus = $('fStatus'); if (fStatus) {
    fStatus.innerHTML = `
      <option value="">ทั้งหมด</option>
      <option value="success">ส่งสำเร็จ</option>
      <option value="cancelled">ยกเลิก</option>`;
  }

  buildDropdown('fProduct',   data.map(r => r['product_name'] != null ? String(r['product_name']) : null).filter(Boolean));
  buildDropdown('fPattern',   data.map(r => r['pattern']));
  buildDropdown('fMesh',      data.map(r => r['mosquito_net']));
  buildDropdown('fAlumColor', data.map(r => r['aluminum_color']));
  buildDropdown('fGlassColor',data.map(r => r['glass_color']));
  buildDropdown('fSize',      data.map(r => r['size']));
  buildDropdown('fChannel',   data.map(r => r['channel'] != null ? String(r['channel']) : null));

  // populate datalist for form
  const dl = $('dPlatform'); if (!dl) return;
  const plats = [...new Set(data.map(r => r['platform']).filter(Boolean))].sort();
  dl.innerHTML = plats.map(p => `<option value="${p}">`).join('');

  // year dropdown
  const years = [...new Set(data.map(r => {
    const d = new Date(r['order_date']); return isNaN(d) ? null : d.getFullYear();
  }).filter(Boolean))].sort((a,b) => b-a);
  buildDropdown('fYear', years.map(String));

  // form status options (English values, Thai labels)
  const fsi = $('fStatusIn'); if (!fsi) return;
  fsi.innerHTML = `
    <option value="">เลือกสถานะ</option>
    <option value="success">ส่งสำเร็จ</option>
    <option value="cancelled">ยกเลิก</option>`;
}

// ── APPLY FILTERS ────────────────────────────────────────────────
function applyFilters() {
  const platform  = val('fPlatform');
  const status    = val('fStatus');
  const product   = val('fProduct');
  const pattern   = val('fPattern');
  const mesh      = val('fMesh');
  const alumColor = val('fAlumColor');
  const glass     = val('fGlassColor');
  const size      = val('fSize');
  const channel   = val('fChannel');
  const month     = val('fMonth');
  const year      = val('fYear');
  const search    = val('fSearch').trim().toLowerCase();

  filtered = allData.filter(r => {
    if (platform  && r['platform']       !== platform)  return false;
    if (status    && r['status']         !== status)    return false;
    if (product   && r['product_name']   !== product)   return false;
    if (pattern   && r['pattern']        !== pattern)   return false;
    if (mesh      && r['mosquito_net']   !== mesh)      return false;
    if (alumColor && r['aluminum_color'] !== alumColor) return false;
    if (glass     && r['glass_color']    !== glass)     return false;
    if (size      && r['size']           !== size)      return false;
    if (channel   && String(r['channel']) !== channel)  return false;

    if (month || year) {
      const d = new Date(r['order_date']);
      if (isNaN(d)) return false;
      if (month && String(d.getMonth()+1) !== month) return false;
      if (year  && String(d.getFullYear()) !== year)  return false;
    }

    if (search) {
      const hay = [r['product_name'],r['platform'],r['status'],r['aluminum_color'],r['glass_color'],r['size']].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  detailPage = 1;
  renderAll();
}

// ── RENDER ALL ───────────────────────────────────────────────────
function renderAll() {
  renderKPIs();
  renderCharts();
  renderSummaryTables();
  renderDetail();
}

// ── KPIs ─────────────────────────────────────────────────────────
function renderKPIs() {
  const rows = filtered;
  const kpiFiltered = $('kpiFiltered');
  const kpiTotal = $('kpiTotal');
  const kpiQty = $('kpiQty');
  const kpiDone = $('kpiDone');
  const kpiTopProduct = $('kpiTopProduct');
  const kpiTopPlatform = $('kpiTopPlatform');
  
  if (kpiFiltered) kpiFiltered.textContent = rows.length.toLocaleString('th-TH');
  if (kpiTotal) kpiTotal.textContent = allData.length.toLocaleString('th-TH');
  if (kpiQty) kpiQty.textContent = rows.reduce((s,r) => s+(r['quantity']||0), 0).toLocaleString('th-TH');
  if (kpiDone) kpiDone.textContent = rows.filter(r => r['status']==='success').length.toLocaleString('th-TH');
  if (kpiTopProduct) kpiTopProduct.textContent = modeOf(rows,'product_name');
  if (kpiTopPlatform) kpiTopPlatform.textContent = modeOf(rows,'platform');
}

// ── CHARTS ───────────────────────────────────────────────────────
function renderCharts() {
  const periodType = val('fPeriodType') || 'month';
  const rows = filtered;

  // Monthly chart
  if (periodType === 'month' || periodType === 'all') {
    const byMonth = {};
    rows.forEach(r => {
      const d = new Date(r['order_date']);
      if (isNaN(d)) return;
      const k = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short' });
      byMonth[k] = (byMonth[k]||0) + (r['quantity']||0);
    });
    const labels = Object.keys(byMonth).sort();
    const data = labels.map(l => byMonth[l]);
    makeBar('chartMonth', labels, data, '#3b7ef5');
    
    const monthInfo = $('monthChartInfo');
    if (monthInfo) monthInfo.textContent = `${data.reduce((a,b)=>a+b,0)} ชิ้น`;
  }

  // Daily chart (last 30 days)
  if (periodType === 'day' || periodType === 'all') {
    const byDay = {};
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
      byDay[k] = 0;
    }
    rows.forEach(r => {
      const d = new Date(r['order_date']);
      if (isNaN(d)) return;
      const k = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
      if (k in byDay) byDay[k] = (byDay[k]||0) + (r['quantity']||0);
    });
    const labels = Object.keys(byDay);
    const data = labels.map(l => byDay[l]);
    makeBar('chartDay', labels, data, '#06b6d4');
    
    const dayInfo = $('dayChartInfo');
    if (dayInfo) dayInfo.textContent = `${data.reduce((a,b)=>a+b,0)} ชิ้น`;
  }
}

// ── SUMMARY TABLES ───────────────────────────────────────────────
function renderSummaryTables() {
  const rows = filtered;

  // Aluminum colors
  const alumData = countBy(rows, 'aluminum_color');
  const tbAlum = $('tbAlum'); if (tbAlum) {
    tbAlum.innerHTML = Object.entries(alumData)
      .sort((a,b) => b[1]-a[1])
      .map(([v,c]) => `<tr><td>${v}</td><td class="num">${c}</td></tr>`).join('');
  }

  // Glass colors
  const glassData = countBy(rows, 'glass_color');
  const tbGlass = $('tbGlass'); if (tbGlass) {
    tbGlass.innerHTML = Object.entries(glassData)
      .sort((a,b) => b[1]-a[1])
      .map(([v,c]) => `<tr><td>${v}</td><td class="num">${c}</td></tr>`).join('');
  }

  // Platform
  const platData = sumQtyBy(rows, 'platform');
  const tbPlatform = $('tbPlatform'); if (tbPlatform) {
    tbPlatform.innerHTML = Object.entries(platData)
      .sort((a,b) => b[1]-a[1])
      .map(([p,q]) => {
        const cnt = rows.filter(r => r['platform']===p).length;
        return `<tr><td>${p}</td><td class="num">${cnt}</td><td class="num">${q}</td></tr>`;
      }).join('');
  }

  // Product + Aluminum
  const prodAlumMap = {};
  rows.forEach(r => {
    const k = (r['product_name']||'—') + '|' + (r['aluminum_color']||'—');
    prodAlumMap[k] = (prodAlumMap[k]||0) + (r['quantity']||0);
  });
  const tbProdAlum = $('tbProdAlum'); if (tbProdAlum) {
    tbProdAlum.innerHTML = Object.entries(prodAlumMap)
      .sort((a,b) => b[1]-a[1])
      .map(([k,q]) => {
        const [prod,alum] = k.split('|');
        return `<tr><td>${prod}</td><td>${alum}</td><td class="num">${q}</td></tr>`;
      }).join('');
  }

  // Product + Glass
  const prodGlassMap = {};
  rows.forEach(r => {
    const k = (r['product_name']||'—') + '|' + (r['glass_color']||'—');
    prodGlassMap[k] = (prodGlassMap[k]||0) + (r['quantity']||0);
  });
  const tbProdGlass = $('tbProdGlass'); if (tbProdGlass) {
    tbProdGlass.innerHTML = Object.entries(prodGlassMap)
      .sort((a,b) => b[1]-a[1])
      .map(([k,q]) => {
        const [prod,glass] = k.split('|');
        return `<tr><td>${prod}</td><td>${glass}</td><td class="num">${q}</td></tr>`;
      }).join('');
  }

  // Product + Mesh
  const prodMeshMap = {};
  rows.forEach(r => {
    const k = (r['product_name']||'—') + '|' + (r['mosquito_net']||'—');
    prodMeshMap[k] = (prodMeshMap[k]||0) + (r['quantity']||0);
  });
  const tbProdMesh = $('tbProdMesh'); if (tbProdMesh) {
    tbProdMesh.innerHTML = Object.entries(prodMeshMap)
      .sort((a,b) => b[1]-a[1])
      .map(([k,q]) => {
        const [prod,mesh] = k.split('|');
        return `<tr><td>${prod}</td><td>${mesh}</td><td class="num">${q}</td></tr>`;
      }).join('');
  }

  // Product + Size
  const prodSizeMap = {};
  rows.forEach(r => {
    const k = (r['product_name']||'—') + '|' + (r['size']||'—');
    prodSizeMap[k] = (prodSizeMap[k]||0) + (r['quantity']||0);
  });
  const tbProdSize = $('tbProdSize'); if (tbProdSize) {
    tbProdSize.innerHTML = Object.entries(prodSizeMap)
      .sort((a,b) => b[1]-a[1])
      .map(([k,q]) => {
        const [prod,size] = k.split('|');
        return `<tr><td>${prod}</td><td>${size}</td><td class="num">${q}</td></tr>`;
      }).join('');
  }

  // Combined: Product + Size + Aluminum + Glass + Channel + Pattern + Mesh
  const combMap = {};
  rows.forEach(r => {
    const k = [r['product_name']||'—', r['size']||'—', r['aluminum_color']||'—', r['glass_color']||'—', r['channel']??'—', r['pattern']||'—', r['mosquito_net']||'—'].join('|');
    combMap[k] = (combMap[k]||0) + (r['quantity']||0);
  });
  const tbComb = $('tbProdCombined'); if (tbComb) {
    tbComb.innerHTML = Object.entries(combMap)
      .sort((a,b) => b[1]-a[1])
      .slice(0, 100)
      .map(([k,q]) => {
        const [prod,size,alum,glass,ch,pat,mesh] = k.split('|');
        return `<tr><td>${prod}</td><td>${size}</td><td>${alum}</td><td>${glass}</td><td>${ch}</td><td>${pat}</td><td>${mesh}</td><td class="num">${q}</td></tr>`;
      }).join('');
  }
}

// ── DETAIL TABLE ─────────────────────────────────────────────────
function renderDetail() {
  const rows = filtered;
  const start = (detailPage - 1) * DETAIL_PAGE;
  const end = start + DETAIL_PAGE;
  const page = rows.slice(start, end);

  const tbDetail = $('tbDetail'); if (tbDetail) {
    tbDetail.innerHTML = page.map(r => `
      <tr>
        <td>${r['id']}</td>
        <td>${fmt(r['order_date'])}</td>
        <td>${r['platform']||'—'}</td>
        <td>${r['product_name']||'—'}</td>
        <td>${r['size']||'—'}</td>
        <td>${r['channel']??'—'}</td>
        <td>${r['aluminum_color']||'—'}</td>
        <td>${r['glass_color']||'—'}</td>
        <td>${r['pattern']||'—'}</td>
        <td>${r['mosquito_net']||'—'}</td>
        <td class="num">${r['quantity']??0}</td>
        <td>${statusBadge(r['status'])}</td>
        <td>
          <button class="btn-icon edit" onclick="openEdit(${r['id']})">✎</button>
          <button class="btn-icon del" onclick="openDel(${r['id']})">🗑️</button>
        </td>
      </tr>
    `).join('');
  }

  // Pagination
  const totalPages = Math.ceil(rows.length / DETAIL_PAGE);
  const detailCount = $('detailCount');
  if (detailCount) detailCount.textContent = `${rows.length} รายการ`;

  const pagination = $('detailPagination'); if (pagination) {
    let html = '';
    if (detailPage > 1) html += `<button class="pg-btn" onclick="detailPage=1;renderDetail();">«</button>`;
    if (detailPage > 1) html += `<button class="pg-btn" onclick="detailPage=${detailPage-1};renderDetail();">‹</button>`;
    for (let i = 1; i <= totalPages; i++) {
      if (i >= detailPage-2 && i <= detailPage+2) {
        html += `<button class="pg-btn ${i===detailPage?'active':''}" onclick="detailPage=${i};renderDetail();">${i}</button>`;
      }
    }
    if (detailPage < totalPages) html += `<button class="pg-btn" onclick="detailPage=${detailPage+1};renderDetail();">›</button>`;
    if (detailPage < totalPages) html += `<button class="pg-btn" onclick="detailPage=${totalPages};renderDetail();">»</button>`;
    pagination.innerHTML = html;
  }
}

// ── LOAD DATA ─────────────────────────────────────────────────────
async function loadData() {
  const BATCH = 1000;
  const sub = document.querySelector('.header-sub');

  try {
    const connBadge = $('connBadge');
    if (connBadge) {
      const dot = connBadge.querySelector('.conn-dot');
      if (dot) dot.classList.remove('err');
    }
    
    const connText = $('connText');
    if (connText) connText.textContent = 'กำลังโหลด...';
    if (sub) sub.textContent = 'กำลังโหลดข้อมูล...';

    let allRows = [];
    let from = 0;
    let done = false;

    while (!done) {
      const { data, error } = await sb
        .from(TABLE)
        .select('*')
        .order('id', { ascending: false })
        .range(from, from + BATCH - 1);

      if (error) throw error;

      const batch = data || [];
      allRows = allRows.concat(batch);

      if (sub) sub.textContent = `โหลดแล้ว ${allRows.length.toLocaleString('th-TH')} รายการ...`;

      if (batch.length < BATCH) {
        done = true;
      } else {
        from += BATCH;
      }
    }

    allData = allRows;
    filtered = allData;

    buildAllDropdowns(allData);
    applyFilters();

    const now = new Date().toLocaleTimeString('th-TH');
    if (sub) sub.textContent = `ข้อมูลทั้งหมด ${allData.length.toLocaleString('th-TH')} รายการ • อัปเดต ${now}`;
    
    const lastUpdated = $('lastUpdated');
    if (lastUpdated) lastUpdated.textContent = now;
    
    if (connBadge) {
      const dot = connBadge.querySelector('.conn-dot');
      if (dot) dot.classList.remove('err');
    }
    if (connText) connText.textContent = 'เชื่อมต่อแล้ว';

  } catch(e) {
    console.error(e);
    toast('โหลดข้อมูลไม่สำเร็จ: ' + e.message, 'err');
    if (sub) sub.textContent = 'โหลดข้อมูลไม่สำเร็จ';
    const connBadge = $('connBadge');
    if (connBadge) {
      const dot = connBadge.querySelector('.conn-dot');
      if (dot) dot.classList.add('err');
    }
    const connText = $('connText');
    if (connText) connText.textContent = 'ไม่ได้เชื่อมต่อ';
  }
}

// ── MODAL: ADD/EDIT ───────────────────────────────────────────────
window.openEdit = async function(id) {
  editId = id;
  const modalTitle = $('modalTitle');
  if (modalTitle) modalTitle.textContent = `แก้ไขออเดอร์ #${id}`;
  
  const overlayForm = $('overlayForm');
  if (overlayForm) overlayForm.classList.add('open');
  
  try {
    const { data, error } = await sb.from(TABLE).select('*').eq('id', id).single();
    if (error) throw error;
    
    const fId = $('fId');
    if (fId) fId.value = data.id;
    
    const fDate = $('fDate');
    if (fDate) fDate.value = fmtDTLocal(data['order_date']);
    
    const fPlatformIn = $('fPlatformIn');
    if (fPlatformIn) fPlatformIn.value = data['platform']||'';
    
    const fProductIn = $('fProductIn');
    if (fProductIn) fProductIn.value = data['product_name']||'';
    
    const fSizeIn = $('fSizeIn');
    if (fSizeIn) fSizeIn.value = data['size']||'';
    
    const fChannelIn = $('fChannelIn');
    if (fChannelIn) fChannelIn.value = data['channel']??'';
    
    const fAlumIn = $('fAlumIn');
    if (fAlumIn) fAlumIn.value = data['aluminum_color']||'';
    
    const fGlassIn = $('fGlassIn');
    if (fGlassIn) fGlassIn.value = data['glass_color']||'';
    
    const fPatternIn = $('fPatternIn');
    if (fPatternIn) fPatternIn.value = data['pattern']||'';
    
    const fMeshIn = $('fMeshIn');
    if (fMeshIn) fMeshIn.value = data['mosquito_net']||'';
    
    const fQtyIn = $('fQtyIn');
    if (fQtyIn) fQtyIn.value = data['quantity']??1;

    const fPriceIn = $('fPriceIn');
    if (fPriceIn) fPriceIn.value = data['price']??'';
    
    const fStatusIn = $('fStatusIn');
    if (fStatusIn) fStatusIn.value = data['status']||'';
  } catch(e) { 
    toast('โหลดข้อมูลไม่สำเร็จ','err'); 
    closeForm(); 
  }
};

function openAdd() {
  editId = null;
  const modalTitle = $('modalTitle');
  if (modalTitle) modalTitle.textContent = 'เพิ่มออเดอร์ใหม่';
  
  const orderForm = $('orderForm');
  if (orderForm) orderForm.reset();
  
  const fId = $('fId');
  if (fId) fId.value = '';
  
  const fDate = $('fDate');
  if (fDate) fDate.value = fmtDTLocal(new Date());
  
  const fQtyIn = $('fQtyIn');
  if (fQtyIn) fQtyIn.value = 1;
  
  const overlayForm = $('overlayForm');
  if (overlayForm) overlayForm.classList.add('open');
}

function closeForm() {
  const overlayForm = $('overlayForm');
  if (overlayForm) overlayForm.classList.remove('open');
  editId = null;
}

async function saveOrder() {
  const payload = {
    'order_date':     $('fDate').value || null,
    'platform':       $('fPlatformIn').value || null,
    'product_name':   $('fProductIn').value || null,
    'size':           $('fSizeIn').value || null,
    'channel':        $('fChannelIn').value !== '' ? parseFloat($('fChannelIn').value) : null,
    'aluminum_color': $('fAlumIn').value || null,
    'glass_color':    $('fGlassIn').value || null,
    'pattern':        $('fPatternIn').value || null,
    'mosquito_net':   $('fMeshIn').value || null,
    'quantity':       parseInt($('fQtyIn').value)||1,
    'price':          $('fPriceIn')?.value !== '' ? parseFloat($('fPriceIn')?.value) : null,
    'status':         $('fStatusIn').value || null,
  };
  try {
    const btn = $('btnSaveForm');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
    let err;
    if (editId) {
      ({ error: err } = await sb.from(TABLE).update(payload).eq('id', editId));
    } else {
      ({ error: err } = await sb.from(TABLE).insert([payload]));
    }
    if (err) throw err;
    toast(editId ? 'แก้ไขสำเร็จ' : 'เพิ่มออเดอร์สำเร็จ', 'ok');
    closeForm();
    await loadData();
  } catch(e) {
    toast('บันทึกไม่สำเร็จ: ' + e.message, 'err');
  } finally {
    const btn = $('btnSaveForm');
    if (btn) { btn.disabled = false; btn.textContent = '💾 บันทึก'; }
  }
}

// ── MODAL: DELETE ─────────────────────────────────────────────────
window.openDel = function(id) {
  deleteId = id;
  const deleteLabel = $('deleteLabel');
  if (deleteLabel) deleteLabel.textContent = `#${id}`;
  
  const overlayDelete = $('overlayDelete');
  if (overlayDelete) overlayDelete.classList.add('open');
};

function closeDel() {
  const overlayDelete = $('overlayDelete');
  if (overlayDelete) overlayDelete.classList.remove('open');
  deleteId = null;
}

async function confirmDelete() {
  if (!deleteId) return;
  try {
    const { error } = await sb.from(TABLE).delete().eq('id', deleteId);
    if (error) throw error;
    toast('ลบออเดอร์สำเร็จ','ok');
    closeDel();
    await loadData();
  } catch(e) { toast('ลบไม่สำเร็จ: '+e.message,'err'); }
}

// ── EXPORT CSV ────────────────────────────────────────────────────
async function exportCsv() {
  toast('กำลังเตรียม CSV...','inf');
  try {
    const headers = ['id','order_date','platform','product_name','size','channel','aluminum_color','glass_color','pattern','mosquito_net','quantity','price','status'];
    const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
    const csv = [headers.join(','), ...filtered.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
    const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orders_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    toast(`ดาวน์โหลด ${filtered.length} รายการสำเร็จ`,'ok');
  } catch(e) { toast('Export ไม่สำเร็จ','err'); }
}

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Refresh
  const btnRefresh = $('btnRefresh');
  if (btnRefresh) btnRefresh.addEventListener('click', loadData);

  // Export
  const btnExport = $('btnExport');
  if (btnExport) btnExport.addEventListener('click', exportCsv);

  // Add order
  const btnAdd = $('btnAdd');
  if (btnAdd) btnAdd.addEventListener('click', openAdd);

  // Filter
  const btnFilter = $('btnFilter');
  if (btnFilter) btnFilter.addEventListener('click', applyFilters);
  
  const btnClear = $('btnClear');
  if (btnClear) btnClear.addEventListener('click', () => {
    ['fPlatform','fStatus','fProduct','fPattern','fMesh','fAlumColor','fGlassColor','fSize','fChannel','fMonth','fYear'].forEach(id => { 
      const el = $(id); if (el) el.value = ''; 
    });
    const fSearch = $('fSearch');
    if (fSearch) fSearch.value = '';
    const fOnlySelected = $('fOnlySelected');
    if (fOnlySelected) fOnlySelected.checked = false;
    applyFilters();
  });

  // Search on Enter
  const fSearch = $('fSearch');
  if (fSearch) fSearch.addEventListener('keydown', e => { if (e.key==='Enter') applyFilters(); });

  // Period type change re-renders chart label
  const fPeriodType = $('fPeriodType');
  if (fPeriodType) fPeriodType.addEventListener('change', renderCharts);

  // Form modal
  const btnCloseForm = $('btnCloseForm');
  if (btnCloseForm) btnCloseForm.addEventListener('click', closeForm);
  
  const btnCancelForm = $('btnCancelForm');
  if (btnCancelForm) btnCancelForm.addEventListener('click', closeForm);
  
  const overlayForm = $('overlayForm');
  if (overlayForm) overlayForm.addEventListener('click', e => { if (e.target===overlayForm) closeForm(); });
  
  const btnSaveForm = $('btnSaveForm');
  if (btnSaveForm) btnSaveForm.addEventListener('click', saveOrder);
  
  const orderForm = $('orderForm');
  if (orderForm) orderForm.addEventListener('submit', e => { e.preventDefault(); saveOrder(); });

  // Delete modal
  const btnCloseDelete = $('btnCloseDelete');
  if (btnCloseDelete) btnCloseDelete.addEventListener('click', closeDel);
  
  const btnCancelDelete = $('btnCancelDelete');
  if (btnCancelDelete) btnCancelDelete.addEventListener('click', closeDel);
  
  const overlayDelete = $('overlayDelete');
  if (overlayDelete) overlayDelete.addEventListener('click', e => { if (e.target===overlayDelete) closeDel(); });
  
  const btnConfirmDelete = $('btnConfirmDelete');
  if (btnConfirmDelete) btnConfirmDelete.addEventListener('click', confirmDelete);

  // Realtime
  sb.channel('rt-orders')
    .on('postgres_changes', { event:'*', schema:'public', table:TABLE }, () => {
      toast('ข้อมูลเปลี่ยนแปลง กำลังรีเฟรช...','inf');
      loadData();
    })
    .subscribe();

  // Initial load
  loadData();
});
