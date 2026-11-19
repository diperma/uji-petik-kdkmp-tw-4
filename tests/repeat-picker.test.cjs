const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');

test('Palembang historical sample is selectable even with legacy blok metadata; TW IV duplicates remain blocked', async () => {
  const handlers = {};
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', options: [],
      addEventListener: (event, cb) => { handlers[id + ':' + event] = cb; },
      querySelectorAll: () => [] });
    return elements.get(id);
  };
  const candidate = { kode: '16.71.10.1001', kab: 'KOTA PALEMBANG', kec: 'KALIDONI', desa: 'BUKIT SANGKAL',
    nama: 'KDKMP Bukit Sangkal', kat: '(4) Beroperasi — potensial uji petik',
    alasan: 'Beroperasi; sudah diuji petik BPKP (TW II/III)', blok: 'Sudah diuji petik BPKP (TW II/III)' };
  const lists = new Map();
  const locked = new Set();
  let validated = 0;
  const ctx = vm.createContext({
    EFF: { lists }, kodeTerkunci: () => locked, SESSION: 1,
    $: el, canPropose: () => true, short: x => x, pwName: x => x,
    openDlg: () => {}, closeDlg: () => {}, dlg: { open: true },
    loadKand: async () => [candidate], esc: String, title: String, fmt: String,
    badge: x => x, lokBox: () => '<div class="box sel"></div>',
    validasiPick: () => { validated++; },
  });
  vm.runInContext(html.slice(html.indexOf('  function candidateBlockReason('), html.indexOf('  function validasiPick()')), ctx);
  await ctx.openPicker('P07', null);
  assert.doesNotMatch(el('#kTbl').innerHTML, /class="click dis/);
  let selected = false;
  const tr = { dataset: { k: candidate.kode }, classList: { add: () => { selected = true; } } };
  handlers['#kTbl:click']({ target: { closest: () => tr } });
  assert.equal(selected, true);
  assert.equal(vm.runInContext('PICK.sel.kode', ctx), candidate.kode);
  assert.ok(validated > 0);
  lists.set('P07', [candidate]);
  ctx.renderKand();
  assert.match(el('#kTbl').innerHTML, /Sudah ada di daftar lokasi/);
  selected = false;
  handlers['#kTbl:click']({ target: { closest: () => tr } });
  assert.equal(selected, false);
  lists.clear(); locked.add(candidate.kode);
  ctx.renderKand();
  assert.match(el('#kTbl').innerHTML, /Sedang dalam usulan lain/);
  assert.equal(ctx.candidateBlockReason('P07', candidate.kode), 'Sedang dalam usulan lain');
});
