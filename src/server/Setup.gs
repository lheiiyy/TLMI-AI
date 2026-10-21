// Functions the owner runs by hand in the Apps Script editor (docs/SETUP.md). They are plain top-level functions
// so that the editor lists them. A top-level function can also be called from the browser with google.script.run, so
// each one calls EditorGuard.check() as its first statement (a unit test enforces this for every top-level function
// of the server). They log names only: never a value, a PIN, a pepper or an ID.

// Creates every missing tab of TLMI_DB. Safe to run again: it never touches a tab that exists.
function setup() {
  EditorGuard.check();
  const created = Repository.ensureTables();
  Log.info(created.length ? 'setup: created tabs: ' + created.join(', ') : 'setup: nothing to create');
  return created;
}

// Makes the password pepper once. Returns true when it was made now.
function initSecrets() {
  EditorGuard.check();
  if (Props.get('PEPPER')) {
    Log.info('initSecrets: PEPPER already exists, left as it is');
    return false;
  }
  Props.set('PEPPER', Hasher.newSalt());
  Log.info('initSecrets: PEPPER created');
  return true;
}

// Helpers of the two functions below. An object, not top-level functions: only function declarations can be called from the browser.
const SetupHelpers = {
  // The Admin PIN of Phase 1 (exception X-1) is gone; this removes its leftover properties.
  removePinProperties() { ['ADMIN_PIN_HASH', 'ADMIN_PIN_SALT', 'ADMIN_PIN_FAILS', 'ADMIN_PIN_NEW'].forEach((k) => Props.remove(k)); },
  editorCtx(now) { return { userId: '', hrEmployeeNo: '', requestId: 'editor', now: now }; },
};

// Makes the first Admin on an empty database, so that someone can sign in and run the seed. The owner types their own
// name, employee number and a temporary password into the temporary Script Properties FIRST_ADMIN_NAME,
// FIRST_ADMIN_EMPLOYEE_NO and FIRST_ADMIN_PASSWORD. The Admin must change the password at the first sign-in. It refuses
// when an active Admin already exists, when the name or the number is taken, or when the password fails the rule
// (FX-002); then nothing is changed and the properties stay so that they can be corrected. On success it removes the
// three properties and the leftover Admin PIN properties.
function initFirstAdmin() {
  EditorGuard.check();
  const name = String(Props.get('FIRST_ADMIN_NAME') || '').trim();
  const no = String(Props.get('FIRST_ADMIN_EMPLOYEE_NO') || '').trim();
  const password = String(Props.get('FIRST_ADMIN_PASSWORD') || '');
  if (!name) throw new Error('Set the Script Property FIRST_ADMIN_NAME first (your own name).');
  if (!/^\d{1,20}$/.test(no)) throw new Error('Set the Script Property FIRST_ADMIN_EMPLOYEE_NO first (your HR employee number, digits only).');
  const bad = PasswordRules.check(password);
  if (!bad.ok) throw new Error('FIRST_ADMIN_PASSWORD does not follow the password rule (' + bad.code + '). Nothing was changed.');
  const users = Repository.all('users');
  if (users.some((u) => u.role === 'Admin' && u.is_active)) {
    throw new Error('An active Admin already exists. Nothing was changed.');
  }
  // Compared as the seed compares names (trimmed, spaces collapsed, case-insensitive), so the seed will skip this user as EXISTS.
  const key = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
  if (users.some((u) => key(u.display_name) === key(name))) {
    throw new Error('A user already has that name. Type your name exactly as it is written in the SEED_OFFICERS tab, and make sure it is not already a user. Nothing was changed.');
  }
  if (users.some((u) => u.hr_employee_no === no)) throw new Error('A user already has that employee number. Nothing was changed.');
  const cred = AuthService.newCredentials(password);
  const now = Clock.iso();
  Repository.transact((uow) => {
    const row = uow.insert('users', {
      display_name: name, role: 'Admin', hr_employee_no: no, password_hash: cred.password_hash, salt: cred.salt, must_change_password: true,
    }, { userId: '', now: now });
    AuditService.event(uow, SetupHelpers.editorCtx(now), { event: 'USER.CREATED', entity: 'users', entityId: row.id, detail: { role: 'Admin', source: 'initFirstAdmin' } });
  });
  ['FIRST_ADMIN_NAME', 'FIRST_ADMIN_EMPLOYEE_NO', 'FIRST_ADMIN_PASSWORD'].forEach((k) => Props.remove(k));
  SetupHelpers.removePinProperties();
  Log.info('initFirstAdmin: the first Admin was created; the FIRST_ADMIN properties and the Admin PIN properties were removed');
}

// For a database that already has its Admin from Phase 1, and the way back for an Admin who is locked out or has
// forgotten the password. The owner types the Admin's employee number and a temporary password into the temporary Script
// Properties ADMIN_EMPLOYEE_NO and ADMIN_TEMP_PASSWORD. It picks the active Admin who has that number; or, when no user
// has the number and exactly one active Admin exists, that Admin (the number is set on it). It refuses when the number
// belongs to a user who is not an active Admin, or when the number is free and there is not exactly one active Admin. It
// sets the temporary password (the Admin must change it), clears the pause, ends the Admin's sessions, writes a
// USER.PASSWORD_RESET audit row, and removes both properties and the leftover Admin PIN properties.
function initAdminPassword() {
  EditorGuard.check();
  const no = String(Props.get('ADMIN_EMPLOYEE_NO') || '').trim();
  const password = String(Props.get('ADMIN_TEMP_PASSWORD') || '');
  if (!/^\d{1,20}$/.test(no)) throw new Error('Set the Script Property ADMIN_EMPLOYEE_NO first (the Admin\'s HR employee number, digits only).');
  const bad = PasswordRules.check(password);
  if (!bad.ok) throw new Error('ADMIN_TEMP_PASSWORD does not follow the password rule (' + bad.code + '). Nothing was changed.');
  const users = Repository.all('users');
  const admins = users.filter((u) => u.role === 'Admin' && u.is_active);
  const holder = users.filter((u) => u.hr_employee_no === no)[0];
  let target;
  if (holder) {
    if (!(holder.role === 'Admin' && holder.is_active)) throw new Error('That employee number belongs to a user who is not an active Admin. Nothing was changed.');
    target = holder;
  } else {
    if (admins.length !== 1) throw new Error('That employee number is free and there is not exactly one active Admin, so it is not clear whose it is. Give the number of an existing Admin. Nothing was changed.');
    target = admins[0];
  }
  const cred = AuthService.newCredentials(password);
  const now = Clock.iso();
  Repository.transact((uow) => {
    const cur = uow.get('users', target.id);
    uow.update('users', target.id, {
      hr_employee_no: no, password_hash: cred.password_hash, salt: cred.salt, must_change_password: true,
      failed_attempts: 0, cooldown_until: null,
    }, { expectedVersion: cur.row_version, actor: { userId: '', now: now } });
    AuditService.event(uow, SetupHelpers.editorCtx(now), { event: 'USER.PASSWORD_RESET', entity: 'users', entityId: target.id, detail: { source: 'editor' } });
  });
  AuthService.bumpEpoch(target.id);
  AuthService.invalidateUser(target.id);
  ['ADMIN_EMPLOYEE_NO', 'ADMIN_TEMP_PASSWORD'].forEach((k) => Props.remove(k));
  SetupHelpers.removePinProperties();
  Log.info('initAdminPassword: the Admin password was set; the temporary properties and the Admin PIN properties were removed');
}

const REQUIRED_PROPERTIES = ['ENV', 'TLMI_DB_ID', 'LEGACY_COPY_ID', 'REVIEW_SHEET_ID', 'PEPPER'];

// Reports which Script Properties are missing, by name only.
function checkConfig() {
  EditorGuard.check();
  const missing = REQUIRED_PROPERTIES.filter((k) => !Props.get(k));
  Log.info(missing.length ? 'checkConfig: missing ' + missing.join(', ') : 'checkConfig: ok');
  return { ok: missing.length === 0, missing: missing };
}

// Times one hash at 1000 and at 10000 iterations, to choose Hasher.DEFAULT_ITERATIONS (plan Task 2).
function measureHash() {
  EditorGuard.check();
  const time = (n) => {
    const t0 = Clock.ms();
    Hasher.hash('throwaway-value', Hasher.newSalt(), 'throwaway-pepper', n);
    return Clock.ms() - t0;
  };
  const res = { ms1000: time(1000), ms10000: time(10000) };
  Log.info('measureHash: 1000 iterations took ' + res.ms1000 + ' ms, 10000 iterations took ' + res.ms10000 + ' ms');
  return res;
}
