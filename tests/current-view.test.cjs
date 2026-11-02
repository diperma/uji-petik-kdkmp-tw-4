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
    assert.equal(view.category, 'Selesai');
    assert.match(view.reason, /Sarpras historis\/parsial.*belum diketahui/);
    assert.doesNotMatch(view.reason, /Beroperasi|sarpras lengkap/i);
  }
  assert.equal(JSON.stringify(location), original);
});

test('progress zero is not unknown; null never reuses historic progress or category', () => {
  const ctx = setup();
  const category = extra => ctx.currentLocationView(location, state(ctx, [row(extra)])).category;
  assert.equal(category({ 'Progres terbaru (%)': 0 }), 'Belum melapor progres');
  assert.equal(category({ 'Progres terbaru (%)': null, 'Progres 6 Okt (%)': 100 }), 'Belum terverifikasi');
  assert.equal(category({ 'Progres terbaru (%)': 30 }), 'Sedang dibangun');
  assert.equal(category({ 'Progres terbaru (%)': 30, '(2) Mandek > 3 bulan': 1 }), 'Mandek > 3 bulan');
  for (const status of ['Selesai', 'Sedang dibangun', 'Belum melapor progres']) assert.equal(category({ 'Status pembangunan': status }), status);
});

test('stale, missing, ambiguous and error never present historical selection as current', () => {
  const ctx = setup();
  for (const current of [
    state(ctx, [row({ stale: true, 'Progres terbaru (%)': 100 })]),
    state(ctx, []), state(ctx, [row({}), row({})]), { error: true }, {},
  ]) assert.equal(ctx.currentLocationView(location, current).category, 'Belum terverifikasi');
  for (const current of [null, { loading: true }]) assert.equal(ctx.currentLocationView(location, current).category, 'Memuat');
  const land = ctx.currentLocationView(location, state(ctx, [row({})], 'belum_lahan'));
  assert.equal(land.category, 'Belum memiliki lahan');
  assert.match(land.reason, /dataset rekonstruksi; perlu verifikasi/);
  assert.match(ctx.currentLocationView(location, state(ctx, [])).reason, /bukan berarti belum memiliki lahan/);
});

test('every current category including unknown/loading contributes exactly once to totals', () => {
  const ctx = setup();
  const list = ['100', '30', '0', 'null', 'stale', 'mandek', 'land', 'missing'].map(nik => ({ ...location, nik, kode: nik }));
  const rows = [100, 30, 0, null].map(value => ({ 'NIK Koperasi (master)': String(value), 'Progres terbaru (%)': value }));
  rows.push({ 'NIK Koperasi (master)': 'stale', stale: true, 'Progres terbaru (%)': 100 }, { 'NIK Koperasi (master)': 'mandek', '(2) Mandek > 3 bulan': 1 });
  const current = { index: ctx.currentConditionIndex({ gerai: dataset(rows), belum_lahan: dataset([{ 'NIK Koperasi': 'land' }]) }) };
  const counts = ctx.currentComposition(list, current);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), list.length);
  assert.equal(counts['Selesai'], 1);
  assert.equal(counts['Sedang dibangun'], 1);
  assert.equal(counts['Mandek > 3 bulan'], 1);
  assert.equal(counts['Belum melapor progres'], 1);
  assert.equal(counts['Belum memiliki lahan'], 1);
  assert.equal(counts['Belum terverifikasi'], 3);
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
    MAXN: 10, MAX_LAHAN: 3, USUL: [], tgl: () => '', setTimeout: () => {},
    Blob: class { constructor(parts) { csv = parts.join(''); } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) },
  });
  ctx.CONDITIONS = state(ctx, [row({ 'Progres terbaru (%)': 100 })]);
  ctx.EFF = { all: [location], lists: new Map([['P01', [location]]]) };
  ctx.DATA = { ringkasan: [{ no: 1, pw: 'Aceh', kantor: 'Kantor', dasar: 'STALE HISTORICAL BASIS' }] };
  vm.runInContext(html.slice(html.indexOf('  function renderKpi()'), html.indexOf('  $("#tblRing").addEventListener')), ctx);
  // The summary listener uses #tblRing; isolate declarations, not the event wiring.
  vm.runInContext(html.slice(html.indexOf('  function filtered()'), html.indexOf('  $("#tblDaftar").addEventListener')), ctx);
  vm.runInContext(html.slice(html.indexOf('  $("#csv").addEventListener'), html.indexOf('  // ---------------- tab usulan')), ctx);
  ctx.$('#fPw').value = 'Aceh';
  ctx.$('#fKat').value = 'Selesai';
  assert.equal(ctx.filtered().length, 1);
  ctx.$('#fKat').value = location.kat;
  assert.equal(ctx.filtered().length, 0);
  ctx.$('#fKat').value = 'Selesai';
  ctx.renderKpi(); ctx.renderRing(); ctx.render();
  assert.match(elements['#kpis'].innerHTML, /Selesai/);
  assert.doesNotMatch(elements['#kpis'].innerHTML, /beroperasi|kelengkapan/);
  assert.match(elements['#tblRing'].innerHTML, /Selesai/);
  assert.doesNotMatch(elements['#tblRing'].innerHTML, /STALE HISTORICAL BASIS|\(4\) Ops/);
  assert.match(elements['#komp'].innerHTML, /Selesai: 1/);
  assert.match(elements['#komp'].innerHTML, /batas\/persetujuan usulan tetap memakai kategori pemilihan historis/);
  assert.match(elements['#tblDaftar'].innerHTML, /Kategori terkini/);
  assert.match(elements['#tblDaftar'].innerHTML, /<summary>Pemilihan historis<\/summary>/);
  callbacks['#csvclick']();
  assert.match(csv, /"Kategori terkini"/);
  assert.match(csv, /"Kategori pemilihan historis"/);
  assert.match(csv, /"Selesai"/);
  assert.match(csv, /"\(2\) Mandek > 3 bulan";"Historic reason"/);
  assert.match(csv, /Progres portal: 100%/);
  ctx.CONDITIONS = null;
  ctx.$('#fKat').value = 'Memuat';
  assert.equal(ctx.filtered().length, 1);
  ctx.renderKpi(); ctx.renderRing();
  assert.match(elements['#kpis'].innerHTML, /Memuat/);
});
