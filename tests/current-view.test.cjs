const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function setup() {
  const ctx = vm.createContext({ Intl, Date });
  vm.runInContext(html.slice(html.indexOf('function snapshotUpdatedText('), html.indexOf('// Latest progress')), ctx);
  vm.runInContext(html.split('// CURRENT_CONDITION_BEGIN')[1].split('// CURRENT_CONDITION_END')[0], ctx);
  return ctx;
}
const dataset = rows => { const cols = [...new Set(rows.flatMap(Object.keys))]; return { cols, rows: rows.map(r => cols.map(c => r[c] ?? null)) }; };
const location = { nik: '123', kode: '001', pw: 'Aceh', kat: '(2) Mandek > 3 bulan', alasan: 'Historic reason', nama: 'Name', desa: 'Desa' };
const row = extra => ({ 'NIK Koperasi (master)': '123', 'Kode Desa': '001', ...extra });
const state = (ctx, rows, kind = 'gerai') => ({ index: ctx.currentConditionIndex({ [kind]: dataset(rows) }), man: { source_dates: { portal_latest: '20261102T095210Z' } } });

test('latest building completion supersedes old mandek without claiming operating or complete sarpras', () => {
  const ctx = setup(), original = JSON.stringify(location);
  for (const extra of [
    { 'Progres terbaru (%)': 100, '(2) Mandek > 3 bulan': 1 },
    { 'Status pembangunan': 'Selesai', sarpras_unknown: true, '(1) Terbangun dengan kelengkapan': 1, '(4) Beroperasi': 1 },
  ]) {
    const view = ctx.currentLocationView(Object.freeze(location), state(ctx, [row(extra)]));
    assert.equal(view.category, '(1) Gedung terbangun');
    assert.match(view.reason, /Sarpras historis\/parsial.*belum diketahui/);
    assert.doesNotMatch(view.reason, /Beroperasi|sarpras lengkap/i);
  }
  assert.equal(JSON.stringify(location), original);
});

test('progress zero is not unknown; null never reuses historic progress or category', () => {
  const ctx = setup();
  const category = extra => ctx.currentLocationView(location, state(ctx, [row(extra)])).category;
  assert.equal(category({ 'Progres terbaru (%)': 0 }), 'Perlu verifikasi');
  assert.equal(category({ 'Progres terbaru (%)': null, 'Progres 6 Okt (%)': 100 }), 'Perlu verifikasi');
  assert.equal(category({ 'Progres terbaru (%)': 30 }), 'Perlu verifikasi');
  assert.equal(category({ 'Progres terbaru (%)': 30, '(2) Mandek > 3 bulan': 1 }), '(2) Mandek > 3 bulan');
  for (const status of ['Selesai', 'Sedang dibangun', 'Belum melapor progres']) assert.equal(category({ 'Status pembangunan': status }), status === 'Selesai' ? '(1) Gedung terbangun' : 'Perlu verifikasi');
});

test('stale, missing, ambiguous and error never present historical selection as current', () => {
  const ctx = setup();
  for (const current of [
    state(ctx, [row({ stale: true, 'Progres terbaru (%)': 100 })]),
    state(ctx, []), state(ctx, [row({}), row({})]), { error: true }, {},
  ]) assert.equal(ctx.currentLocationView(location, current).category, 'Perlu verifikasi');
  for (const current of [null, { loading: true }]) assert.equal(ctx.currentLocationView(location, current).category, 'Memuat');
  const land = ctx.currentLocationView(location, state(ctx, [row({})], 'belum_lahan'));
  assert.equal(land.category, '(3) Belum memiliki lahan');
  assert.match(land.reason, /dataset rekonstruksi; perlu verifikasi/);
  assert.match(ctx.currentLocationView(location, state(ctx, [])).reason, /bukan berarti belum memiliki lahan/);
});

test('unique historical operation takes priority without suppressing latest construction or claiming current operation', () => {
  const ctx = setup(), original = JSON.stringify(location);
  for (const [kind, extra, expected] of [
    ['gerai', { 'Progres terbaru (%)': 100 }, /Progres portal: 100%/],
    ['gerai', { 'Progres terbaru (%)': 20, '(2) Mandek > 3 bulan': 1 }, /Mandek > 3 bulan/],
    ['gerai', { 'Progres terbaru (%)': 0 }, /Progres portal: 0%/],
    ['belum_lahan', {}, /Tercatat belum memiliki lahan/],
    ['gerai', { stale: true, 'Progres terbaru (%)': 100 }, /retensi historis.*kondisi saat ini belum diketahui/],
  ]) {
    const current = state(ctx, [row(extra)], kind);
    current.operationIndex = ctx.currentConditionIndex({ beroperasi: dataset([row({ stale: true })]) });
    const view = ctx.currentLocationView(Object.freeze(location), current);
    assert.equal(view.category, '(4) Sudah beroperasi');
    assert.match(view.reason, /Bukti beroperasi pada data historis; bukan verifikasi operasi terkini/);
    assert.match(view.reason, /Kondisi pembangunan terbaru \(dapat berbeda/);
    assert.match(view.reason, expected);
    const counts = ctx.currentComposition([location], current);
    assert.equal(counts['(4) Sudah beroperasi'], 1);
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 1);
  }
  const missingBuilding = state(ctx, []);
  missingBuilding.operationIndex = ctx.currentConditionIndex({ beroperasi: dataset([row({})]) });
  assert.equal(ctx.currentLocationView(location, missingBuilding).category, '(4) Sudah beroperasi');
  assert.match(ctx.currentLocationView(location, missingBuilding).reason, /tidak ditemukan padanan unik/);
  assert.equal(JSON.stringify(location), original);
});

test('operation duplicates and contradictory exact code matches never infer operating from the original category', () => {
  const ctx = setup(), historic = { ...location, kat: '(4) Beroperasi — prioritas uji petik' };
  for (const rows of [[], [row({}), row({})], [{ 'NIK Koperasi': 'other', 'Kode Desa': location.kode }]]) {
    const current = state(ctx, []);
    current.operationIndex = ctx.currentConditionIndex({ beroperasi: dataset(rows) });
    assert.equal(ctx.currentLocationView(historic, current).category, 'Perlu verifikasi');
    assert.doesNotMatch(ctx.currentLocationView(historic, current).reason, /Bukti beroperasi/);
  }
  const current = state(ctx, [row({ 'Progres terbaru (%)': 100 })]);
  current.operationIndex = ctx.currentConditionIndex({ beroperasi: dataset([row({}), row({})]) });
  assert.equal(ctx.currentLocationView(historic, current).category, '(1) Gedung terbangun');
  current.operationIndex = ctx.currentConditionIndex({ beroperasi: dataset([row({})]) });
  assert.equal(ctx.currentLocationView({ ...historic, nik: '' }, current).category, '(4) Sudah beroperasi');
  current.operationIndex = ctx.currentConditionIndex({ beroperasi: dataset([row({}), { 'Kode Desa': location.kode }]) });
  assert.equal(ctx.currentLocationView({ ...historic, nik: '' }, current).category, '(1) Gedung terbangun');
});

test('every current category including unknown/loading contributes exactly once to totals', () => {
  const ctx = setup();
  const list = ['100', '30', '0', 'null', 'stale', 'mandek', 'land', 'missing'].map(nik => ({ ...location, nik, kode: nik }));
  const rows = [100, 30, 0, null].map(value => ({ 'NIK Koperasi (master)': String(value), 'Progres terbaru (%)': value }));
  rows.push({ 'NIK Koperasi (master)': 'stale', stale: true, 'Progres terbaru (%)': 100 }, { 'NIK Koperasi (master)': 'mandek', '(2) Mandek > 3 bulan': 1 });
  const current = { index: ctx.currentConditionIndex({ gerai: dataset(rows), belum_lahan: dataset([{ 'NIK Koperasi': 'land' }]) }) };
  const counts = ctx.currentComposition(list, current);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), list.length);
  assert.equal(counts['(1) Gedung terbangun'], 1);
  assert.equal(counts['(2) Mandek > 3 bulan'], 1);
  assert.equal(counts['(3) Belum memiliki lahan'], 1);
  assert.equal(counts['Perlu verifikasi'], 5);
  assert.equal(ctx.currentComposition(list, null).Memuat, list.length);
});

test('actual filter, KPI, ring summary, composition panel and CSV all use the current view', () => {
  const ctx = setup(), elements = {}, callbacks = {};
  let csv;
  Object.assign(ctx, {
    elements, callbacks, location,
    $: id => elements[id] ||= { value: '', innerHTML: '', classList: { add() {}, remove() {} }, addEventListener(event, fn) { callbacks[id + event] = fn; } },
    esc: value => String(value ?? '').replace(/</g, '&lt;'), fmt: String, short: String, title: String,
    pwCode: () => 'P01', canPropose: () => true, tanpaBatasLahan: () => false,
    pending: () => [], proyeksi: () => [location], komposisi: list => ({ n: list.length, k3: 0 }),
    MAXN: 10, MAX_LAHAN: 3, USUL: [], KATS: [['(4) Beroperasi — prioritas uji petik'], ['(4) Beroperasi — potensial uji petik']], tgl: () => '', setTimeout: () => {},
    Blob: class { constructor(parts) { csv = parts.join(''); } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) },
  });
  ctx.CONDITIONS = state(ctx, [row({ 'Progres terbaru (%)': 100 })]);
  ctx.EFF = { all: [location], lists: new Map([['P01', [location]]]) };
  ctx.DATA = { ringkasan: [{ no: 1, pw: 'Aceh', kantor: 'Kantor', dasar: 'STALE HISTORICAL BASIS' }] };
  vm.runInContext(html.slice(html.indexOf('  function refreshCategoryFilter()'), html.indexOf('  $("#tblRing").addEventListener')), ctx);
  // The summary listener uses #tblRing; isolate declarations, not the event wiring.
  vm.runInContext(html.slice(html.indexOf('  function filtered()'), html.indexOf('  $("#tblDaftar").addEventListener')), ctx);
  vm.runInContext(html.slice(html.indexOf('  $("#csv").addEventListener'), html.indexOf('  // ---------------- tab usulan')), ctx);
  ctx.$('#fPw').value = 'Aceh';
  ctx.$('#fKat').value = '(1) Gedung terbangun';
  assert.equal(ctx.filtered().length, 1);
  ctx.$('#fKat').value = location.kat;
  assert.equal(ctx.filtered().length, 0);
  ctx.$('#fKat').value = '(1) Gedung terbangun';
  ctx.renderKpi(); ctx.renderRing(); ctx.render();
  assert.match(elements['#kpis'].innerHTML, /Gedung terbangun/);
  assert.doesNotMatch(elements['#kpis'].innerHTML, /beroperasi|kelengkapan/);
  assert.match(elements['#tblRing'].innerHTML, /Gedung terbangun/);
  assert.doesNotMatch(elements['#tblRing'].innerHTML, /STALE HISTORICAL BASIS|\(4\) Ops/);
  assert.match(elements['#komp'].innerHTML, /Gedung terbangun: 1/);
  assert.match(elements['#komp'].innerHTML, /batas\/persetujuan usulan tetap memakai kategori pemilihan historis/);
  assert.match(elements['#tblDaftar'].innerHTML, /Kategori terkini/);
  assert.match(elements['#tblDaftar'].innerHTML, /<summary>Pemilihan historis<\/summary>/);
  callbacks['#csvclick']();
  assert.match(csv, /"Kategori terkini"/);
  assert.match(csv, /"Kategori pemilihan historis"/);
  assert.match(csv, /"\(1\) Gedung terbangun"/);
  assert.match(csv, /"\(2\) Mandek > 3 bulan";"Historic reason"/);
  assert.match(csv, /Progres portal: 100%/);
  ctx.CONDITIONS = null;
  ctx.$('#fKat').value = 'Memuat';
  assert.equal(ctx.filtered().length, 1);
  ctx.renderKpi(); ctx.renderRing();
  assert.match(elements['#kpis'].innerHTML, /role="status">Memuat kondisi terbaru/);
  assert.equal((elements['#kpis'].innerHTML.match(/class="kpi"/g) || []).length, 2);
  assert.doesNotMatch(elements['#tblRing'].innerHTML, /Memuat|Selesai|Beroperasi/);
  ctx.refreshCategoryFilter();
  assert.equal(elements['#fKat'].value, '');
  assert.doesNotMatch(elements['#fKat'].innerHTML, /Memuat/);

  // Actual generated HTML, not just helper counts: hide zero categories everywhere.
  ctx.CONDITIONS = state(ctx, [row({ 'Progres terbaru (%)': 100 })]);
  ctx.$('#fKat').value = '(1) Gedung terbangun';
  ctx.refreshCategoryFilter();
  assert.equal(elements['#fKat'].value, '(1) Gedung terbangun');
  ctx.renderKpi(); ctx.renderRing(); ctx.render();
  for (const id of ['#kpis', '#tblRing', '#komp', '#fKat']) {
    assert.match(elements[id].innerHTML, /Gedung terbangun/);
    assert.doesNotMatch(elements[id].innerHTML, /Sedang dibangun|Belum terverifikasi|Beroperasi|Belum melapor progres/);
  }

  ctx.CONDITIONS.operationIndex = ctx.currentConditionIndex({ beroperasi: dataset([row({})]) });
  ctx.refreshCategoryFilter();
  assert.equal(elements['#fKat'].value, '', 'removed category resets after evidence load');
  ctx.$('#fKat').value = '(4) Sudah beroperasi';
  ctx.refreshCategoryFilter();
  assert.equal(elements['#fKat'].value, '(4) Sudah beroperasi');
  ctx.renderKpi(); ctx.renderRing(); ctx.render();
  for (const id of ['#kpis', '#tblRing', '#komp', '#fKat']) {
    assert.match(elements[id].innerHTML, /\(4\) Sudah beroperasi/);
    assert.doesNotMatch(elements[id].innerHTML, /Gedung terbangun/);
  }
  assert.match(elements['#tblDaftar'].innerHTML, /class="badge bg4p">\(4\) Sudah beroperasi/);
  callbacks['#csvclick']();
  assert.match(csv, /"\(4\) Sudah beroperasi"/);
  assert.match(csv, /bukan verifikasi operasi terkini/);
  assert.match(csv, /Progres portal: 100%/);

  // Columns are global, whereas composition chips are local to each representative.
  const other = { ...location, nik: 'other', kode: 'other', pw: 'Other' };
  ctx.EFF.all.push(other);
  ctx.renderKpi(); ctx.renderRing(); ctx.render();
  assert.match(elements['#tblRing'].innerHTML, /Perlu verifikasi/);
  assert.doesNotMatch(elements['#komp'].innerHTML, /Perlu verifikasi/);
  assert.match(elements['#kpis'].innerHTML, /Perlu verifikasi: 1 lokasi/);
  assert.equal((elements['#kpis'].innerHTML.match(/class="kpi"/g) || []).length, 3, 'verification is a note, not an extra card');

  // All four numbered categories retain their original palette and are the only primary cards.
  const completed = { ...location, nik: 'complete', kode: 'complete' };
  const stalled = { ...location, nik: 'stalled', kode: 'stalled' };
  const landless = { ...location, nik: 'landless', kode: 'landless' };
  ctx.EFF.all.push(completed, stalled, landless);
  ctx.CONDITIONS.index = ctx.currentConditionIndex({
    gerai: dataset([row({ 'Progres terbaru (%)': 100 }), { 'NIK Koperasi': 'complete', 'Progres terbaru (%)': 100 }, { 'NIK Koperasi': 'stalled', '(2) Mandek > 3 bulan': 1 }]),
    belum_lahan: dataset([{ 'NIK Koperasi': 'landless' }]),
  });
  ctx.$('#fKat').value = '';
  ctx.renderKpi(); ctx.render();
  assert.equal((elements['#kpis'].innerHTML.match(/class="kpi"/g) || []).length, 6);
  for (const [category, cls, color] of [
    ['(4) Sudah beroperasi', 'bg4p', 'var(--blue)'],
    ['(2) Mandek > 3 bulan', 'bg2', 'var(--red)'],
    ['(1) Gedung terbangun', 'bg1', 'var(--ink)'],
    ['(3) Belum memiliki lahan', 'bg3', 'var(--ink)'],
  ]) {
    assert.equal(ctx.currentCategoryStyle(category).cls, cls);
    assert.equal(ctx.currentCategoryStyle(category).color, color);
    assert.ok(elements['#tblDaftar'].innerHTML.includes(`class="badge ${cls}">${category}`));
  }
});
