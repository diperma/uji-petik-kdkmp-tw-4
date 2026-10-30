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
    const list = (n) => Array.from({ length: n }, (_, i) => loc(i));
    ${logic}
  `, context);
  return (code) => vm.runInContext(code, context);
}
test('only Maluku and all Papua representatives are exempt, total limit remains ten', () => {
  setup()(`
    const exempt = ['Maluku', 'Maluku Utara', 'Papua', 'Papua Barat', 'Papua Barat Daya', 'Papua Tengah'];
    for (const name of NAMES) {
      const code = pwCode(name);
      assert.equal(tanpaBatasLahan(code), exempt.includes(name), name);
      assert.equal(batasErr(list(3), code), '', name);
      if (exempt.includes(name)) assert.equal(batasErr(list(10), code), '', name);
      else assert.match(batasErr(list(4), code), /belum memiliki lahan/, name);
      assert.match(batasErr(list(11), code), /melebihi batas 10/, name);
    }
  `);
});
test('addition and replacement use the representative exemption and still reject duplicates', () => {
  setup()(`
    for (const name of ['Maluku', 'Maluku Utara', 'Papua', 'Papua Barat', 'Papua Barat Daya', 'Papua Tengah', 'Aceh']) {
      const pw = pwCode(name);
      const addition = applyOne(list(3), { id: 'a', pw, jenis: 'tambah', baru: loc(4) });
      const replacement = applyOne([...list(3), loc(4, '(4)')], { id: 'b', pw, jenis: 'ganti', lama: loc(4), baru: loc(5) });
      assert.equal(!!addition.err, name === 'Aceh', name);
      assert.equal(!!replacement.err, name === 'Aceh', name);
      assert.match(applyOne(list(3), { pw, jenis: 'tambah', baru: loc(0) }).err, /sudah ada/);
      assert.match(applyOne(list(10), { pw, jenis: 'tambah', baru: loc(11) }).err, /melebihi batas 10/);
    }
  `);
});
test('pending projection and approved effective list allow more than three landless locations', () => {
  setup()(`
    const pw = pwCode('Maluku');
    DATA.ringkasan = [{ pw: pwName(pw) }];
    DATA.lokasi = list(3).map(x => ({ ...x, pw: pwName(pw) }));
    USUL = [{ id: 'a', pw, jenis: 'tambah', baru: loc(4), status: 'diajukan' }];
    compute();
    assert.equal(EFF.all.length, 3);
    assert.equal(proyeksi(pw).length, 4);
    USUL[0].status = 'disetujui';
    USUL[0].ditinjau_pada = 1;
    compute();
    assert.equal(EFF.all.length, 4);
    assert.equal(EFF.gagal.size, 0);
  `);
});
