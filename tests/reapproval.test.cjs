const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const logic = html.slice(html.indexOf('  function komposisi('), html.indexOf('  // ---------------- tampilan'));
const rendering = html.slice(html.indexOf('  const lokCell ='), html.indexOf('  ["#uSt", "#uPw"]'));
function setup() {
  const elements = {};
  const context = vm.createContext({ assert, elements });
  vm.runInContext(`
    const $ = (id) => elements[id] ||= { value: '', textContent: '', innerHTML: '' };
    const esc = (x) => String(x ?? '');
    const fmt = String, badge = String, title = String, tgl = String;
    const short = (s) => s, pwCode = () => 'P01', pwName = () => 'Aceh';
    const ms = (t) => t || 0, MAXN = 10, MAX_LAHAN = 3;
    const STATUS = { disetujui: 'Disetujui', diajukan: 'Menunggu' };
    const JENIS = { ganti: 'Ganti', tambah: 'Tambah', hapus: 'Hapus' };
    let ME = { role: 'PW', pw: 'P01' }, EFF;
    const canPropose = (c) => ME.role === 'D302' || ME.pw === c;
    const loc = (kode) => ({ kode, kat: '(4)', nama: kode });
    const DATA = { ringkasan: [{pw: 'Aceh'}], lokasi: [loc('111111')] };
    let USUL = [{id: 'first', pw: 'P01', jenis: 'ganti', lama: loc('111111'), baru: loc('222222'), status: 'disetujui', ditinjau_pada: 1}];
    ${logic}
    ${rendering}
    compute();
  `, context);
  return (code) => vm.runInContext(code, context);
}
test('approved location offers a new proposal without changing approval history', () => {
  setup()(`
    renderUsul();
    assert.match(elements['#tblUsul'].innerHTML, /Usulkan perubahan lagi/);
    assert.equal(lokasiDisetujui(USUL[0]).kode, '222222');
    assert.equal(USUL[0].status, 'disetujui');
  `);
});
test('pending re-proposal keeps approved location effective and prevents duplicates', () => {
  setup()(`
    USUL.push({id:'second', pw:'P01', jenis:'ganti', lama:loc('222222'), baru:loc('333333'), status:'diajukan'});
    compute(); renderUsul();
    assert.equal(EFF.all[0].kode, '222222');
    assert.equal(proyeksi('P01')[0].kode, '333333');
    assert.equal(kodeTerkunci('P01').has('222222'), true);
    assert.match(elements['#tblUsul'].innerHTML, /data-uact="ubah-lagi"[^>]*disabled/);
  `);
});
test('second approval replaces location, preserves history, and allows another proposal', () => {
  setup()(`
    USUL.push({id:'second', pw:'P01', jenis:'ganti', lama:loc('222222'), baru:loc('333333'), status:'disetujui', ditinjau_pada:2});
    compute();
    assert.equal(EFF.all[0].kode, '333333');
    assert.equal(lokasiDisetujui(USUL[0]), undefined);
    assert.equal(lokasiDisetujui(USUL[1]).kode, '333333');
    assert.equal(USUL.filter(s => s.status === 'disetujui').length, 2);
  `);
});
test('rejected or cancelled re-proposal leaves approved choice editable', () => {
  for (const status of ['ditolak', 'dibatalkan']) setup()(`
    USUL.push({id:'second', pw:'P01', jenis:'ganti', lama:loc('222222'), baru:loc('333333'), status:'${status}'});
    compute(); renderUsul();
    assert.equal(EFF.all[0].kode, '222222');
    assert.equal(kodeTerkunci('P01').size, 0);
    assert.match(elements['#tblUsul'].innerHTML, /Usulkan perubahan lagi/);
  `);
});
test('another representative cannot re-propose and removed locations cannot be edited', () => {
  setup()(`
    ME.pw = 'P02'; renderUsul();
    assert.doesNotMatch(elements['#tblUsul'].innerHTML, /Usulkan perubahan lagi/);
    ME.pw = 'P01';
    USUL.push({id:'delete', pw:'P01', jenis:'hapus', lama:loc('222222'), baru:null, status:'disetujui', ditinjau_pada:2});
    compute(); renderUsul();
    assert.equal(EFF.all.length, 0);
    assert.doesNotMatch(elements['#tblUsul'].innerHTML, /Usulkan perubahan lagi/);
    assert.match(elements['#tblUsul'].innerHTML, /Tambah lokasi/);
  `);
});
