// Offline tests for the per-lokus sarpras detail popup helpers (SARPRAS_DETAIL block).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function setup() {
  const ctx = vm.createContext({ Intl, Date, TextEncoder, crypto: webcrypto });
  vm.runInContext(html.split('// SARPRAS_DETAIL_BEGIN')[1].split('// SARPRAS_DETAIL_END')[0], ctx);
  return ctx;
}
const subtle = webcrypto.subtle;
async function sha256Hex(text) {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const shardOf = async (url) => await sha256Hex(url).then(hex => parseInt(hex.slice(0, 2), 16) % 8);

// Contract expected object (SARPRAS-DETAIL-SHARDS-CONTRACT.md, sarpras_detail_schema).
const SCHEMA = {
  version: 3,
  shards: ['sarpras_detail_00', 'sarpras_detail_01', 'sarpras_detail_02', 'sarpras_detail_03', 'sarpras_detail_04', 'sarpras_detail_05', 'sarpras_detail_06', 'sarpras_detail_07'],
  shard_count: 8, shard_key: 'portal_id', algorithm: 'sha256-first-byte-mod-8',
  identity: ['portal_id', 'NIK Koperasi (master)', 'Kode Desa'],
  item_missing_key: 'null', geography_join: 'gerai.portal_id',
  summary_only: ['gerai', 'mandek', 'terbangun'],
};
const DETAIL_COLS = ['portal_id', 'NIK Koperasi (master)', 'Kode Desa', 'stale', 'Status pembangunan', 'sarpras_state', 'sarpras_unknown', 'sarpras_source_date', 'sarpras_fresh_fetched_at', 'sarpras_source', 'sarpras_gap_reason', 'sarpras_observation', 'sarpras_detail'];
const detailRow = extra => Object.assign({
  portal_id: '019ac627-39c6-7bc6-bd84-bc0d53e36488', 'NIK Koperasi (master)': '7315021080001',
  'Kode Desa': '73.15.10.2002', stale: false, 'Status pembangunan': 'Sedang dibangun',
  sarpras_state: 'fresh', sarpras_unknown: false, sarpras_source_date: '2026-10-06',
  sarpras_fresh_fetched_at: null, sarpras_source: null, sarpras_gap_reason: null,
  sarpras_observation: null, sarpras_detail: null,
}, extra);
const toRows = obj => {
  const cols = DETAIL_COLS;
  return { cols, rows: obj.map(r => cols.map(c => r[c] ?? null)) };
};
const GERAI_COLS = ['portal_id', 'NIK Koperasi (master)', 'Kode Desa'];
const lokus = { nik: '7315021080001', kode: '73.15.10.2002', nama: 'Koperasi Desa Samaulue' };
const CATALOG_DIGEST = 'a'.repeat(64);
const catalog = [{ id: 'SARPRAS-1', name: 'Meja', priority: 'Mandatory', order: 3, group: 'MMD', jumlah_unit_per_paket: 2 },
                 { id: 'SARPRAS-2', name: 'Kursi', priority: 'High', order: null, group: 'MMD' },
                 { id: 'SARPRAS-3', name: 'Laptop', priority: 'Low', order: 1, group: 'Kantor' }];

function shardSpec(extra = {}) {
  return { cols: DETAIL_COLS, rows: [], projection_version: 3, reconciliation_mode: "row_partition", title: "Sarpras detail", ...extra };
}
function fakeReader(man, datasets) {
  const calls = [];
  return {
    calls,
    async pin(col, pre) { calls.push(['pin', col, pre]); return { man, version: 'snap-1', legacy: false }; },
    async dataset(col, pre, name) {
      calls.push(['dataset', name]);
      const data = datasets[name];
      if (!data) throw new Error('dataset tidak ada: ' + name);
      return data;
    },
    clear() {},
  };
}
function v3Manifest(datasets, overrides = {}, specExtras = {}) {
  const shards = { ...datasets };
  for (const name of SCHEMA.shards) {
    // Provided payloads are promoted to accurate v3 specs (projection_version 3 + row_partition).
    shards[name] = shards[name] ? { ...shards[name], projection_version: 3, reconciliation_mode: "row_partition" } : shardSpec(specExtras[name] || {});
  }
  return { datasets: shards, sarpras_detail_schema: { ...SCHEMA, ...overrides }, sarpras_catalogs: { [CATALOG_DIGEST]: catalog } };
}

test('fixed v3 manifest schema validation: exact declaration, exact eight shard specs, arbitrary datasets refused', () => {
  const ctx = setup();
  const specs = () => Object.fromEntries(SCHEMA.shards.map(n => [n, shardSpec()]));
  assert.equal(ctx.sarprasDetailMode({ datasets: specs(), sarpras_detail_schema: SCHEMA }), 'v3');
  for (const tampered of [
    { ...SCHEMA, shard_count: 4 }, { ...SCHEMA, shard_key: 'nik' }, { ...SCHEMA, algorithm: 'md5' },
    { ...SCHEMA, shards: SCHEMA.shards.slice(1) }, { ...SCHEMA, extra: 'x' },
    { ...SCHEMA, identity: ['portal_id', 'NIK Koperasi (master)'] },
  ]) {
    assert.equal(ctx.sarprasDetailMode({ datasets: specs(), sarpras_detail_schema: tampered }), 'invalid');
  }
  // Exact declared v3 but an arbitrary extra detail name present.
  const extra = { datasets: { ...specs(), sarpras_detail_08: shardSpec() }, sarpras_detail_schema: SCHEMA };
  assert.equal(ctx.sarprasDetailMode(extra), 'invalid');
  // Declared v3 but a shard dataset missing from the inventory is refused too.
  assert.equal(ctx.sarprasDetailMode({ datasets: {}, sarpras_detail_schema: SCHEMA }), 'invalid');
  // Every shard spec must declare projection_version 3 (strict number) and row_partition reconciliation.
  for (const bad of [
    shardSpec({ projection_version: 2 }), shardSpec({ projection_version: '3' }),
    shardSpec({ projection_version: true }), shardSpec({ projection_version: null }),
    shardSpec({ reconciliation_mode: 'historical' }), shardSpec({ reconciliation_mode: 'aggregate' }),
    { cols: DETAIL_COLS, rows: [] }, // both fields absent
    null, // spec missing entirely
  ]) {
    const withBad = { datasets: { ...specs() }, sarpras_detail_schema: SCHEMA };
    withBad.datasets.sarpras_detail_03 = bad;
    assert.equal(ctx.sarprasDetailMode(withBad), 'invalid', JSON.stringify(withBad.datasets.sarpras_detail_03));
  }
  // A shard spec entirely absent or non-object is refused.
  const noSpec = { datasets: specs(), sarpras_detail_schema: SCHEMA };
  delete noSpec.datasets.sarpras_detail_05;
  assert.equal(ctx.sarprasDetailMode(noSpec), 'invalid');
  // Legacy dedicated v2 dataset keeps explicit legacy handling, never arbitrary loads.
  assert.equal(ctx.sarprasDetailMode({ datasets: { sarpras_detail: {} } }), 'legacy');
  assert.equal(ctx.sarprasDetailMode({ datasets: {} }), 'absent');
  assert.equal(ctx.sarprasDetailMode({ datasets: { gerai: {} } }), 'absent');
});

test('shard destination is sha256 of exact portal_id UTF-8 bytes, first byte mod 8, no trim', async () => {
  const ctx = setup();
  const pid = '019ac627-39c6-7bc6-bd84-bc0d53e36488';
  const digest = await ctx.sarprasPortalDigest(pid, subtle, TextEncoder);
  const idx = ctx.sarprasShardIndex(digest);
  assert.equal(idx, parseInt((await sha256Hex(pid)).slice(0, 2), 16) % 8);
  assert.ok(idx >= 0 && idx < 8);
  // No case folding or trimming: different byte sequences route to their own destination.
  for (const variant of [pid + 'x', pid.toUpperCase(), ' ' + pid, pid.slice(0, 12)]) {
    const d = await ctx.sarprasPortalDigest(variant, subtle, TextEncoder);
    assert.equal(ctx.sarprasShardIndex(d), parseInt((await sha256Hex(variant)).slice(0, 2), 16) % 8);
  }
  assert.equal(ctx.sarprasShardIndex(null), -1);
});

test('strict identity resolution: exact NIK and Kode Desa, unique gerai row, never name/fuzzy join', () => {
  const ctx = setup();
  const pid = '019ac627-39c6-7bc6-bd84-bc0d53e36488';
  const one = ctx.sarprasIdentity({ cols: GERAI_COLS, rows: [[pid, '7315021080001', '73.15.10.2002']] }, lokus);
  assert.equal(one.ok, true);
  assert.equal(one.portalId, pid);
  // Duplicate gerai matching rows are rejected even when they carry the same portal id (no silent dedup).
  for (const rows of [
    [[pid, '7315021080001', '73.15.10.2002'], ['019aa', '7315021080001', '73.15.10.2002']], // two distinct portals
    [[pid, '7315021080001', '73.15.10.2002'], [pid, '7315021080001', '73.15.10.2002']],     // duplicate of the same portal row
  ]) {
    const result = ctx.sarprasIdentity({ cols: GERAI_COLS, rows }, lokus);
    assert.equal(result.ok, false);
    assert.match(result.reason, /unik|duplikat/);
  }
  // The portal id stays exact; only NIK/Kode use the document trim policy on both sides.
  const exact = ctx.sarprasIdentity({ cols: GERAI_COLS, rows: [[' id\t', ' 7315021080001 ', '73.15.10.2002']] }, lokus);
  assert.equal(exact.ok, true);
  assert.equal(exact.portalId, ' id\t', 'portal id preserved verbatim (internal blanks kept)');
  // Non-string portal ids never match.
  assert.equal(ctx.sarprasIdentity({ cols: GERAI_COLS, rows: [[123, '7315021080001', '73.15.10.2002']] }, lokus).ok, false);
  // Missing/blank NIK or Kode on the gerai row never matches.
  for (const vals of [['019x', null, '73.15.10.2002'], ['019x', '7315021080001', null], ['019x', '   ', '73.15.10.2002']]) {
    assert.equal(ctx.sarprasIdentity({ cols: GERAI_COLS, rows: [vals] }, lokus).ok, false);
  }
  // No fuzzy join: rows differing in NIK or Kode are ignored.
  assert.equal(ctx.sarprasIdentity({ cols: GERAI_COLS, rows: [['019x', '999', '73.15.10.2002']] }, lokus).ok, false);
  assert.equal(ctx.sarprasIdentity({ cols: GERAI_COLS, rows: [['019x', '7315021080001', '73.15.10.3001']] }, lokus).ok, false);
  assert.equal(ctx.sarprasIdentity({ cols: GERAI_COLS, rows: [['019x', '', '']] }, { nik: '', kode: '', nama: 'Koperasi X' }).ok, false);
});

test('shard row identity check is exact on both sides: missing NIK or Kode is a mismatch', () => {
  const ctx = setup();
  const row = { 'NIK Koperasi (master)': '7315021080001', 'Kode Desa': '73.15.10.2002', portal_id: 'x' };
  assert.equal(ctx.sarprasRowMismatch(row, lokus), false);
  assert.equal(ctx.sarprasRowMismatch({ 'NIK Koperasi (master)': null, 'Kode Desa': '73.15.10.2002' }, lokus), true, 'row NIK missing → mismatch');
  assert.equal(ctx.sarprasRowMismatch({ 'NIK Koperasi (master)': '7315021080001', 'Kode Desa': null }, lokus), true, 'row Kode missing → mismatch');
  assert.equal(ctx.sarprasRowMismatch(row, { nik: '', kode: '73.15.10.2002' }), true, 'lokus NIK missing → mismatch');
  assert.equal(ctx.sarprasRowMismatch(row, { nik: '7315021080001', kode: null }), true, 'lokus Kode missing → mismatch');
  assert.equal(ctx.sarprasRowMismatch({ 'NIK Koperasi (master)': ' 7315021080001 ', 'Kode Desa': '73.15.10.2002' }, lokus), false, 'NIK/Kode equality uses the trim policy');
  assert.equal(ctx.sarprasRowMismatch({ 'NIK Koperasi (master)': '999', 'Kode Desa': '73.15.10.2002' }, lokus), true);
  assert.equal(ctx.sarprasRowMismatch({ 'NIK Koperasi (master)': '7315021080001', 'Kode Desa': '73.15.10.9999' }, lokus), true);
  assert.equal(ctx.sarprasRowMismatch(null, lokus), true);
});

test('full resolver preserves exact portal ids: whitespace and unicode route by exact UTF-8 bytes', async () => {
  const ctx = setup();
  const exactPid = ' 019a—\u00e9Ünicode ';
  const idx = (parseInt((await sha256Hex(exactPid)).slice(0, 2), 16) % 8);
  const shardName = 'sarpras_detail_' + String(idx).padStart(2, '0');
  const cell = {
    sarpras_items: { 'SARPRAS-1': { status: 'tiba', jumlah_paket: 2 } },
    sarpras_catalog_sha256: CATALOG_DIGEST,
  };
  const lokusExact = { nama: 'Koperasi X', nik: '7315021080001', kode: '73.15.10.2002' };
  const datasets = {
    gerai: { cols: GERAI_COLS, rows: [[exactPid, ' 7315021080001 ', '73.15.10.2002']] },
    [shardName]: toRows([detailRow({
      portal_id: exactPid, sarpras_detail: cell,
      sarpras_fresh_fetched_at: null, sarpras_source: null, sarpras_gap_reason: null, sarpras_observation: null,
    })]),
  };
  const reader = fakeReader(v3Manifest(datasets), datasets);
  const result = await ctx.sarprasResolveDetail(reader, ['populasi_pw', 'P20_'], lokusExact, subtle, TextEncoder);
  assert.equal(result.phase, 'done');
  assert.equal(result.portalId, exactPid, 'portal id not trimmed or unicode-folded');
  assert.equal(result.shard, shardName);
  assert.deepEqual(reader.calls.filter(c => c[0] === 'dataset').map(c => c[1]), ['gerai', shardName]);
  assert.equal(result.delivery.tiba, 1);
});

test('pin-and-scope guard: exact scope per account role, PW codes P01–P36 only, never PW→national fallback', () => {
  const ctx = setup();
  assert.equal(JSON.stringify(ctx.sarprasScope({ role: 'D302' })), JSON.stringify(['populasi_tw4', '']));
  assert.equal(JSON.stringify(ctx.sarprasScope({ role: 'PW', pw: 'P20' })), JSON.stringify(['populasi_pw', 'P20_']));
  for (const bad of [
    { role: 'PW' },                                  // missing pw → refuse, no fallback
    { role: 'PW', pw: 'ALL' },                       // non-portal aggregate code
    { role: 'PW', pw: 'P00' }, { role: 'PW', pw: 'P37' }, { role: 'PW', pw: 'P01x' }, // out of P01–P36 range
    { role: 'PW', pw: 'Q20' }, { role: 'PW', pw: 'p20' },
    { role: 'PW', pw: 'P100' }, { role: 'PW', pw: 20 },
    { role: 'MANAGER', pw: 'P20' },                  // unknown role never gets a scope
  ]) assert.equal(ctx.sarprasScope(bad), null, JSON.stringify(bad));
  assert.equal(ctx.sarprasScope(null), null);
});

test('lazy: exactly one detail shard of the eight is fetched for the selected lokus', async () => {
  const ctx = setup();
  const pid = '019ac627-39c6-7bc6-bd84-bc0d53e36488';
  const idx = await shardOf(pid);
  const shardName = 'sarpras_detail_' + String(idx).padStart(2, '0');
  const datasets = {
    gerai: { cols: GERAI_COLS, rows: [[pid, '7315021080001', '73.15.10.2002']] },
    [shardName]: toRows([detailRow({
      sarpras_detail: { sarpras_items: { 'SARPRAS-1': { status: 'tiba', vendor: 'PT X' } }, sarpras_catalog_sha256: CATALOG_DIGEST,
        sarpras_detail_provenance: { observation: 'cached', fetched_at_utc: '2026-11-01T00:00:00Z' } },
    })]),
  };
  const reader = fakeReader(v3Manifest(datasets), datasets);
  const result = await ctx.sarprasResolveDetail(reader, ['populasi_pw', 'P20_'], lokus, subtle, TextEncoder);
  assert.equal(result.phase, 'done');
  assert.equal(result.shard, shardName);
  const shardCalls = reader.calls.filter(c => c[0] === 'dataset').map(c => c[1]);
  assert.deepEqual(shardCalls, ['gerai', shardName]);
  for (const other of SCHEMA.shards) if (other !== shardName) assert.ok(!shardCalls.includes(other), 'must not load ' + other);
  assert.deepEqual(reader.calls.find(c => c[0] === 'pin').slice(1), ['populasi_pw', 'P20_']);
  assert.equal(result.portalId, pid);
  assert.equal(result.delivery.tiba, 1);
});

test('catalog registry resolution is exact: unknown digest or off-registry items fail closed', async () => {
  const ctx = setup();
  const pid = '019ac627-39c6-7bc6-bd84-bc0d53e36488';
  const idx = await shardOf(pid);
  const shardName = 'sarpras_detail_' + String(idx).padStart(2, '0');
  const base = { gerai: { cols: GERAI_COLS, rows: [[pid, '7315021080001', '73.15.10.2002']] } };
  for (const cell of [
    { sarpras_items: { 'SARPRAS-1': { status: 'tiba' } }, sarpras_catalog_sha256: 'b'.repeat(64) }, // digest missing from registry
    { sarpras_items: { 'SARPRAS-9': { status: 'tiba' } }, sarpras_catalog_sha256: CATALOG_DIGEST },  // item not in pinned catalog
    { sarpras_items: { 'SARPRAS-1': { status: 'tiba', kolom_baru: 1 } }, sarpras_catalog_sha256: CATALOG_DIGEST }, // unknown item key
  ]) {
    const datasets = { ...base, [shardName]: toRows([detailRow({ sarpras_detail: cell })]) };
    const result = await ctx.sarprasResolveDetail(fakeReader(v3Manifest(datasets), datasets), ['populasi_pw', 'P20_'], lokus, subtle, TextEncoder);
    assert.equal(result.phase, 'error', JSON.stringify(cell).slice(0, 60));
    assert.match(result.err, /katalog|kolom/i);
  }
});

test('missing quantities and items stay null/unknown, never zero; unverified-only detail is never labeled arrived', async () => {
  const ctx = setup();
  // detail cell null: explicit dedicated null is authoritative.
  const none = ctx.sarprasDetailParse(null, {});
  assert.equal(none.ok, true);
  assert.equal(none.items, null);
  assert.equal(ctx.sarprasDelivery(null), null);
  assert.match(ctx.sarprasDeliveryText(null, false), /belum diketahui.*bukan nol/);
  assert.doesNotMatch(ctx.sarprasDeliveryText(null, false), /\b0\b/);
  // items present but quantities absent are null, not zero.
  const parsed = ctx.sarprasDetailParse({ sarpras_items: { 'SARPRAS-1': { status: 'tiba' } } }, { });
  assert.equal(parsed.ok, true);
  // shipment-only and tanpa_status-only stay unknown; never counted as delivered.
  for (const statuses of [['shipment'], ['tanpa_status'], ['shipment', 'tanpa_status']]) {
    const items = Object.fromEntries(statuses.map((s, i) => ['I' + i, { status: s }]));
    assert.equal(ctx.sarprasDelivery(items), null);
    const text = ctx.sarprasDeliveryText(ctx.sarprasDelivery(items), true);
    assert.match(text, /belum terverifikasi|belum diketahui/);
    assert.doesNotMatch(text, /Tiba: [1-9]/);
  }
  // Mixed evidence counts only tiba/terpasang; pengiriman/transit yield an explicit known zero delivered count.
  const mixed = ctx.sarprasDelivery({ A: { status: 'tiba' }, B: { status: 'terpasang' }, C: { status: 'pengiriman' }, D: { status: 'shipment' } });
  assert.deepEqual({ tiba: mixed.tiba, terpasang: mixed.terpasang, reported: mixed.reported }, { tiba: 1, terpasang: 1, reported: 4 });
  const knownZero = ctx.sarprasDelivery({ A: { status: 'pengiriman' }, B: { status: 'transit' } });
  assert.deepEqual({ tiba: knownZero.tiba, terpasang: knownZero.terpasang }, { tiba: 0, terpasang: 0 });
  const zeroText = ctx.sarprasDeliveryText(knownZero, true);
  assert.match(zeroText, /Tiba: 0/);
  assert.match(zeroText, /bukan bukti kelengkapan/);
});

test('shard row identity must verify against the selected lokus before rendering', async () => {
  const ctx = setup();
  const pid = '019ac627-39c6-7bc6-bd84-bc0d53e36488';
  const idx = await shardOf(pid);
  const shardName = 'sarpras_detail_' + String(idx).padStart(2, '0');
  const datasets = {
    gerai: { cols: GERAI_COLS, rows: [[pid, '7315021080001', '73.15.10.2002']] },
    [shardName]: toRows([detailRow({ portal_id: pid, 'NIK Koperasi (master)': 'berbeda', 'Kode Desa': '73.15.10.2002' })]),
  };
  const result = await ctx.sarprasResolveDetail(fakeReader(v3Manifest(datasets), datasets), ['populasi_pw', 'P20_'], lokus, subtle, TextEncoder);
  assert.equal(result.phase, 'error');
  assert.match(result.err, /integritas gagal/);
  // Missing portal row inside its own shard is an explicit error, not unknown-zero.
  const empty = { ...datasets, [shardName]: toRows([]) };
  const result2 = await ctx.sarprasResolveDetail(fakeReader(v3Manifest(empty), empty), ['populasi_pw', 'P20_'], lokus, subtle, TextEncoder);
  assert.equal(result2.phase, 'error');
  assert.match(result2.err, /shard/);
});

test('legacy snapshot without shards returns explicit gap, not arbitrary dataset loads', async () => {
  const ctx = setup();
  const legacy = { datasets: { gerai: { cols: [], rows: [] }, sarpras_detail: { cols: [], rows: [] } } };
  const reader = fakeReader(legacy, legacy.datasets);
  const result = await ctx.sarprasResolveDetail(reader, ['populasi_pw', 'P20_'], lokus, subtle, TextEncoder);
  assert.equal(result.phase, 'legacy');
  assert.equal(reader.calls.filter(c => c[0] === 'dataset').length, 0, 'legacy mode must not load the dedicated detail dataset implicitly');
});

test('session/stale guard invalidates in-flight popup renders on logout, session change, or closed modal', () => {
  const ctx = setup();
  const state = { session: 7, reader: 'R1' };
  assert.equal(ctx.sarprasPopupStale(state, { me: { role: 'D302' }, session: 7, reader: 'R1', dlgOpen: true }), false);
  assert.equal(ctx.sarprasPopupStale(state, { me: { role: 'D302' }, session: 8, reader: 'R1', dlgOpen: true }), true); // epoch changed
  assert.equal(ctx.sarprasPopupStale(state, { me: { role: 'D302' }, session: 7, reader: 'R2', dlgOpen: true }), true); // new reader
  assert.equal(ctx.sarprasPopupStale(state, { me: null, session: 7, reader: 'R1', dlgOpen: true }), true); // logged out
  assert.equal(ctx.sarprasPopupStale(state, { me: { role: 'D302' }, session: 7, reader: 'R1', dlgOpen: false }), true); // modal closed
});

test('parser whitelists known statuses, validates quantities, and requires own-property 64hex catalog digests', () => {
  const ctx = setup();
  for (const bad of [
    { sarpras_items: { A: { status: 'dikirim' } } },                                  // invented status
    { sarpras_items: { A: { status: 'Tiba' } } },                                     // wrong case (statuses are exact)
    { sarpras_items: { A: { status: 'tiba', jumlah_paket: -1 } } },                   // negative
    { sarpras_items: { A: { status: 'tiba', jumlah_paket: '2' } } },                  // numeric string, not a number
    { sarpras_items: { A: { status: 'tiba', jumlah_paket: Infinity } } },             // non-finite
    { sarpras_items: { A: { status: 'tiba', jumlah_paket: NaN } } },
    { sarpras_items: { A: { status: 'tiba' } }, sarpras_catalog_sha256: 'z'.repeat(64) },
    { sarpras_items: { A: { status: 'tiba' } }, sarpras_catalog_sha256: 'A'.repeat(64) }, // uppercase rejected
    { sarpras_items: { A: { status: 'tiba' } }, sarpras_catalog_sha256: 'a'.repeat(63) }, // wrong length
  ]) assert.equal(ctx.sarprasDetailParse(bad, { [CATALOG_DIGEST]: catalog }).ok, false, JSON.stringify(bad));
  // Catalog digest must be an own property of the registry (prototype chains never count).
  const protoCatalogs = Object.create({ [CATALOG_DIGEST]: catalog });
  assert.equal(ctx.sarprasDetailParse({ sarpras_items: { A: { status: 'tiba' } }, sarpras_catalog_sha256: CATALOG_DIGEST }, protoCatalogs).ok, false);
  // Valid shapes: all six known statuses, missing/null quantities, explicit null catalog reference.
  for (const good of [
    { sarpras_items: { 'SARPRAS-1': { status: 'tiba', jumlah_paket: 0 } }, sarpras_catalog_sha256: CATALOG_DIGEST },
    { sarpras_items: { A: { status: 'tanpa_status' }, B: { status: 'shipment' } } },
    { sarpras_items: { A: { status: 'pengiriman' }, B: { status: 'transit' } }, sarpras_catalog_sha256: null },
  ]) assert.equal(ctx.sarprasDetailParse(good, { [CATALOG_DIGEST]: catalog }).ok, true, JSON.stringify(good));
  // Unknown statuses that reach counts make delivery unknown — never a known zero and never arrived.
  assert.equal(ctx.sarprasDelivery({ A: { status: 'tiba' }, B: { status: 'dikirim' } }), null);
  assert.equal(ctx.sarprasDelivery({ A: { status: 'Tiba' } }), null);
});

test('popup is wired per lokus row with accessible dialog reuse and keyboard-operable buttons', () => {
  // Static structure of the shipped page.
  assert.ok(html.includes('<dialog id="dlg" aria-labelledby="dlgTitle">'), 'dialog must keep its accessible label');
  assert.ok(html.includes('data-act="detail" data-no='), 'daftar rows expose a detail trigger');
  assert.ok(html.includes('aria-label="Detail sarpras '), 'detail trigger carries an accessible name');
  assert.ok(/<button class="mini" type="button" data-act="detail"/.test(html), 'detail trigger is a keyboard-operable button');
  assert.ok(html.includes('id="spTutup"'), 'popup foot exposes a Close button');
  assert.ok(html.includes('openSarpras('), 'popup opened from the daftar click handler');
});
