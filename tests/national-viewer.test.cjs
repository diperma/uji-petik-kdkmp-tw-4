const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const helpers = slice('// PW codes are exactly P01', 'const sarprasObj =');
function fixture() {
  const writes = [], elements = {};
  const ctx = vm.createContext({ writes, elements, Error });
  vm.runInContext(helpers + `
    let ME = null, USUL = [], EFF = { lists: new Map() };
    const toast = () => {}, bersih = x => x, S = String;
    const collection = (...x) => x, doc = (...x) => x, db = {};
    const addDoc = (...x) => writes.push(['add', ...x]);
    const updateDoc = (...x) => writes.push(['update', ...x]);
    const serverTimestamp = () => 1;
    const $ = id => elements[id] ||= {value:'reason',addEventListener:(type,fn)=>{elements[id].click=fn;}};
    const openDlg = () => {}, closeDlg = () => {}, short = String, pwName = String;
    const lokBox = () => '', JENIS = { tambah: 'Tambah' }, tgl = String, esc = String;
    const applyOne = () => ({}), kompTeks = () => '';
    const kirim = async (btn, fn) => fn();
  ` + slice('  const canPropose =', '\n\n  let toastT') + '\n' +
    slice('  const usulBaru =', '  // ---- hapus') + '\n' +
    slice('  function openHapus(code, lama) {', '    const after =') + '}\n' +
    slice('  async function openPicker(code, lama) {', '    const session = SESSION;') + '}\n' +
    slice('  function openTinjau(s) {', '  function openBatal(s) {') + '\n' +
    slice('  function openBatal(s) {', '  dlg.addEventListener("close"'), ctx);
  return { writes, run: code => vm.runInContext(code, ctx) };
}
test('national reads equal D302; unsupported roles and malformed PW scopes fail closed', () => {
  const f = fixture();
  for (const role of ['D302', 'NATIONAL_VIEWER']) assert.equal(f.run(`JSON.stringify(sarprasScope({role:'${role}',pw:'P01'}))`), '["populasi_tw4",""]');
  for (const role of ['OTHER', '', null]) {
    assert.equal(f.run(`sarprasScope({role:${JSON.stringify(role)},pw:'P01'})`), null);
    assert.equal(f.run(`isSupportedRole({role:${JSON.stringify(role)},pw:'P01'})`), false);
  }
  for (const pw of ['ALL', 'P00', 'P37', '', null]) assert.equal(f.run(`sarprasScope({role:'PW',pw:${JSON.stringify(pw)}})`), null);
  assert.equal(f.run(`JSON.stringify(sarprasScope({role:'PW',pw:'P36'}))`), '["populasi_pw","P36_"]');
});
test('national, unknown and invalid PW cannot propose or enter mutation dialogs', async () => {
  for (const role of ['NATIONAL_VIEWER', 'OTHER', 'PW']) {
    const f = fixture();
    f.run(`ME={role:'${role}',pw:${role === 'PW' ? "'ALL'" : "'P01'"}}; USUL=[{id:'x',pw:'P01',jenis:'tambah',status:'diajukan'}];`);
    assert.equal(f.run(`canPropose('P01')`), false);
    await assert.rejects(f.run(`usulBaru('P01','tambah',null,null,'reason')`));
    f.run(`openHapus('P01',{}); openTinjau(USUL[0]); openBatal(USUL[0]);`);
    await f.run(`openPicker('P01',null)`);
    assert.equal(f.writes.length, 0);
  }
});
test('D302 and own PW can propose; mismatched PW cannot', async () => {
  const f = fixture();
  for (const role of ['D302', 'PW']) { f.run(`ME={role:'${role}',pw:'P01',email:'x'};`); await f.run(`usulBaru('P01','tambah',null,null,'reason')`); }
  assert.equal(f.writes.length, 2);
  f.run(`ME={role:'PW',pw:'P02'};`);
  await assert.rejects(f.run(`usulBaru('P01','tambah',null,null,'reason')`));
});
test('cancel rechecks current role, ownership and status before updateDoc', async () => {
  const f = fixture();
  f.run(`ME={role:'PW',pw:'P01'}; USUL=[{id:'x',pw:'P01',jenis:'tambah',status:'diajukan'}]; openBatal(USUL[0]); ME.role='NATIONAL_VIEWER';`);
  await assert.rejects(f.run(`elements['#bYa'].click()`));
  assert.equal(f.writes.length, 0);
  f.run(`ME.role='PW';`); await f.run(`elements['#bYa'].click()`);
  assert.equal(f.writes.length, 1);
  f.run(`USUL[0].status='disetujui';`); await assert.rejects(f.run(`elements['#bYa'].click()`));
  assert.equal(f.writes.length, 1);
});
test('review rechecks strict D302 role and pending status at invocation', async () => {
  const f = fixture();
  f.run(`ME={role:'D302'}; USUL=[{id:'x',pw:'P01',jenis:'tambah',status:'diajukan'}]; openTinjau(USUL[0]); ME.role='NATIONAL_VIEWER';`);
  await assert.rejects(f.run(`elements['#tSetuju'].click()`)); assert.equal(f.writes.length, 0);
  f.run(`ME.role='D302';`); await f.run(`elements['#tSetuju'].click()`); assert.equal(f.writes.length, 1);
  f.run(`USUL[0].status='disetujui';`); await assert.rejects(f.run(`elements['#tSetuju'].click()`)); assert.equal(f.writes.length, 1);
});
test('auth uses national read helper; national account label and readonly note are present', () => {
  assert.match(html, /canReadNational\(ME\) \? "data"/);
  assert.match(html, /const q = canReadNational\(ME\)/);
  assert.match(html, /Nasional · baca-saja/);
  assert.match(html, /Akses nasional baca-saja/);
  assert.ok(html.indexOf('if (!isSupportedRole(candidate))') < html.indexOf('const snap = await getDoc(doc(db, "lokus_tw4"'));
});
