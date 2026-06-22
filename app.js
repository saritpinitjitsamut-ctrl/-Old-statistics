/* ================================================================
   ORDER STATS DASHBOARD - app.js  (v2 — matches screenshot)
   Single-page: load everything once, filter client-side + re-render
   ================================================================ */
'use strict';

const SUPABASE_URL = 'https://jzznuebmaqmizlzszdmw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6em51ZWJtYXFtaXpsenN6ZG13Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzg4MDcsImV4cCI6MjA5NzY1NDgwN30.Wez55je4jznFySSEE2XT9UYpE3WuuouVHvRCEB8MWbw';
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
  const m = { 'สำเร็จ':'b-green','จัดส่งแล้ว':'b-green','กำลังผลิต':'b-blue','รอส่ง':'b-orange','รับออเดอร์':'b-orange','ยกเลิก':'b-red' };
  return `<span class="badge ${m[s]||'b-gray'}">${s}</span>`;
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
  rows.forEach(r => { const v = r[key]||'—'; m[v] = (m[v]||0) + (r['จำนวน']||0); });
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
function buildDropdown(elId, values, currentVal='') {
  const el = $(elId); if (!el) return;
  const saved = currentVal || el.value;
  const sorted = [...new Set(values.filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b)));
  el.innerHTML = `<option value="">ทั้งหมด</option>` + sorted.map(v => `<option value="${v}">${v}</option>`).join('');
  if (saved) el.value = saved;
}

function buildAllDropdowns(data) {
  buildDropdown('fPlatform',  data.map(r => r['แพลตฟอร์ม']));
  buildDropdown('fStatus',    data.map(r => r['สถานะ']));
  buildDropdown('fProduct',   data.map(r => r['ชื่อสินค้า']));
  buildDropdown('fPattern',   data.map(r => r['ลาย']));
  buildDropdown('fMesh',      data.map(r => r['มุ้ง']));
  buildDropdown('fAlumColor', data.map(r => r['สีอลูมิเนียม']));
  buildDropdown('fGlassColor',data.map(r => r['สีกระจก']));
  buildDropdown('fSize',      data.map(r => r['ขนาด']));
  buildDropdown('fMeshType',  data.map(r => r['มุ้ง']));
  buildDropdown('fChannel',   data.map(r => r['ช่อง'] != null ? String(r['ช่อง']) : null));

  // populate datalist for form
  const dl = $('dPlatform'); if (!dl) return;
  const plats = [...new Set(data.map(r => r['แพลตฟอร์ม']).filter(Boolean))].sort();
  dl.innerHTML = plats.map(p => `<option value="${p}">`).join('');

  // form status options
  const statuses = [...new Set(data.map(r => r['สถานะ']).filter(Boolean))].sort();
  const fsi = $('fStatusIn');
  if (fsi) {
    const base = ['รับออเดอร์','กำลังผลิต','รอส่ง','จัดส่งแล้ว','สำเร็จ','ยกเลิก'];
    const all  = [...new Set([...base, ...statuses])];
    fsi.innerHTML = `<option value="">เลือกสถานะ</option>` + all.map(s => `<option>${s}</option>`).join('');
  }

  // year dropdown
  const years = [...new Set(data.map(r => {
    const d = new Date(r['วันที่'] || r['created_at']); return isNaN(d) ? null : d.getFullYear();
  }).filter(Boolean))].sort((a,b) => b-a);
  buildDropdown('fYear', years.map(String));
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
  const meshType  = val('fMeshType');
  const channel   = val('fChannel');
  const month     = val('fMonth');
  const year      = val('fYear');
  const search    = val('fSearch').trim().toLowerCase();

  const onlySelected = $('fOnlySelected')?.checked;

  filtered = allData.filter(r => {
    if (platform  && r['แพลตฟอร์ม']   !== platform)  return false;
    if (status    && r['สถานะ']        !== status)    return false;
    if (product   && r['ชื่อสินค้า']   !== product)   return false;
    if (pattern   && r['ลาย']          !== pattern)   return false;
    if (mesh      && r['มุ้ง']         !== mesh)      return false;
    if (alumColor && r['สีอลูมิเนียม'] !== alumColor) return false;
    if (glass     && r['สีกระจก']      !== glass)     return false;
    if (size      && r['ขนาด']         !== size)      return false;
    if (meshType  && r['มุ้ง']         !== meshType)  return false;
    if (channel   && String(r['ช่อง']) !== channel)   return false;

    if (month || year) {
      const d = new Date(r['วันที่'] || r['created_at']);
      if (isNaN(d)) return false;
      if (month && String(d.getMonth()+1) !== month) return false;
      if (year  && String(d.getFullYear()) !== year)  return false;
    }

    if (search) {
      const hay = [r['ชื่อสินค้า'],r['แพลตฟอร์ม'],r['สถานะ'],r['สีอลูมิเนียม'],r['สีกระจก'],r['ขนาด']].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }

    // ถ้าติ๊ก "มีเฉพาะข้อมูลที่กรองแล้ว" จะแสดงเฉพาะแถวที่มีค่าไม่ว่างในคอลัมน์ที่เลือก
    if (onlySelected) {
      const hasValue = [r['แพลตฟอร์ม'],r['สถานะ'],r['ชื่อสินค้า'],r['ลาย'],r['มุ้ง'],r['สีอลูมิเนียม'],r['สีกระจก'],r['ขนาด']].some(v => v && String(v).trim() !== '');
      if (!hasValue) return false;
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
  $('kpiFiltered').textContent  = rows.length.toLocaleString('th-TH');
  $('kpiTotal').textContent     = allData.length.toLocaleString('th-TH');
  $('kpiQty').textContent       = rows.reduce((s,r) => s+(r['จำนวน']||0), 0).toLocaleString('th-TH');
  $('kpiDone').textContent      = rows.filter(r => r['สถานะ']==='สำเร็จ'||r['สถานะ']==='จัดส่งแล้ว').length.toLocaleString('th-TH');
  $('kpiTopProduct').textContent  = modeOf(rows,'ชื่อสินค้า');
  $('kpiTopPlatform').textContent = modeOf(rows,'แพลตฟอร์ม');
}

// ── CHARTS ───────────────────────────────────────────────────────
function renderCharts() {
  const rows = filtered;
  const periodType = val('fPeriodType');

  // ── Monthly chart ──────────────────────────────────────────────
  if (periodType === 'month' || periodType === 'all') {
    const monthly = {};
    rows.forEach(r => {
      const d = new Date(r['วันที่']||r['created_at']);
      if (isNaN(d)) return;
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      monthly[key] = (monthly[key]||0) + 1;
    });
    const keys = Object.keys(monthly).sort();
    const labels = keys.map(k => { const [y,m] = k.split('-'); return `${['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][+m-1]} ${+y+543}`; });
    makeBar('chartMonth', labels, keys.map(k => monthly[k]), '#3b7ef5');
    $('monthChartInfo').textContent = `${keys.length} เดือน`;
  } else if (periodType === 'year') {
    const yearly = {};
    rows.forEach(r => {
      const d = new Date(r['วันที่']||r['created_at']); if (isNaN(d)) return;
      const k = String(d.getFullYear());
      yearly[k] = (yearly[k]||0)+1;
    });
    const keys = Object.keys(yearly).sort();
    makeBar('chartMonth', keys.map(k => `ปี ${+k+543}`), keys.map(k => yearly[k]), '#3b7ef5');
    $('monthChartInfo').textContent = `${keys.length} ปี`;
  }

  // ── Daily chart (last 30 days of filtered) ─────────────────────
  const daily = {};
  const today = new Date(); today.setHours(23,59,59,999);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate()-29); cutoff.setHours(0,0,0,0);
  for (let d = new Date(cutoff); d <= today; d.setDate(d.getDate()+1)) {
    daily[d.toISOString().slice(0,10)] = 0;
  }
  rows.forEach(r => {
    const d = new Date(r['วันที่']||r['created_at']); if (isNaN(d)) return;
    const k = d.toISOString().slice(0,10);
    if (daily.hasOwnProperty(k)) daily[k]++;
  });
  const dayKeys = Object.keys(daily).sort();
  const dayLabels = dayKeys.map(k => { const d = new Date(k); return `${d.getDate()}/${d.getMonth()+1}`; });
  makeBar('chartDay', dayLabels, dayKeys.map(k => daily[k]), '#22c55e');
  $('dayChartInfo').textContent = '30 วันล่าสุด';
}

// ── SUMMARY TABLES ────────────────────────────────────────────────
function renderSummaryTables() {
  const rows = filtered;

  // สรุปสีอลูมิเนียม
  renderSimpleTable('tbAlum', countBy(rows,'สีอลูมิเนียม'), ['สีอลูมิเนียม','จำนวน']);

  // สรุปสีกระจก
  renderSimpleTable('tbGlass', countBy(rows,'สีกระจก'), ['สีกระจก','จำนวน']);

  // สรุปแพลตฟอร์ม (จำนวน + ยอดรวมชิ้น)
  const platCnt = countBy(rows,'แพลตฟอร์ม');
  const platQty = sumQtyBy(rows,'แพลตฟอร์ม');
  const platRows = Object.entries(platCnt).sort((a,b)=>b[1]-a[1]);
  $('tbPlatform').innerHTML = platRows.length
    ? platRows.map(([k,v]) => `<tr><td>${k}</td><td class="num">${v}</td><td class="num">${(platQty[k]||0).toLocaleString()}</td></tr>`).join('')
    : '<tr><td colspan="3" class="center">ไม่มีข้อมูล</td></tr>';

  // สินค้า + สีอลูมิเนียม
  renderPivot('tbProdAlum', rows, 'ชื่อสินค้า','สีอลูมิเนียม');

  // สินค้า + สีกระจก
  renderPivot('tbProdGlass', rows, 'ชื่อสินค้า','สีกระจก');

  // สินค้า + มุ้ง
  renderPivot('tbProdMesh', rows, 'ชื่อสินค้า','มุ้ง');

  // สินค้า + ขนาด
  renderPivot('tbProdSize', rows, 'ชื่อสินค้า','ขนาด');
}

function renderSimpleTable(tbodyId, countMap, [col1, col2]) {
  const entries = Object.entries(countMap).sort((a,b)=>b[1]-a[1]);
  $(tbodyId).innerHTML = entries.length
    ? entries.map(([k,v]) => `<tr><td>${k}</td><td class="num">${v.toLocaleString()}</td></tr>`).join('')
    : `<tr><td colspan="2" class="center">ไม่มีข้อมูล</td></tr>`;
}

function renderPivot(tbodyId, rows, key1, key2) {
  const m = {};
  rows.forEach(r => {
    const k = `${r[key1]||'—'}|${r[key2]||'—'}`;
    m[k] = (m[k]||0) + (r['จำนวน']||0);
  });
  const entries = Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,30);
  $(tbodyId).innerHTML = entries.length
    ? entries.map(([k,v]) => {
        const [a,b] = k.split('|');
        return `<tr><td>${a}</td><td>${b}</td><td class="num">${v.toLocaleString()}</td></tr>`;
      }).join('')
    : `<tr><td colspan="3" class="center">ไม่มีข้อมูล</td></tr>`;
}

// ── DETAIL TABLE ─────────────────────────────────────────────────
function renderDetail() {
  const total = filtered.length;
  const start = (detailPage-1)*DETAIL_PAGE;
  const pageRows = filtered.slice(start, start+DETAIL_PAGE);

  $('detailCount').textContent = `${total.toLocaleString('th-TH')} รายการ`;

  const tbody = $('tbDetail');
  if (!pageRows.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="center">ไม่พบข้อมูล</td></tr>';
  } else {
    tbody.innerHTML = pageRows.map(r => `
      <tr>
        <td><strong>#${r.id}</strong></td>
        <td>${fmt(r['วันที่'])}</td>
        <td>${r['แพลตฟอร์ม']||'—'}</td>
        <td title="${r['ชื่อสินค้า']||''}">${(r['ชื่อสินค้า']||'—').substring(0,22)}</td>
        <td>${r['ขนาด']||'—'}</td>
        <td>${r['ช่อง']??'—'}</td>
        <td>${r['สีอลูมิเนียม']||'—'}</td>
        <td>${r['สีกระจก']||'—'}</td>
        <td>${r['ลาย']||'—'}</td>
        <td>${r['มุ้ง']||'—'}</td>
        <td class="num"><strong>${r['จำนวน']??'—'}</strong></td>
        <td>${statusBadge(r['สถานะ'])}</td>
        <td style="white-space:nowrap">
          <button class="btn-icon edit" onclick="openEdit(${r.id})" title="แก้ไข">✏️</button>
          <button class="btn-icon del"  onclick="openDel(${r.id})"  title="ลบ">🗑️</button>
        </td>
      </tr>`).join('');
  }

  // pagination
  const totalPages = Math.ceil(total / DETAIL_PAGE);
  const pg = $('detailPagination');
  if (totalPages <= 1) { pg.innerHTML = ''; return; }
  let html = `<button class="pg-btn" ${detailPage<=1?'disabled':''} onclick="goPg(${detailPage-1})">‹</button>`;
  const s = Math.max(1, detailPage-2), e = Math.min(totalPages, detailPage+2);
  if (s>1) html += `<button class="pg-btn" onclick="goPg(1)">1</button><span style="color:var(--txt3);padding:0 3px">…</span>`;
  for (let i=s; i<=e; i++) html += `<button class="pg-btn ${i===detailPage?'active':''}" onclick="goPg(${i})">${i}</button>`;
  if (e<totalPages) html += `<span style="color:var(--txt3);padding:0 3px">…</span><button class="pg-btn" onclick="goPg(${totalPages})">${totalPages}</button>`;
  html += `<button class="pg-btn" ${detailPage>=totalPages?'disabled':''} onclick="goPg(${detailPage+1})">›</button>`;
  pg.innerHTML = html;
}

window.goPg = p => { detailPage = p; renderDetail(); };

// ── LOAD DATA (paginated — fetches ALL rows regardless of count) ──
let realtimeChannel = null;

async function loadData() {
  const BATCH = 1000;
  const sub   = document.querySelector('.header-sub');

  try {
    $('connBadge').querySelector('.conn-dot').classList.remove('err');
    $('connBadge').querySelector('span:last-child').textContent = 'กำลังโหลด...';
    if (sub) sub.textContent = 'กำลังโหลดข้อมูล...';

    let allRows = [];
    let from    = 0;
    let done    = false;

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

      // if fewer rows than BATCH were returned → we have all the data
      if (batch.length < BATCH) {
        done = true;
      } else {
        from += BATCH;
      }
    }

    allData  = allRows;
    filtered = allData;

    buildAllDropdowns(allData);
    applyFilters();

    const now = new Date().toLocaleTimeString('th-TH');
    if (sub) sub.textContent = `ข้อมูลทั้งหมด ${allData.length.toLocaleString('th-TH')} รายการ • อัปเดต ${now}`;
    $('lastUpdated').textContent = now;
    $('connBadge').querySelector('.conn-dot').classList.remove('err');
    $('connBadge').querySelector('span:last-child').textContent = 'เชื่อมต่อแล้ว';

  } catch(e) {
    console.error(e);
    toast('โหลดข้อมูลไม่สำเร็จ: ' + e.message, 'err');
    if (sub) sub.textContent = 'โหลดข้อมูลไม่สำเร็จ';
    $('connBadge').querySelector('.conn-dot').classList.add('err');
    $('connBadge').querySelector('span:last-child').textContent = 'ไม่ได้เชื่อมต่อ';
  }
}

// ── MODAL: ADD/EDIT ───────────────────────────────────────────────
window.openEdit = async function(id) {
  editId = id;
  $('modalTitle').textContent = `แก้ไขออเดอร์ #${id}`;
  $('overlayForm').classList.add('open');
  try {
    const { data, error } = await sb.from(TABLE).select('*').eq('id', id).single();
    if (error) throw error;
    $('fId').value = data.id;
    $('fDate').value     = fmtDTLocal(data['วันที่']);
    $('fPlatformIn').value = data['แพลตฟอร์ม']||'';
    $('fProductIn').value  = data['ชื่อสินค้า']||'';
    $('fSizeIn').value     = data['ขนาด']||'';
    $('fChannelIn').value  = data['ช่อง']??'';
    $('fAlumIn').value     = data['สีอลูมิเนียม']||'';
    $('fGlassIn').value    = data['สีกระจก']||'';
    $('fPatternIn').value  = data['ลาย']||'';
    $('fMeshIn').value     = data['มุ้ง']||'';
    $('fQtyIn').value      = data['จำนวน']??1;
    $('fStatusIn').value   = data['สถานะ']||'';
  } catch(e) { toast('โหลดข้อมูลไม่สำเร็จ','err'); closeForm(); }
};

function openAdd() {
  editId = null;
  $('modalTitle').textContent = 'เพิ่มออเดอร์ใหม่';
  $('orderForm').reset();
  $('fId').value = '';
  $('fDate').value = fmtDTLocal(new Date());
  $('fQtyIn').value = 1;
  $('overlayForm').classList.add('open');
}

function closeForm() {
  $('overlayForm').classList.remove('open');
  editId = null;
}

async function saveOrder() {
  const payload = {
    'วันที่':          $('fDate').value || null,
    'แพลตฟอร์ม':      $('fPlatformIn').value || null,
    'ชื่อสินค้า':      $('fProductIn').value  || null,
    'ขนาด':           $('fSizeIn').value     || null,
    'ช่อง':           $('fChannelIn').value !== '' ? parseFloat($('fChannelIn').value) : null,
    'สีอลูมิเนียม':   $('fAlumIn').value    || null,
    'สีกระจก':        $('fGlassIn').value   || null,
    'ลาย':            $('fPatternIn').value  || null,
    'มุ้ง':           $('fMeshIn').value    || null,
    'จำนวน':          parseInt($('fQtyIn').value)||1,
    'สถานะ':          $('fStatusIn').value  || null,
  };
  try {
    const btn = $('btnSaveForm');
    btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
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
    btn.disabled = false; btn.textContent = '💾 บันทึก';
  }
}

// ── MODAL: DELETE ─────────────────────────────────────────────────
window.openDel = function(id) {
  deleteId = id;
  $('deleteLabel').textContent = `#${id}`;
  $('overlayDelete').classList.add('open');
};

function closeDel() {
  $('overlayDelete').classList.remove('open');
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
    const headers = ['id','วันที่','แพลตฟอร์ม','ชื่อสินค้า','ขนาด','ช่อง','สีอลูมิเนียม','สีกระจก','ลาย','มุ้ง','จำนวน','สถานะ','created_at'];
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
  $('btnRefresh').addEventListener('click', loadData);

  // Export
  $('btnExport').addEventListener('click', exportCsv);

  // Add order
  $('btnAdd').addEventListener('click', openAdd);

  // Filter
  $('btnFilter').addEventListener('click', applyFilters);
  $('btnClear').addEventListener('click', () => {
    ['fPlatform','fStatus','fProduct','fPattern','fMesh','fAlumColor','fGlassColor','fSize','fMeshType','fChannel','fMonth','fYear'].forEach(id => { $(id).value = ''; });
    $('fSearch').value = '';
    $('fOnlySelected').checked = false;
    applyFilters();
  });

  // Search on Enter
  $('fSearch').addEventListener('keydown', e => { if (e.key==='Enter') applyFilters(); });

  // Period type change re-renders chart label
  $('fPeriodType').addEventListener('change', renderCharts);

  // Form modal
  $('btnCloseForm').addEventListener('click', closeForm);
  $('btnCancelForm').addEventListener('click', closeForm);
  $('overlayForm').addEventListener('click', e => { if (e.target===$('overlayForm')) closeForm(); });
  $('btnSaveForm').addEventListener('click', saveOrder);
  $('orderForm').addEventListener('submit', e => { e.preventDefault(); saveOrder(); });

  // Delete modal
  $('btnCloseDelete').addEventListener('click', closeDel);
  $('btnCancelDelete').addEventListener('click', closeDel);
  $('overlayDelete').addEventListener('click', e => { if (e.target===$('overlayDelete')) closeDel(); });
  $('btnConfirmDelete').addEventListener('click', confirmDelete);

  // Realtime — unsubscribe previous channel first to avoid duplicates
  if (realtimeChannel) {
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  realtimeChannel = sb.channel('rt-orders')
    .on('postgres_changes', { event:'*', schema:'public', table:TABLE }, () => {
      toast('ข้อมูลเปลี่ยนแปลง กำลังรีเฟรช...','inf');
      loadData();
    })
    .subscribe();

  // Initial load
  loadData();
});
