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

// Turns the temporary property ADMIN_PIN_NEW into a salted, iterated hash and removes the plain PIN.
function initAdminPin() {
  EditorGuard.check();
  const pin = Props.get('ADMIN_PIN_NEW');
  if (!pin) throw new Error('Set the Script Property ADMIN_PIN_NEW first.');
  if (pin.length < 6) throw new Error('The Admin PIN must be at least 6 characters. ADMIN_PIN_NEW was left in place.');
  const pepper = Props.get('PEPPER');
  if (!pepper) throw new Error('Run initSecrets first (PEPPER is missing).');
  const salt = Hasher.newSalt();
  Props.set('ADMIN_PIN_HASH', Hasher.hash(pin, salt, pepper));
  Props.set('ADMIN_PIN_SALT', salt);
  Props.remove('ADMIN_PIN_NEW');
  Props.remove('ADMIN_PIN_FAILS');
  Log.info('initAdminPin: the Admin PIN is set; ADMIN_PIN_NEW was removed');
}

// Makes the first Admin, so that someone can sign in and run the seed. The owner types their own name into the
// temporary Script Property FIRST_ADMIN_NAME. It refuses when an active Admin already exists, and removes the property.
// The new Admin still needs the Admin PIN (initAdminPin) to sign in.
function initFirstAdmin() {
  EditorGuard.check();
  const name = String(Props.get('FIRST_ADMIN_NAME') || '').trim();
  if (!name) throw new Error('Set the Script Property FIRST_ADMIN_NAME first (your own name).');
  const users = Repository.all('users');
  if (users.some((u) => u.role === 'Admin' && u.is_active)) {
    throw new Error('An active Admin already exists. Nothing was changed.');
  }
  // Compared as the seed compares names (trimmed, spaces collapsed, case-insensitive), so the seed will skip this user as EXISTS.
  const key = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
  if (users.some((u) => key(u.display_name) === key(name))) {
    throw new Error('A user already has that name. Type your name exactly as it is written in the SEED_OFFICERS tab, and make sure it is not already a user. Nothing was changed.');
  }
  const now = Clock.iso();
  Repository.transact((uow) => {
    const row = uow.insert('users', { display_name: name, role: 'Admin' }, { userId: '', now: now });
    AuditService.event(uow, { userId: '', hrEmployeeNo: '', requestId: 'editor', now: now },
      { event: 'USER.CREATED', entity: 'users', entityId: row.id, detail: { role: 'Admin', source: 'initFirstAdmin' } });
  });
  Props.remove('FIRST_ADMIN_NAME');
  Log.info('initFirstAdmin: the first Admin was created; FIRST_ADMIN_NAME was removed');
}

const REQUIRED_PROPERTIES = ['ENV', 'TLMI_DB_ID', 'LEGACY_COPY_ID', 'REVIEW_SHEET_ID', 'PEPPER', 'ADMIN_PIN_HASH', 'ADMIN_PIN_SALT'];

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
