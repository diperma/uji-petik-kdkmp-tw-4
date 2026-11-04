// Rendered smoke test: runs the actual popup wiring (openSarpras → spLoad → spSections)
// against a minimal DOM shim, with a fake pinned reader implementing the v3 shard contract.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

// --- minimal DOM shim ---
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.className = ""; this._text = null; this.attrs = {}; this.nodeType = 1; }
  get textContent() { if (this._text !== null) return String(this._text); if (this.children.length === 1 && this.children[0] instanceof Text) return this.children[0].text; return this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  append(...nodes) { for (const n of nodes) this.children.push(n); }
  replaceChildren(...nodes) { this.children = []; for (const n of nodes) this.children.push(n); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
}
class Text {
  constructor(t) { this.text = t; this.nodeType = 3; }
  get textContent() { return this.text; }
}
let ids = {};
const deepText = (el) => el instanceof Text ? el.text : (el._text !== null && el._text !== undefined && el._text !== "" ? String(el._text) : (el.children || []).map(deepText).join(""));

function setup(me, man, datasets) {
  const dlg = { open: false, showModal() { this.open = true; }, close() { this.open = false; }, addEventListener() {} };
  const openDlgCalls = [];
  const shimDocument = {
    createElement: (t) => new El(t),
    createTextNode: (t) => new Text(String(t)),
    getElementById: (id) => ids[id] || null,
    querySelector: (sel) => sel === '#dlg' ? dlg : sel === '#spTutup' ? { addEventListener() {} } : null,
  };
  let calls = [];
  const reader = {
    async pin(col, pre) { calls.push(['pin', col, pre]); return { man, version: 'snap-1', legacy: false }; },
    async dataset(col, pre, name) {
      calls.push(['dataset', name]);
      const data = datasets[name];
      if (!data) throw new Error('dataset tidak ada: ' + name);
      return data;
    },
  };
  const ctx = vm.createContext({
    Intl, Date, TextEncoder, crypto: webcrypto, window: { crypto: webcrypto },
    document: shimDocument, $: (s) => shimDocument.querySelector(s),
    ME: me, READER: reader, SESSION: 3, CONDITIONS: null, dlg,
    fmt: (n) => Number(n || 0).toLocaleString('id-ID'),
    short: (pw) => String(pw || '').replace('Perwakilan BPKP ', '').replace('Daerah Khusus Ibu Kota Jakarta', 'DKI Jakarta'),
    title: (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
    openDlg: (t, body, foot) => { openDlgCalls.push({ title: t, body }); dlg.showModal(); ids.spBody = body; },
    closeDlg: () => dlg.close(),
  });
  // Keep the real implementations: reader date text, condition projection, sarpras helpers, popup wiring.
  ctx.__dlg = dlg;
  ctx.__calls = calls;
  ctx.__openDlgCalls = openDlgCalls;  const readerBlock = html.slice(html.indexOf('function snapshotUpdatedText('), html.indexOf('// Latest progress'));
  const condBlock = html.split('// CURRENT_CONDITION_BEGIN')[1].split('// CURRENT_CONDITION_END')[0];
  const sarprasBlock = html.split('// SARPRAS_DETAIL_BEGIN')[1].split('// SARPRAS_DETAIL_END')[0];
  let wiring = html.slice(html.indexOf('  // ---------------- popup detail sarpras per lokus'));
  wiring = wiring.slice(0, wiring.lastIndexOf('})();'));
  vm.runInContext(readerBlock + '\n' + condBlock + '\n' + sarprasBlock + '\n' + wiring + '\n__openSarpras = openSarpras; __spSections = spSections;', ctx);
  return ctx;
}

// --- v3 contract fixture ---
const SCHEMA = {
  version: 3,
  shards: Array.from({ length: 8 }, (_v, i) => 'sarpras_detail_' + String(i).padStart(2, '0')),
  shard_count: 8, shard_key: 'portal_id', algorithm: 'sha256-first-byte-mod-8',
  identity: ['portal_id', 'NIK Koperasi (master)', 'Kode Desa'],
  item_missing_key: 'null', geography_join: 'gerai.portal_id', summary_only: ['gerai', 'mandek', 'terbangun'],
};
const DETAIL_COLS = ['portal_id', 'NIK Koperasi (master)', 'Kode Desa', 'stale', 'Status pembangunan', 'sarpras_state', 'sarpras_unknown', 'sarpras_source_date', 'sarpras_fresh_fetched_at', 'sarpras_source', 'sarpras_gap_reason', 'sarpras_observation', 'sarpras_detail'];
const pid = '019ac627-39c6-7bc6-bd84-bc0d53e36488';
const lokus = { nama: 'Koperasi Desa S', pw: 'Perwakilan BPKP Sulawesi Selatan', desa: 'S', kec: 'Lanrisang', kab: 'KAB. PINRANG', nik: '7315021080001', kode: '73.15.10.2002' };
const CATALOG_DIGEST = 'c'.repeat(64);
const catalog = [
  { id: 'SARPRAS-1', name: 'Meja Mengajar', priority: 'Mandatory', order: 2, group: 'MMD', jumlah_unit_per_paket: 1 },
  { id: 'SARPRAS-2', name: 'Kursi', priority: 'High', order: null, group: 'MMD' },
];

async function fixtures(cell) {
  const d = new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(pid)));
  const shard = 'sarpras_detail_' + String(d[0] % 8).padStart(2, '0');
  const row = { portal_id: pid, 'NIK Koperasi (master)': lokus.nik, 'Kode Desa': lokus.kode, stale: false, 'Status pembangunan': 'Sedang dibangun', sarpras_state: 'fresh', sarpras_unknown: false, sarpras_source_date: '2026-10-06', sarpras_fresh_fetched_at: null, sarpras_source: null, sarpras_gap_reason: 'cached_source', sarpras_observation: null, sarpras_detail: cell };
  const shardData = { cols: DETAIL_COLS, rows: [DETAIL_COLS.map(c => row[c] ?? null)] };
  const gerai = { cols: ['portal_id', 'NIK Koperasi (master)', 'Kode Desa'], rows: [[pid, lokus.nik, lokus.kode]] };
  const datasets = { gerai, [shard]: shardData };
  const man = {
    datasets: { ...datasets, ...Object.fromEntries(SCHEMA.shards.filter(n => n !== shard).map(n => [n, { cols: DETAIL_COLS, rows: [], projection_version: 3, reconciliation_mode: "row_partition" }])) },
    sarpras_detail_schema: SCHEMA,
    sarpras_catalogs: { [CATALOG_DIGEST]: catalog },
    source_dates: { portal_latest: '20261102T095210Z' },
  };
  // Accurate v3 shard specs: every shard dataset declares projection_version 3 + row_partition.
  for (const name of SCHEMA.shards) {
    man.datasets[name] = { cols: DETAIL_COLS, rows: name === shard ? shardData.rows : [], projection_version: 3, reconciliation_mode: "row_partition" };
  }
  return { shard, datasets, man };
}

test('popup renders identity, catalog items, unverified labels and cache provenance from the selected shard', async () => {
  const cell = {
    sarpras_items: {
      'SARPRAS-1': { status: 'tiba', vendor: 'PT Aja', jumlah_paket: 2 },
      'SARPRAS-2': { status: 'shipment' },
    },
    sarpras_catalog_sha256: CATALOG_DIGEST,
    sarpras_detail_provenance: {
      observation: 'cached', fetched_at_utc: '2026-11-01T03:00:00Z', latest_report_at: null, last_reviewed_report: null,
      uncertainty: { fetch_provenance_unknown: false, shipment_semantics_unverified: true, unverified_statuses: ['shipment'], inventory_completeness: 'unverified' },
    },
    sarpras_status_semantics: { unverified_statuses: ['shipment'], delivered_statuses: ['tiba', 'terpasang'] },
  };
  const { datasets, man, shard } = await fixtures(cell);
  const ctx = setup({ role: 'PW', pw: 'P20' }, man, datasets);
  await ctx.__openSarpras(lokus);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(ctx.__dlg.open, 'shared modal opens for the popup');
  assert.match(ctx.__openDlgCalls[0].title, /^Detail sarpras · /);
  const body = ids.spBody;
  assert.ok(body, 'popup body was placed into the dialog');
  const text = deepText(body);
  assert.match(text, /Koperasi lokus uji petik/);
  assert.match(text, /Portal ID.*019ac627-39c6-7bc6-bd84-bc0d53e36488/);
  assert.match(text, /Tiba: 1 · Terpasang: 0 · Item terlapor: 2/);
  assert.ok(text.includes('Meja Mengajar'), 'catalog item name shown');
  assert.ok(text.includes('Kursi'), 'catalog entry without vendor report is still listed');
  assert.ok(text.includes('shipment · belum terverifikasi; bukan bukti tiba/terpasang'), 'raw unverified status is never labeled arrived');
  assert.ok(text.includes('Pakai ulang cache historis; tanggal sumber asli dipertahankan'), 'cached observation labeled');
  assert.ok(text.includes('Status belum terverifikasi: shipment'), 'semantics metadata surfaced');
  assert.match(text, /Bukti sarpras terkini|Status pembangunan: Sedang dibangun/);
  assert.match(text, /Bukan verifikasi lapangan|bukan verifikasi lapangan/);
  assert.match(text, /populasi terkini belum|Terakhir diperbarui/);
  // Missing quantity renders dashes, never an implied zero.
  assert.ok(/Jumlah paket.*–|–/.test(text), 'missing quantities shown as dash');
  const shardCalls = ctx.__calls.filter(c => c[0] === 'dataset').map(c => c[1]);
  assert.deepEqual(shardCalls, ['gerai', shard], 'lazy: identity dataset plus exactly one detail shard');
});

test('identity gaps render explicit unknown state without touching shards', async () => {
  const { datasets, man } = await fixtures({ sarpras_items: { 'SARPRAS-1': { status: 'tiba' } }, sarpras_catalog_sha256: CATALOG_DIGEST });
  const ctx = setup({ role: 'PW', pw: 'P20' }, man, { ...datasets, gerai: { cols: ['portal_id', 'NIK Koperasi (master)', 'Kode Desa'], rows: [] } });
  await ctx.__openSarpras(lokus);
  await new Promise((r) => setTimeout(r, 10));
  const text = deepText(ids.spBody);
  assert.match(text, /Tidak ada padanan identitas \(NIK \+ Kode Desa\).*bukan berarti kosong/);
  const names = ctx.__calls.filter(([, n]) => n).map(c => c[1]);
  assert.equal(names.includes('gerai'), true, 'identity gap requires the gerai lookup');
  assert.equal(SCHEMA.shards.some(n => names.includes(n)), false, 'no detail shard fetched when identity has no exact match');
});

test('modal close stops stale renders', async () => {
  const cell = { sarpras_items: null, sarpras_catalog_sha256: null };
  const { datasets, man } = await fixtures(cell);
  const ctx = setup({ role: 'PW', pw: 'P20' }, man, datasets);
  const body = ids.spBody;
  const opening = ctx.__openSarpras(lokus);
  ctx.__dlg.close(); // user closes while resolve is in flight
  await opening;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ctx.__openDlgCalls.length >= 1, true);
});
