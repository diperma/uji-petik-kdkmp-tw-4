const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const logic = html.slice(html.indexOf('  function komposisi('), html.indexOf('  // ---------------- tampilan'));
const rendering = html.slice(html.indexOf('  function renderRing()'), html.indexOf('  $("#tblRing").addEventListener'));
function setup() {
  const elements = {};
  const context = vm.createContext({ assert, elements });
  vm.runInContext(`
    const $ = (id) => elements[id] ||= { innerHTML: '' };
    const esc = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmt = String, title = String, short = String;
    const tierColor = () => 'blue';
    const pwCode = () => 'P01', pwName = () => 'Aceh';
    const ms = (t) => t || 0, MAXN = 10, MAX_LAHAN = 3;
    let EFF, USUL = [];
    const loc = (kode, kab) => ({ kode, kab, pw: 'Aceh', kat: '(4)', urut: 1 });
    const DATA = { ringkasan: [{ no: 1, pw: 'Aceh', kab: 'Kabupaten Awal', kantor: 'Kantor', dasar: 'Dasar awal' }], lokasi: [loc('111', 'Kabupaten Awal')] };
    ${logic}
    ${rendering}
    const renderSummary = () => { compute(); renderRing(); return elements['#tblRing'].innerHTML; };
  `, context);
  return (code) => vm.runInContext(code, context);
}
test('approved replacement removes stale original regency from summary', () => {
  setup()(`
    USUL = [{ id: 'a', pw: 'P01', jenis: 'ganti', lama: loc('111', 'Kabupaten Awal'), baru: loc('222', 'Kabupaten Baru'), status: 'disetujui', ditinjau_pada: 1 }];
    const result = renderSummary();
    assert.match(result, /Kabupaten Baru/);
    assert.doesNotMatch(result, /Kabupaten Awal/);
    assert.equal(EFF.all[0].kab, 'Kabupaten Baru');
  `);
});
test('summary lists each effective regency once, including remaining original locations', () => {
  setup()(`
    DATA.lokasi.push(loc('112', 'Kabupaten Awal'), loc('113', 'Kabupaten Lain'));
    USUL = [{ id: 'a', pw: 'P01', jenis: 'ganti', lama: loc('111', 'Kabupaten Awal'), baru: loc('222', 'Kabupaten Lain'), status: 'disetujui', ditinjau_pada: 1 }];
    const result = renderSummary();
    assert.equal((result.match(/Kabupaten Awal/g) || []).length, 1);
    assert.equal((result.match(/Kabupaten Lain/g) || []).length, 1);
  `);
});
test('unapproved changes do not affect summary', () => {
  for (const status of ['diajukan', 'ditolak', 'dibatalkan']) setup()(`
    USUL = [{ id: 'a', pw: 'P01', jenis: 'ganti', lama: loc('111', 'Kabupaten Awal'), baru: loc('222', 'Kabupaten Baru'), status: '${status}' }];
    const result = renderSummary();
    assert.match(result, /Kabupaten Awal/);
    assert.doesNotMatch(result, /Kabupaten Baru/);
  `);
});
test('approved deletion leaves an empty regency cell, not the original regency', () => {
  setup()(`
    USUL = [{ id: 'a', pw: 'P01', jenis: 'hapus', lama: loc('111', 'Kabupaten Awal'), status: 'disetujui', ditinjau_pada: 1 }];
    const result = renderSummary();
    assert.doesNotMatch(result, /Kabupaten Awal/);
    assert.ok(result.includes('<span class="z">–</span>'));
    assert.equal(EFF.all.length, 0);
  `);
});
test('approved additions are escaped and subsequent replacements remove obsolete regencies', () => {
  setup()(`
    USUL = [
      { id: 'a', pw: 'P01', jenis: 'tambah', baru: loc('222', '<Kabupaten Baru>'), status: 'disetujui', ditinjau_pada: 1 },
      { id: 'b', pw: 'P01', jenis: 'ganti', lama: loc('111', 'Kabupaten Awal'), baru: loc('333', '<Kabupaten Baru>'), status: 'disetujui', ditinjau_pada: 2 }
    ];
    const result = renderSummary();
    assert.doesNotMatch(result, /Kabupaten Awal|<Kabupaten Baru>/);
    assert.equal((result.match(/&lt;Kabupaten Baru&gt;/g) || []).length, 1);
  `);
});
