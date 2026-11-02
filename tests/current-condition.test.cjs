const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const context = vm.createContext({ Intl, Date });
vm.runInContext(html.slice(html.indexOf('function snapshotUpdatedText('), html.indexOf('// Latest progress')), context);
vm.runInContext(html.split('// CURRENT_CONDITION_BEGIN')[1].split('// CURRENT_CONDITION_END')[0], context);
const { currentConditionIndex: index, currentConditionMatch: match, currentConditionText: text } = context;
const dataset = rows => { const cols = [...new Set(rows.flatMap(Object.keys))]; return { cols, rows: rows.map(r => cols.map(c => r[c] ?? null)) }; };
const row = (nik = '123', kode = '11.01.01.2001', extra = {}) => ({ 'NIK Koperasi (master)': nik, 'Kode Desa': kode, ...extra });
const state = rows => ({ index: index({ gerai: dataset(rows) }), man: { source_dates: { portal_latest: '20261102T095210.224421Z' } } });
const lokus = { nik: '123', kode: '11.01.01.2001', kat: '(4) Beroperasi — prioritas uji petik', alasan: 'Alasan lama' };
test('unique NIK is preferred; exact unique code fallback cannot contradict NIK', () => {
  const i = index({ gerai: dataset([row(), row('456', 'other')]) });
  assert.equal(match(i, { nik: '123', kode: 'other' }).nik, '123');
  assert.equal(match(i, { kode: lokus.kode }).nik, '123');
  assert.equal(match(i, { nik: '999', kode: lokus.kode }), null);
  assert.equal(match(i, { kode: '1101012001' }), null);
  assert.equal(match(i, { kode: 'unknown' }), null);
});
test('duplicate NIK and duplicate code never select an arbitrary row, including across datasets', () => {
  assert.equal(match(index({ gerai: dataset([row(), row('123', 'other')]) }), lokus), null);
  const i = index({ gerai: dataset([row()]), belum_lahan: dataset([{ 'NIK Koperasi': '456', 'Kode Desa': lokus.kode }]) });
  assert.equal(match(i, { kode: lokus.kode }), null);
  assert.equal(match(i, lokus).nik, '123');
});
test('zero progress and sarpras are evidence, null is unknown; historical progress never substituted', () => {
  const zero = text(lokus, state([row('123', lokus.kode, { 'Progres terbaru (%)': 0, 'Item sarpras tiba/terpasang': 0 })]));
  assert.match(zero, /Progres portal: 0%/);
  assert.match(zero, /tiba\/terpasang 0 item/);
  assert.match(zero, /Status pembangunan belum diketahui/);
  const unknown = text(lokus, state([row('123', lokus.kode, { 'Progres terbaru (%)': null, 'Progres 6 Okt (%)': 100 })]));
  assert.match(unknown, /Progres portal: belum diketahui/);
  assert.doesNotMatch(unknown, /100%/);
  assert.match(unknown, /Sarpras historis\/parsial.*belum diketahui/);
  assert.match(zero, /Terakhir diperbarui: 2 November 2026/);
});
test('stale retained rows explicitly lack current evidence even if completed/operating historically', () => {
  const value = text(lokus, state([row('123', lokus.kode, { stale: true, 'Status pembangunan': 'Selesai', '(4) Beroperasi': 1, 'Progres terbaru (%)': 100 })]));
  assert.match(value, /Tidak ada dalam ekspor portal terbaru/);
  assert.doesNotMatch(value, /Selesai|Beroperasi|100%/);
});
test('all building statuses are shown independently of original category; mandek uses latest days', () => {
  for (const status of ['Selesai', 'Sedang dibangun', 'Belum melapor progres']) {
    const value = text(lokus, state([row('123', lokus.kode, { 'Status pembangunan': status, '(2) Mandek > 3 bulan': 1, 'Hari sejak dibuat': 340, 'Hari lewat target': 250 })]));
    assert.match(value, new RegExp(status));
    assert.match(value, /Mandek > 3 bulan.*340 hari.*250 hari/);
    assert.doesNotMatch(value, /Beroperasi/);
  }
  assert.match(text(lokus, state([row('123', lokus.kode, { 'Status pembangunan': 'unknown' })])), /Status pembangunan belum diketahui/);
});
test('missing and landless are distinct, and original category/reason remain immutable', () => {
  const before = JSON.stringify(lokus);
  assert.match(text(lokus, state([])), /bukan berarti belum memiliki lahan/);
  const landless = { index: index({ belum_lahan: dataset([{ 'NIK Koperasi': '123', 'Kode Desa': lokus.kode }]) }) };
  assert.match(text(lokus, landless), /Tercatat belum memiliki lahan pada dataset rekonstruksi/);
  assert.equal(JSON.stringify(lokus), before);
  assert.match(html, /esc\(x\.alasan\)/);
  assert.match(html, /badge\(x\.kat\)/);
});
test('same escaped plain text in table and CSV; loading/failure do not block original view', () => {
  assert.match(html, /esc\(currentConditionText\(x, CONDITIONS\)\)/);
  assert.match(html, /q\(currentConditionText\(x, CONDITIONS\)\)/);
  assert.match(text(lokus, null), /Memuat/);
  assert.match(text(lokus, { error: true }), /belum dapat dimuat/);
  assert.match(html, /USUL = \[\]; start\(\); loadCurrentConditions\(\)/);
});
test('loader is cached per session, guarded, and reads all gerai + landless in authorized scope', async () => {
  const calls = [], deferred = [];
  const loaderContext = vm.createContext({
    currentConditionIndex: index,
    render: () => calls.push('render'),
    reader: { pin: () => new Promise(resolve => deferred.push(resolve)), dataset: async (...args) => { calls.push(args); return dataset([row()]); } },
  });
  const loader = html.slice(html.indexOf('  function loadCurrentConditions()'), html.indexOf('  function resetReader()'));
  vm.runInContext('let CONDITIONS = null, SESSION = 1, READER = reader, ME = { role: "D302" };\n' + loader, loaderContext);
  vm.runInContext('loadCurrentConditions(); loadCurrentConditions();', loaderContext);
  assert.equal(deferred.length, 1);
  deferred.shift()({ man: {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.slice(0, 2).map(a => Array.from(a)), [['populasi_tw4', '', 'gerai'], ['populasi_tw4', '', 'belum_lahan']]);
  assert.equal(calls.at(-1), 'render');
  calls.length = 0;
  vm.runInContext('CONDITIONS = null; ME = { role: "PW", pw: "P10" }; loadCurrentConditions();', loaderContext);
  deferred.shift()({ man: {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(Array.from(calls[0]), ['populasi_pw', 'P10_', 'gerai']);
  calls.length = 0;
  vm.runInContext('CONDITIONS = null; loadCurrentConditions(); SESSION++;', loaderContext);
  deferred.shift()({ man: {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 0);
});
