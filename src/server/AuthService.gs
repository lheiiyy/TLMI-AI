// Interim sign-in (spec section 6, exception X-1): a name list, plus the Admin PIN for Admin. Sessions, the user
// record check on every call, and the single permission table. Replaced by password sign-in in Phase 2.
const AuthService = (function () {
  const OFFICER = 'Training Officer';
  const SUPERVISOR = 'Training Supervisor';
  const MANAGER = 'Training Manager';
  const SENIOR = 'Senior Training Manager';
  const ADMIN = 'Admin';
  const ALL = [OFFICER, SUPERVISOR, MANAGER, SENIOR, ADMIN];

  const SESSION_MAX_MS = 6 * 60 * 60 * 1000;
  const USER_CACHE_TTL = 60;
  const FAILS_KEY = 'ADMIN_PIN_FAILS';

  // One object, spec section 6.2. A method that is not listed here is denied.
  const PERMISSIONS = {
    'auth.signOut': ALL,
    'auth.me': ALL,
    'brands.list': ALL, 'brands.get': ALL,
    'regions.list': ALL, 'regions.get': ALL,
    'locations.list': ALL, 'locations.get': ALL,
    'stations.list': ALL, 'stations.get': ALL,
    'lookups.list': ALL, 'lookups.get': ALL,
    'brands.create': [ADMIN], 'brands.update': [ADMIN], 'brands.deactivate': [ADMIN], 'brands.reactivate': [ADMIN],
    'regions.create': [ADMIN], 'regions.update': [ADMIN], 'regions.deactivate': [ADMIN], 'regions.reactivate': [ADMIN],
    'locations.create': [ADMIN], 'locations.update': [ADMIN], 'locations.deactivate': [ADMIN], 'locations.reactivate': [ADMIN],
    'stations.create': [ADMIN], 'stations.update': [ADMIN], 'stations.deactivate': [ADMIN], 'stations.reactivate': [ADMIN],
    'lookups.create': [ADMIN], 'lookups.update': [ADMIN], 'lookups.deactivate': [ADMIN], 'lookups.reactivate': [ADMIN],
    'components.list': [ADMIN], 'components.get': [ADMIN], 'components.update': [ADMIN],
    'users.list': [ADMIN], 'users.get': [ADMIN], 'users.create': [ADMIN], 'users.update': [ADMIN],
    'users.deactivate': [ADMIN], 'users.reactivate': [ADMIN],
    'settings.list': [MANAGER, SENIOR, ADMIN], 'settings.get': [MANAGER, SENIOR, ADMIN],
    'settings.set': [ADMIN],
    'seed.run': [ADMIN],
    'audit.list': [SENIOR, ADMIN],
    'history.get': [ADMIN],
  };

  function fail(msg) { return new AppError('AUTH_FAILED', msg || 'Sign-in failed.'); }

  // The user as the session sees it, from a short cache. A user write removes the entry (invalidateUser).
  function userRecord(id) {
    const hit = CacheStore.get('user:' + id);
    if (hit) return hit;
    const row = Repository.get('users', id);
    if (!row) return null;
    const rec = { id: row.id, display_name: row.display_name, role: row.role, is_active: row.is_active, hr_employee_no: row.hr_employee_no };
    CacheStore.put('user:' + id, rec, USER_CACHE_TTL);
    return rec;
  }

  function invalidateUser(id) { CacheStore.remove('user:' + id); }

  function session(token) {
    if (typeof token !== 'string' || token === '') throw new AppError('AUTH_REQUIRED', 'Sign in to continue.');
    const key = 'sess:' + token;
    const s = CacheStore.get(key);
    const expired = () => new AppError('SESSION_EXPIRED', 'Your session has ended. Sign in again.');
    if (!s) throw expired();
    const now = Clock.ms();
    const idleMs = SettingsService.intOr('CFG-001', 30) * 60000;
    if (now - s.lastSeen > idleMs || now - s.issuedAt > SESSION_MAX_MS) { CacheStore.remove(key); throw expired(); }
    const user = userRecord(s.userId);
    if (!user || !user.is_active) { CacheStore.remove(key); throw new AppError('AUTH_REQUIRED', 'Sign in to continue.'); }
    s.lastSeen = now;
    CacheStore.put(key, s, Math.max(1, Math.floor((SESSION_MAX_MS - (now - s.issuedAt)) / 1000)));
    return { user: user, role: user.role };
  }

  function userCtx(ctx, user) {
    return Object.assign({}, ctx, { userId: user.id, hrEmployeeNo: user.hr_employee_no || '' });
  }

  function publicUser(user) { return { id: user.id, name: user.display_name, role: user.role }; }

  function readFails() {
    const raw = Props.get(FAILS_KEY);
    if (!raw) return { count: 0, pausedUntil: 0 };
    try { return JSON.parse(raw); } catch (e) { return { count: 0, pausedUntil: 0 }; }
  }

  function writeFails(state) { Props.set(FAILS_KEY, JSON.stringify(state)); }

  function startSession(ctx, user) {
    const token = Ids.uuid();
    const now = Clock.ms();
    CacheStore.put('sess:' + token, { userId: user.id, issuedAt: now, lastSeen: now }, SESSION_MAX_MS / 1000);
    AuditService.logOutcome(userCtx(ctx, user), { event: 'AUTH.SIGNIN', entity: 'users', entityId: user.id, result: 'OK' });
    return { token: token, user: publicUser(user) };
  }

  function checkAdminPin(ctx, user, pin) {
    const now = Clock.ms();
    let state = readFails();
    // The pause is checked before the hash is computed.
    if (state.pausedUntil > now) {
      AuditService.logOutcome(userCtx(ctx, user), { event: 'AUTH.SIGNIN.LOCKED', entity: 'users', entityId: user.id, result: 'DENIED' });
      throw new AppError('AUTH_LOCKED', 'Too many tries. Try again later.', { retry_after: Math.ceil((state.pausedUntil - now) / 1000) });
    }
    const hash = Props.get('ADMIN_PIN_HASH');
    const salt = Props.get('ADMIN_PIN_SALT');
    if (!hash) throw Errors.configMissing('ADMIN_PIN_HASH');
    if (!salt) throw Errors.configMissing('ADMIN_PIN_SALT');
    const ok = typeof pin === 'string' && pin !== '' && Hasher.verify(pin, salt, Props.get('PEPPER') || '', hash);
    if (ok) {
      if (state.count !== 0 || state.pausedUntil !== 0) writeFails({ count: 0, pausedUntil: 0 });
      return;
    }
    const maxTries = SettingsService.intOr('CFG-002', 5);
    const pauseMin = SettingsService.intOr('CFG-003', 15);
    state = { count: state.count + 1, pausedUntil: 0 };
    if (state.count >= maxTries) {
      writeFails({ count: 0, pausedUntil: now + pauseMin * 60000 });
      AuditService.logOutcome(userCtx(ctx, user), { event: 'AUTH.SIGNIN.LOCKED', entity: 'users', entityId: user.id, result: 'DENIED' });
      throw new AppError('AUTH_LOCKED', 'Too many tries. Try again later.', { retry_after: pauseMin * 60 });
    }
    writeFails(state);
    AuditService.logOutcome(userCtx(ctx, user), { event: 'AUTH.SIGNIN.FAILED', entity: 'users', entityId: user.id, result: 'FAILED' });
    throw fail();
  }

  function signIn(ctx, p) {
    return LockGuard.run(() => {
      const user = Repository.get('users', p.user_id);
      if (!user || !user.is_active) {
        AuditService.logOutcome(ctx, { event: 'AUTH.SIGNIN.FAILED', entity: 'users', entityId: p.user_id, result: 'FAILED' });
        throw fail();
      }
      if (user.role === ADMIN) checkAdminPin(ctx, user, p.pin);
      return startSession(ctx, user);
    }, 10000);
  }

  function methods() {
    return {
      'system.ping': { kind: 'R', auth: false, params: {}, handler: () => ({ pong: true, version: 1 }) },
      'auth.listSignInUsers': {
        kind: 'R', auth: false, params: {},
        handler: () => Repository.all('users').filter((u) => u.is_active)
          .map((u) => ({ id: u.id, display_name: u.display_name }))
          .sort((a, b) => (a.display_name < b.display_name ? -1 : a.display_name > b.display_name ? 1 : 0)),
      },
      'auth.signIn': {
        kind: 'W', auth: false,
        params: { user_id: { type: 'text', required: true, max: 20 }, pin: { type: 'text', max: 200 } },
        handler: signIn,
      },
      'auth.signOut': {
        kind: 'W', params: {},
        handler: (ctx) => {
          CacheStore.remove('sess:' + ctx.token);
          AuditService.logOutcome(ctx, { event: 'AUTH.SIGNOUT', entity: 'users', entityId: ctx.userId, result: 'OK' });
          return { signed_out: true };
        },
      },
      'auth.me': {
        kind: 'R', params: {},
        handler: (ctx) => ({ user: publicUser(ctx.user) }),
      },
    };
  }

  return { PERMISSIONS: PERMISSIONS, methods: methods, session: session, userRecord: userRecord, invalidateUser: invalidateUser };
})();
