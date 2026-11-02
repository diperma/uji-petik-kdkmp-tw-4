const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const columns = ['kind', 'NIK Koperasi (master)', 'NIK Koperasi', 'Kode Desa', 'stale', 'Status pembangunan', 'Progres terbaru (%)', '(2) Mandek > 3 bulan', 'Hari sejak dibuat', 'Hari lewat target', 'Item sarpras tiba/terpasang', 'sarpras_unknown', 'sarpras_source_date'];
const ctx = vm.createContext({ Intl, Date });
vm.runInContext(html.slice(html.indexOf('function snapshotUpdatedText('), html.indexOf('// Latest progress')), ctx);
vm.runInContext(html.split('// CURRENT_CONDITION_BEGIN')[1].split('// CURRENT_CONDITION_END')[0], ctx);
const table = rows => {
  const cols = [...new Set(rows.flatMap(Object.keys))];
  return { cols, rows: rows.map(row => cols.map(col => row[col] ?? null)) };
};
const project = groups => ({ cols: columns, rows: Object.entries(groups).flatMap(([kind, rows]) => rows.map(row => columns.map(col => col === 'kind' ? kind : row[col] ?? null))) });
const indexed = groups => ({
  index: ctx.currentConditionIndex({ gerai: groups.gerai, belum_lahan: groups.belum_lahan }),
  operationIndex: ctx.currentConditionIndex({ beroperasi: groups.beroperasi }),
  man: { source_dates: { portal_latest: '20261102T095210Z' } },
});
test('compact projection preserves matching, current categories and reasons from all three full tables', () => {
  const r = (nik, kode, extra = {}) => ({ 'NIK Koperasi (master)': nik, 'Kode Desa': kode, ignored: 'not projected', ...extra });
  const groups = {
    gerai: [r('zero', 'zero-code', { 'Progres terbaru (%)': 0, 'Item sarpras tiba/terpasang': 0 }), r('null', 'null-code'),
      r('stale', 'stale-code', { stale: true, 'Status pembangunan': 'Selesai', 'Progres terbaru (%)': 100 }),
      r('dup', 'dup-a'), r('dup', 'dup-b'), r('code-a', 'dup-code'), r('operating', 'operation-code', { '(2) Mandek > 3 bulan': 1, 'Hari sejak dibuat': 340, 'Hari lewat target': 250 }),
      r('complete', 'complete-code', { 'Progres terbaru (%)': 100, 'sarpras_unknown': true, 'Item sarpras tiba/terpasang': 5, 'sarpras_source_date': '2026-10-06' })],
    belum_lahan: [{ 'NIK Koperasi': 'land', 'Kode Desa': 'land-code' }, { 'NIK Koperasi': 'code-b', 'Kode Desa': 'dup-code' }],
    beroperasi: [r('operating', 'operation-code', { stale: true }), r('stale', 'stale-code'), r('op-dup', 'op-a'), r('op-dup', 'op-b'), r('complete', 'conflicting-code')],
  };
  const full = indexed(Object.fromEntries(Object.entries(groups).map(([kind, rows]) => [kind, table(rows)])));
  const compact = indexed(ctx.currentConditionProjection(project(groups), { projection_version: 1 }));
  const locations = Object.values(groups).flat().map(row => ({ nik: row['NIK Koperasi (master)'] ?? row['NIK Koperasi'], kode: row['Kode Desa'], kat: 'original category', alasan: 'original reason' }));
  locations.push({ kode: 'dup-code' }, { kode: 'zero-code' }, { nik: 'mismatch', kode: 'land-code' }, { nik: 'absent' }, { kode: 'operation-code' });
  for (const location of locations) {
    const before = JSON.stringify(location);
    assert.equal(JSON.stringify(ctx.currentLocationView(location, compact)), JSON.stringify(ctx.currentLocationView(location, full)));
    for (const name of ['index', 'operationIndex']) {
      const a = ctx.currentConditionMatch(full[name], location), b = ctx.currentConditionMatch(compact[name], location);
      assert.equal(a?.kind, b?.kind);
      assert.equal(a?.nik, b?.nik);
      assert.equal(a?.kode, b?.kode);
    }
    assert.equal(JSON.stringify(location), before);
  }
});
test('projection rejects unknown versions, altered columns and unexpected kinds', () => {
  const good = project({ gerai: [{ 'NIK Koperasi': '123' }] });
  for (const version of [undefined, null, 0, 2, '1']) assert.throws(() => ctx.currentConditionProjection(good, { projection_version: version }));
  for (const cols of [columns.slice(1), [...columns, 'extra'], columns.map(col => col === 'stale' ? 'Stale' : col), [...columns].reverse()]) {
    assert.throws(() => ctx.currentConditionProjection({ ...good, cols }, { projection_version: 1 }));
  }
  for (const kind of ['other', '__proto__', 'toString', null, 'GERAI', ['gerai']]) {
    assert.throws(() => ctx.currentConditionProjection({ cols: columns, rows: [[kind, ...good.rows[0].slice(1)]] }, { projection_version: 1 }));
  }
});
const loaderCode = html.slice(html.indexOf('  function loadCurrentConditions()'), html.indexOf('  function resetReader()'));
const settle = () => new Promise(resolve => setImmediate(resolve));
function loader(man, data = project({ gerai: [{ 'NIK Koperasi': '123' }], belum_lahan: [], beroperasi: [] }), me = { role: 'D302' }) {
  const calls = [];
  const context = vm.createContext({
    currentConditionIndex: ctx.currentConditionIndex, currentConditionProjection: ctx.currentConditionProjection,
    reader: { pin: async (...args) => { calls.push(['pin', ...args]); return { man }; }, dataset: async (...args) => { calls.push(args); if (data instanceof Error) throw data; return data; } },
    refresh: () => calls.push(['refresh']), me,
  });
  vm.runInContext('let CONDITIONS = null, SESSION = 1, READER = reader, ME = me;\n' + loaderCode, context);
  return { calls, context, state: () => vm.runInContext('CONDITIONS', context) };
}
test('advertised compact loader fetches only kondisi in authorized scope, cached for session', async () => {
  for (const [me, scope] of [[{ role: 'D302' }, ['populasi_tw4', '']], [{ role: 'PW', pw: 'P10' }, ['populasi_pw', 'P10_']]]) {
    const fixture = loader({ datasets: { kondisi: { projection_version: 1 } } }, undefined, me);
    vm.runInContext('loadCurrentConditions(); loadCurrentConditions();', fixture.context);
    await settle();
    vm.runInContext('loadCurrentConditions();', fixture.context);
    assert.deepEqual(fixture.calls, [['pin', ...scope], [...scope, 'kondisi'], ['refresh']]);
    assert.equal(fixture.state().loading, false);
    assert.equal(fixture.state().error, undefined);
    assert.ok(fixture.state().index);
    assert.ok(fixture.state().operationIndex);
  }
});
test('advertised invalid or corrupt compact data fails closed without legacy fallback', async () => {
  const good = project({ gerai: [{ 'NIK Koperasi': '123' }] });
  for (const [spec, data] of [[{ projection_version: 2 }, good], [null, good], [{}, good], [{ projection_version: 1 }, new Error('checksum mismatch')], [{ projection_version: 1 }, { ...good, cols: [...columns].reverse() }], [{ projection_version: 1 }, project({ invalid: [{}] })]]) {
    const fixture = loader({ datasets: { kondisi: spec } }, data);
    vm.runInContext('loadCurrentConditions();', fixture.context);
    await settle();
    assert.equal(fixture.state().error, true);
    assert.equal(fixture.state().loading, false);
    assert.equal(fixture.state().index, undefined);
    assert.ok(fixture.calls.every(call => !['gerai', 'belum_lahan', 'beroperasi'].includes(call[2])));
  }
});
test('compact fetch completion after session reset cannot publish indexes or refresh', async () => {
  const fixture = loader({ datasets: { kondisi: { projection_version: 1 } } });
  let finish;
  fixture.context.reader.dataset = async (...args) => { fixture.calls.push(args); return new Promise(resolve => { finish = resolve; }); };
  vm.runInContext('loadCurrentConditions();', fixture.context);
  await settle();
  vm.runInContext('SESSION++;', fixture.context);
  finish(project({ gerai: [{}] }));
  await settle();
  assert.equal(fixture.state().index, undefined);
  assert.equal(fixture.calls.some(call => call[0] === 'refresh'), false);
});
