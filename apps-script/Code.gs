/**
 * Certs Team Tracker — Google Sheet backend (Apps Script web app).
 *
 * The site at GitHub Pages sends POST requests here. Every request carries the
 * person's work email and the team password; the password lives only in this
 * project's Script Properties (TEAM_PASSWORD), never in the Sheet or on GitHub.
 *
 * Tabs: Users, Programmes, Tasks, Log. Edit Users directly in the Sheet to add
 * or remove people (email, name, role = member | lead).
 */

const TZ = 'Asia/Kolkata';
const TABS = {
  Users: ['email', 'name', 'role'],
  Programmes: ['id', 'name', 'owner', 'ssd', 'state', 'flag', 'order', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'],
  Tasks: ['id', 'programme', 'owner', 'parent', 'text', 'status', 'day', 'since', 'carriedFrom', 'order', 'doneOn', 'archived',
          'createdBy', 'createdAt', 'updatedBy', 'updatedAt'],
  Log: ['at', 'email', 'action', 'detail'],
};
const MAX_FAILS = 8;          // failed sign-ins per email before a pause
const FAIL_WINDOW_S = 900;    // 15 minutes

// ---------- entry points ----------
function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return out_({ ok: false, error: 'bad_request' }); }
  try { return out_(handle_(req)); }
  catch (err) { return out_({ ok: false, error: 'server_error', message: String(err && err.message || err) }); }
}

function doGet() {
  return out_({ ok: true, service: 'certs-team-tracker' });
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- request handling ----------
function handle_(req) {
  const auth = auth_(req.email, req.password);
  if (!auth.ok) return auth;
  const me = auth.user;

  switch (req.action) {
    case 'load':
      return state_(me);
    case 'addProgramme':
      return write_(me, () => addProgramme_(me, req));
    case 'updateProgramme':
      return write_(me, () => updateProgramme_(me, req));
    case 'addTask':
      return write_(me, () => addTask_(me, req));
    case 'updateTask':
      return write_(me, () => updateTask_(me, req));
    case 'deleteTask':
      return write_(me, () => deleteTask_(me, req));
    default:
      return { ok: false, error: 'bad_action' };
  }
}

function auth_(email, password) {
  email = String(email || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const failKey = 'fail:' + email;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_FAILS) return { ok: false, error: 'locked' };

  const expected = PropertiesService.getScriptProperties().getProperty('TEAM_PASSWORD');
  if (!expected) return { ok: false, error: 'not_set_up' };
  if (String(password || '') !== expected) {
    cache.put(failKey, String(fails + 1), FAIL_WINDOW_S);
    return { ok: false, error: 'bad_password' };
  }
  const user = read_('Users').find(u => String(u.email).trim().toLowerCase() === email);
  if (!user) return { ok: false, error: 'unknown_email' };
  cache.remove(failKey);
  return { ok: true, user: { email: email, name: String(user.name), role: String(user.role || 'member') } };
}

function state_(me) {
  const users = read_('Users').map(u => ({ name: String(u.name), role: String(u.role || 'member') }));
  return {
    ok: true,
    me: me,
    today: today_(),
    users: users,
    programmes: read_('Programmes').filter(p => p.state !== 'archived').map(cleanProgramme_),
    tasks: read_('Tasks').map(cleanTask_),
  };
}

function write_(me, fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    const res = fn();
    if (res && res.ok === false) return res;
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return state_(me);
}

// ---------- actions ----------
function addProgramme_(me, req) {
  const name = clean_(req.name, 120);
  if (!name) return { ok: false, error: 'name_required' };
  const owner = clean_(req.owner || me.name, 60);
  if (!memberNames_().includes(owner)) return { ok: false, error: 'bad_owner' };
  const ssd = date_(req.ssd);
  if (req.ssd && !ssd) return { ok: false, error: 'bad_date' };
  const progs = read_('Programmes');
  if (progs.some(p => p.state !== 'archived' && p.owner === owner && String(p.name).toLowerCase() === name.toLowerCase()))
    return { ok: false, error: 'duplicate_programme' };
  const order = progs.filter(p => p.owner === owner).reduce((m, p) => Math.max(m, Number(p.order) || 0), 0) + 1;
  const row = { id: 'p-' + uid_(), name: name, owner: owner, ssd: ssd, state: '', flag: '', order: order,
                createdBy: me.name, createdAt: now_(), updatedBy: me.name, updatedAt: now_() };
  append_('Programmes', row);
  log_(me, 'addProgramme', name + ' (' + owner + ', SSD ' + (ssd || '—') + ')');
  return { ok: true };
}

function updateProgramme_(me, req) {
  const f = req.fields || {};
  const patch = {};
  if ('name' in f) { patch.name = clean_(f.name, 120); if (!patch.name) return { ok: false, error: 'name_required' }; }
  if ('ssd' in f) { patch.ssd = f.ssd ? date_(f.ssd) : ''; if (f.ssd && !patch.ssd) return { ok: false, error: 'bad_date' }; }
  if ('flag' in f) patch.flag = clean_(f.flag, 60);
  if ('state' in f) { if (!['', 'live', 'archived'].includes(f.state)) return { ok: false, error: 'bad_state' }; patch.state = f.state; }
  if ('owner' in f) { patch.owner = clean_(f.owner, 60); if (!memberNames_().includes(patch.owner)) return { ok: false, error: 'bad_owner' }; }
  patch.updatedBy = me.name; patch.updatedAt = now_();
  const prog = update_('Programmes', req.id, patch);
  if (!prog) return { ok: false, error: 'not_found' };
  if ('owner' in f) {
    // tasks follow their programme's owner
    read_('Tasks').filter(t => t.programme === req.id).forEach(t => update_('Tasks', t.id, { owner: patch.owner }));
  }
  log_(me, 'updateProgramme', prog.name + ' ' + JSON.stringify(f));
  return { ok: true };
}

function addTask_(me, req) {
  const text = clean_(req.text, 300);
  if (!text) return { ok: false, error: 'text_required' };
  const prog = read_('Programmes').find(p => p.id === req.programme);
  if (!prog) return { ok: false, error: 'not_found' };
  const tasks = read_('Tasks');
  let parent = '';
  if (req.parent) {
    const p = tasks.find(t => t.id === req.parent);
    if (!p || p.programme !== prog.id) return { ok: false, error: 'bad_parent' };
    if (p.parent) return { ok: false, error: 'nested_too_deep' };
    parent = p.id;
  }
  const siblings = tasks.filter(t => t.programme === prog.id && String(t.parent || '') === parent);
  const order = siblings.reduce((m, t) => Math.max(m, Number(t.order) || 0), 0) + 1;
  const day = today_();
  const row = { id: 'k-' + uid_(), programme: prog.id, owner: prog.owner, parent: parent, text: text, status: 'open',
                day: day, since: day, carriedFrom: '', order: order, doneOn: '', archived: '',
                createdBy: me.name, createdAt: now_(), updatedBy: me.name, updatedAt: now_() };
  append_('Tasks', row);
  log_(me, parent ? 'addSubtask' : 'addTask', prog.name + ': ' + text);
  return { ok: true };
}

function updateTask_(me, req) {
  const f = req.fields || {};
  const patch = {};
  if ('text' in f) { patch.text = clean_(f.text, 300); if (!patch.text) return { ok: false, error: 'text_required' }; }
  if ('status' in f) {
    if (!['open', 'waiting', 'done'].includes(f.status)) return { ok: false, error: 'bad_status' };
    patch.status = f.status;
    patch.doneOn = f.status === 'done' ? today_() : '';
  }
  patch.updatedBy = me.name; patch.updatedAt = now_();
  const t = update_('Tasks', req.id, patch);
  if (!t) return { ok: false, error: 'not_found' };
  log_(me, 'updateTask', t.text + ' ' + JSON.stringify(f));
  return { ok: true };
}

function deleteTask_(me, req) {
  const tasks = read_('Tasks');
  const t = tasks.find(x => x.id === req.id);
  if (!t) return { ok: false, error: 'not_found' };
  const ids = [t.id].concat(tasks.filter(x => x.parent === t.id).map(x => x.id));
  remove_('Tasks', ids);
  log_(me, 'deleteTask', t.text + (ids.length > 1 ? ' (+' + (ids.length - 1) + ' subtasks)' : ''));
  return { ok: true };
}

// ---------- sheet helpers ----------
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Missing tab: ' + name + '. Run setup() first.');
  return sh;
}

function read_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0].map(String);
  return values.slice(1).filter(r => r.some(v => v !== '' && v !== null)).map(r => {
    const o = {};
    head.forEach((h, i) => { o[h] = norm_(r[i]); });
    return o;
  });
}

function norm_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  if (v === null || v === undefined) return '';
  return typeof v === 'number' ? v : String(v);
}

function append_(name, obj) {
  const sh = sheet_(name);
  const head = TABS[name];
  const row = sh.getLastRow() + 1;
  const range = sh.getRange(row, 1, 1, head.length);
  range.setNumberFormat('@');
  range.setValues([head.map(h => obj[h] === undefined ? '' : String(obj[h]))]);
}

function update_(name, id, patch) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const head = values[0].map(String);
  const idCol = head.indexOf('id');
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) !== String(id)) continue;
    Object.keys(patch).forEach(k => {
      const c = head.indexOf(k);
      if (c < 0) return;
      const cell = sh.getRange(r + 1, c + 1);
      cell.setNumberFormat('@');
      cell.setValue(String(patch[k]));
      values[r][c] = patch[k];
    });
    const o = {};
    head.forEach((h, i) => { o[h] = norm_(values[r][i]); });
    return o;
  }
  return null;
}

function remove_(name, ids) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const idCol = values[0].map(String).indexOf('id');
  for (let r = values.length - 1; r >= 1; r--) {
    if (ids.includes(String(values[r][idCol]))) sh.deleteRow(r + 1);
  }
}

function log_(me, action, detail) {
  append_('Log', { at: now_(), email: me.email, action: action, detail: String(detail).slice(0, 500) });
}

function memberNames_() { return read_('Users').filter(u => u.role === 'member').map(u => String(u.name)); }

function cleanProgramme_(p) {
  return { id: p.id, name: p.name, owner: p.owner, ssd: p.ssd || '', state: p.state || '', flag: p.flag || '',
           order: Number(p.order) || 0, createdBy: p.createdBy || '', createdAt: p.createdAt || '' };
}
function cleanTask_(t) {
  return { id: t.id, programme: t.programme, owner: t.owner, parent: t.parent || '', text: t.text,
           status: t.status || 'open', day: t.day, since: t.since || t.day, carriedFrom: t.carriedFrom || '',
           order: Number(t.order) || 0, doneOn: t.doneOn || '', archived: !!t.archived && t.archived !== '0',
           createdBy: t.createdBy || '', updatedBy: t.updatedBy || '', updatedAt: t.updatedAt || '' };
}

function clean_(s, max) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function date_(s) { s = String(s || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function now_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 10); }

// ---------- one-time setup ----------
/**
 * Run once from the editor. Creates the tabs and loads the starting data from
 * Seed.gs (SEED), then stores the team password in Script Properties.
 * After it succeeds you can delete Seed.gs.
 */
function setup() {
  if (typeof SEED === 'undefined') throw new Error('Seed.gs is missing. Add it, then run setup() again.');
  const ss = ss_();
  Object.keys(TABS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() > 1 && name !== 'Log') throw new Error('Tab ' + name + ' already has data. setup() only runs on an empty Sheet.');
    sh.clear();
    const head = TABS[name];
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 500), head.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const fill = (name, rows) => {
    if (!rows.length) return;
    const head = TABS[name];
    const sh = ss.getSheetByName(name);
    sh.getRange(2, 1, rows.length, head.length).setNumberFormat('@')
      .setValues(rows.map(o => head.map(h => o[h] === undefined || o[h] === null ? '' : String(o[h]))));
  };
  fill('Users', SEED.users);
  fill('Programmes', SEED.programmes);
  fill('Tasks', SEED.tasks);
  const first = ss.getSheets()[0];
  if (first && !TABS[first.getName()] && first.getLastRow() === 0) ss.deleteSheet(first);
  PropertiesService.getScriptProperties().setProperty('TEAM_PASSWORD', SEED.password);
  Logger.log('Set up ' + SEED.users.length + ' users, ' + SEED.programmes.length + ' programmes, ' + SEED.tasks.length + ' tasks.');
}

/** Run from the editor to change the team password. Edit the value first, run, then clear it. */
function setPassword() {
  const NEW_PASSWORD = '';
  if (!NEW_PASSWORD) throw new Error('Type the new password into NEW_PASSWORD first.');
  PropertiesService.getScriptProperties().setProperty('TEAM_PASSWORD', NEW_PASSWORD);
  Logger.log('Team password updated.');
}
