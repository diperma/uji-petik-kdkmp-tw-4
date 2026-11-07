const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const names = html.slice(html.indexOf('  const NAMES ='), html.indexOf('\n\n  let DATA'));
const logic = html.slice(html.indexOf('  function komposisi('), html.indexOf('  // ---------------- tampilan'));
function setup() {
  const context = vm.createContext({ assert });
  vm.runInContext(`
    ${names}
    const ms = (t) => t || 0;
    let EFF, USUL = [];
    const DATA = { ringkasan: [], lokasi: [] };
    const loc = (i, kat = '(3)') => ({ kode: String(i), kat, urut: i });
    const list = (n, kat = '(3)') => Array.from({ length: n }, (_, i) => loc(i, kat));
    ${logic}
  `, context);
  return (code) => vm.runInContext(code, context);
}
test('only Maluku and all Papua representatives are landless-exempt; total count is unlimited', () => {
  setup()(`
    const exempt = ['Maluku', 'Maluku Utara', 'Papua', 'Papua Barat', 'Papua Barat Daya', 'Papua Tengah'];
    for (const name of NAMES) {
      const code = pwCode(name);
      assert.equal(tanpaBatasLahan(code), exempt.includes(name), name);
      assert.equal(batasErr(list(3), code), '', name);
      for (const n of [11, 25, 100]) {
        assert.equal(batasErr(list(n, '(1)'), code), '', name + ' ' + n + ' terbangun');
        assert.equal(batasErr(list(n, '(2)'), code), '', name + ' ' + n + ' mandek');
      }
    }
  `);
});
test('landless cap of three is retained except for exempt representatives', () => {
  setup()(`
    const exempt = ['Maluku', 'Maluku Utara', 'Papua', 'Papua Barat', 'Papua Barat Daya', 'Papua Tengah'];
    for (const name of NAMES) {
      const code = pwCode(name);
      if (exempt.includes(name)) {
        assert.equal(batasErr(list(4), code), '', name);
        assert.equal(batasErr(list(100), code), '', name);
      } else {
        assert.match(batasErr(list(4), code), /belum memiliki lahan/, name);
        assert.match(batasErr(list(100), code), /belum memiliki lahan/, name);
      }
    }
  `);
});
test('addition and replacement beyond ten are accepted and still reject duplicates', () => {
  setup()(`
    for (const name of ['Aceh', 'Maluku']) {
      const pw = pwCode(name);
      for (const n of [10, 11, 25, 100]) {
        const base = list(n, '(1)');
        const addition = applyOne(base, { id: 'a' + n, pw, jenis: 'tambah', baru: loc(n, '(1)') });
        assert.equal(!!addition.err, false, name + ' tambah ' + n);
        assert.equal(addition.list.length, n + 1, name + ' tambah length ' + n);
        assert.match(applyOne(base, { pw, jenis: 'tambah', baru: loc(0, '(1)') }).err, /sudah ada/, name + ' duplikat ' + n);
      }
      const replacement = applyOne(list(25, '(1)'), { id: 'g', pw, jenis: 'ganti', lama: loc(0, '(1)'), baru: loc(250, '(1)') });
      assert.equal(!!replacement.err, false, name + ' ganti');
      assert.equal(replacement.list.length, 25, name + ' ganti length');
      assert.equal(replacement.list[0].kode, '250', name + ' ganti result');
      assert.match(applyOne(list(25, '(1)'), { pw, jenis: 'ganti', lama: loc(0, '(1)'), baru: loc(5, '(1)') }).err, /sudah ada/, name + ' ganti duplikat');
    }
  `);
});
test('landless addition and replacement still enforce the historical category cap', () => {
  setup()(`
    for (const name of ['Aceh', 'Maluku']) {
      const pw = pwCode(name);
      const addition = applyOne(list(3), { id: 'a', pw, jenis: 'tambah', baru: loc(4) });
      const replacement = applyOne([...list(3), loc(3, '(1)')], { id: 'b', pw, jenis: 'ganti', lama: loc(3, '(1)'), baru: loc(4) });
      assert.equal(!!addition.err, name === 'Aceh', name + ' tambah lahan');
      assert.equal(!!replacement.err, name === 'Aceh', name + ' ganti lahan');
      if (name === 'Aceh') {
        assert.match(addition.err, /belum memiliki lahan/);
        assert.match(replacement.err, /belum memiliki lahan/);
      } else {
        assert.equal(replacement.list.length, 4);
      }
    }
  `);
});
test('pending projection and approved effective lists exceed ten', () => {
  for (const name of ['Aceh', 'Maluku']) setup()(`
    const pw = pwCode('${name}');
    DATA.ringkasan = [{ pw: pwName(pw) }];
    DATA.lokasi = list(10, '(1)').map(x => ({ ...x, pw: pwName(pw) }));
    USUL = Array.from({ length: 5 }, (_, i) => ({ id: 'p' + i, pw, jenis: 'tambah', baru: loc(10 + i, '(1)'), status: 'diajukan', dibuat_pada: i + 1 }));
    compute();
    assert.equal(EFF.all.length, 10);
    assert.equal(proyeksi(pw).length, 15);
    for (const s of USUL) { s.status = 'disetujui'; s.ditinjau_pada = s.dibuat_pada; }
    compute();
    assert.equal(EFF.lists.get(pw).length, 15);
    assert.equal(EFF.all.length, 15);
    assert.equal(EFF.gagal.size, 0);
  `);
});
test('approval and reapproval keep working on effective lists above ten', () => {
  setup()(`
    const pw = pwCode('Aceh');
    DATA.ringkasan = [{ pw: pwName(pw) }];
    DATA.lokasi = list(11, '(1)').map(x => ({ ...x, pw: pwName(pw) }));
    USUL = [
      { id: 'add', pw, jenis: 'tambah', baru: loc(11, '(1)'), status: 'disetujui', ditinjau_pada: 1 },
      { id: 'again', pw, jenis: 'ganti', lama: loc(0, '(1)'), baru: loc(100, '(1)'), status: 'disetujui', ditinjau_pada: 2 },
    ];
    compute();
    assert.equal(EFF.all.length, 12);
    assert.equal(EFF.gagal.size, 0);
    assert.equal(EFF.lists.get(pw).some(x => x.kode === '100'), true);
    assert.equal(EFF.lists.get(pw).some(x => x.kode === '0'), false);
    assert.equal(lokasiDisetujui(USUL[0]).kode, '11');
    assert.equal(lokasiDisetujui(USUL[1]).kode, '100');
    USUL.push({ id: 'pending', pw, jenis: 'ganti', lama: loc(100, '(1)'), baru: loc(101, '(1)'), status: 'diajukan' });
    compute();
    assert.equal(EFF.all.length, 12);
    assert.equal(proyeksi(pw).some(x => x.kode === '101'), true);
    USUL[2].status = 'disetujui';
    USUL[2].ditinjau_pada = 3;
    compute();
    assert.equal(EFF.all.length, 12);
    assert.equal(EFF.gagal.size, 0);
    assert.equal(EFF.lists.get(pw).some(x => x.kode === '101'), true);
    assert.equal(lokasiDisetujui(USUL[2]).kode, '101');
  `);
});
test('static regression: no MAXN total cap and the tambah control is not disabled by count', () => {
  assert.doesNotMatch(html, /\bMAXN\b/);
  const batas = html.slice(html.indexOf('  function batasErr('), html.indexOf('  function applyOne('));
  assert.doesNotMatch(batas, /c\.n\s*>/);
  assert.match(batas, /k3 > MAX_LAHAN/);
  const komp = html.slice(html.indexOf('$("#komp").innerHTML'), html.indexOf('$("#komp").classList.remove'));
  assert.match(komp, /id="btnTambah" type="button">/);
  assert.doesNotMatch(komp, /disabled/);
  assert.match(komp, /tanpa batas jumlah/);
});
