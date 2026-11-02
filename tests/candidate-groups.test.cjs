const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const dataset = rows => { const cols = [...new Set(rows.flatMap(Object.keys))]; return { cols, rows: rows.map(r => cols.map(c => r[c] ?? null)) }; };
const row = (kode, extra = {}) => ({ 'Kode Desa': kode, Provinsi: 'ACEH', 'Kabupaten/Kota': 'ACEH', ...extra });

test('picker completion with unknown sarpras retains rules-compatible historical payload and excludes stale candidates', async () => {
  const datasets = {
    gerai: dataset([
      row('complete', { 'Progres terbaru (%)': 100, sarpras_unknown: true, '(2) Mandek > 3 bulan': 1 }),
      row('status', { 'Status pembangunan': 'Selesai', sarpras_unknown: true }),
      row('old', { stale: true, 'Progres terbaru (%)': 100 }),
      row('ongoing', { 'Progres terbaru (%)': 30 }),
      row('unknown', { '(1) Terbangun dengan kelengkapan': 1 }),
      row('mandek', { 'Progres terbaru (%)': 30, '(2) Mandek > 3 bulan': 1 }),
      row('operating', { 'Progres terbaru (%)': 100 }),
    ]),
    beroperasi: dataset([
      row('operating', { 'Kategori uji petik TW IV': 'Prioritas' }),
      row('stale-operation', { stale: true, 'Kategori uji petik TW IV': 'Prioritas' }),
    ]),
    belum_lahan: dataset([row('land'), row('stale-land', { stale: true })]),
  };
  const ctx = vm.createContext({
    SESSION: 1, PICK: null, KAND: {}, N: v => typeof v === 'number' ? v : null,
    $: () => null, esc: String, fmt: String,
    READER: { pin: async () => ({ version: 'test', legacy: false, man: {} }), dataset: async (_collection, _scope, name) => datasets[name] },
  });
  vm.runInContext(html.slice(html.indexOf('function snapshotUpdatedText('), html.indexOf('// CURRENT_CONDITION_BEGIN')), ctx);
  vm.runInContext(html.slice(html.indexOf('  const KATS ='), html.indexOf('  const tierColor')), ctx);
  vm.runInContext(html.slice(html.indexOf('  async function loadKand('), html.indexOf('  let PICK =')), ctx);
  const list = await ctx.loadKand('P01');
  assert.deepEqual(Array.from(list, x => x.kode).sort(), ['complete', 'land', 'mandek', 'operating', 'status']);
  for (const code of ['complete', 'status']) {
    const candidate = list.find(x => x.kode === code);
    assert.equal(candidate.kat, '(1) Terbangun dengan kelengkapan');
    assert.match(candidate.alasan, /kelengkapan sarpras belum diverifikasi/);
    assert.doesNotMatch(candidate.alasan, /sarpras lengkap/);
    ctx.candidate = candidate;
    assert.equal(vm.runInContext('katInfo(candidate.kat)[2]', ctx), 'Gedung terbangun');
    assert.match(vm.runInContext('badge(candidate.kat)', ctx), /badge bg1/);
  }
  assert.equal(list.find(x => x.kode === 'operating').kat, '(4) Beroperasi — prioritas uji petik');
  assert.ok(list.every(x => /^\([1234]\)/.test(x.kat)));
  assert.ok(list.every(x => !/Perlu verifikasi|Gedung terbangun/.test(x.kat)));
  assert.match(html, /<option value="\(1\)">\(1\) Gedung terbangun<\/option>/);
  assert.match(html, /!kat \|\| x\.kat\.startsWith\(kat\)/);
});
