// Employee ID and password sign-in (Phase 2 spec section 4), sessions with an epoch per user, the user record check on
// every call, and the single permission table. A password, a temporary password or a hash is never written to the audit
// log, a log line, an error message or a response.
const AuthService = (function () {
  const OFFICER = 'Training Officer';
  const SUPERVISOR = 'Training Supervisor';
  const MANAGER = 'Training Manager';
  const SENIOR = 'Senior Training Manager';
  const ADMIN = 'Admin';
  const ALL = [OFFICER, SUPERVISOR, MANAGER, SENIOR, ADMIN];

  const SESSION_MAX_MS = 6 * 60 * 60 * 1000;
  const USER_CACHE_TTL = 60;
  const EPOCH_PREFIX = 'SESSION_EPOCH:';
  const EPOCH_CACHE_TTL = 60;
  const AUDIT_FAIL_CAP = 50;
  const PAGE_SIZE = 50;
  const ALLOWED_WHILE_MUST_CHANGE = ['auth.me', 'auth.signOut', 'auth.changePassword'];

  // One object, spec section 6.2. A method that is not listed here is denied.
  const PERMISSIONS = {
    'auth.signOut': ALL,
    'auth.me': ALL,
    'auth.changePassword': ALL,
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
    'users.resetPassword': [ADMIN], 'users.clearCooldown': [ADMIN],
    'settings.list': [MANAGER, SENIOR, ADMIN], 'settings.get': [MANAGER, SENIOR, ADMIN],
    'settings.set': [ADMIN],
    'seed.run': [ADMIN],
    'importReview.run': [ADMIN], 'importReview.get': [ADMIN],
    'persons.get': ALL, 'persons.matchCandidates': ALL,
    'tl.list': ALL, 'tl.get': ALL, 'tl.history': ALL,
    'tl.enroll': ALL, 'tl.update': ALL, 'tl.recordEntryGrade': ALL,
    'tl.recordCertCheck': ALL, 'tl.certify': ALL, 'tl.extend': ALL, 'tl.close': ALL, 'tl.quit': ALL,
    'tl.returnToProbation': [SUPERVISOR, MANAGER, SENIOR], 'tl.promote': [SUPERVISOR, MANAGER, SENIOR],
    'import.validate': [ADMIN], 'import.get': [ADMIN], 'import.rows.list': [ADMIN], 'import.rows.skip': [ADMIN],
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
    const rec = {
      id: row.id, display_name: row.display_name, role: row.role, is_active: row.is_active,
      hr_employee_no: row.hr_employee_no, must_change_password: row.must_change_password === true,
    };
    CacheStore.put('user:' + id, rec, USER_CACHE_TTL);
    return rec;
  }

  function invalidateUser(id) { CacheStore.remove('user:' + id); }

  // The session epoch of a user (TDMS D077): a Script Property, cached for a minute. It goes up on a password change,
  // a password reset, a role change and a deactivation, and ends every session that was issued before.
  function epoch(userId) {
    const hit = CacheStore.get('epoch:' + userId);
    if (hit !== null) return hit.n;
    const n = Number(Props.get(EPOCH_PREFIX + userId)) || 0;
    CacheStore.put('epoch:' + userId, { n: n }, EPOCH_CACHE_TTL);
    return n;
  }

  function bumpEpoch(userId) {
    const n = (Number(Props.get(EPOCH_PREFIX + userId)) || 0) + 1;
    Props.set(EPOCH_PREFIX + userId, n);
    CacheStore.remove('epoch:' + userId);
    return n;
  }

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
    if ((s.epoch || 0) < epoch(s.userId)) { CacheStore.remove(key); throw expired(); }
    s.lastSeen = now;
    CacheStore.put(key, s, Math.max(1, Math.floor((SESSION_MAX_MS - (now - s.issuedAt)) / 1000)));
    return { user: user, role: user.role };
  }

  function userCtx(ctx, user) {
    return Object.assign({}, ctx, { userId: user.id, hrEmployeeNo: user.hr_employee_no || '' });
  }

  function publicUser(user) { return { id: user.id, name: user.display_name, role: user.role }; }

  // The methods of the permission table that are open to the role.
  function capabilities(role) {
    return Object.keys(PERMISSIONS).filter((m) => PERMISSIONS[m].indexOf(role) >= 0).sort();
  }

  // The block returned by auth.signIn (with the token) and auth.me (without it), TDMS API-CONTRACT section 5.
  function sessionInfo(user) {
    return {
      must_change_password: user.must_change_password === true,
      user: publicUser(user),
      capabilities: capabilities(user.role),
      scope: { brand_ids: Repository.all('brands').filter((b) => b.is_active).map((b) => b.id) },
      flags: {},
      settings_public: { idle_minutes: SettingsService.intOr('CFG-001', 30), page_size: PAGE_SIZE },
    };
  }

  function startSession(ctx, user) {
    const token = Ids.uuid();
    const now = Clock.ms();
    CacheStore.put('sess:' + token, { userId: user.id, issuedAt: now, lastSeen: now, epoch: epoch(user.id) }, SESSION_MAX_MS / 1000);
    return token;
  }

  function pepper() {
    const v = Props.get('PEPPER');
    if (!v) throw Errors.configMissing('PEPPER');
    return v;
  }

  // New salt and hash for a password, with the current iteration count.
  function newCredentials(password) {
    const salt = Hasher.newSalt();
    return { password_hash: Hasher.hash(password, salt, pepper()), salt: salt };
  }

  // Audit rows of failed sign-ins are capped per user and day (spec 4.2 item 5). The counter lives in the cache; an
  // evicted counter only lets a few more rows through. The failure itself is always counted on the user record.
  function auditFailure(ctx, user, event) {
    const key = 'authfail:' + user.id + ':' + Clock.today();
    const n = (CacheStore.get(key) || { n: 0 }).n;
    if (n >= AUDIT_FAIL_CAP) return;
    CacheStore.put(key, { n: n + 1 }, 86400);
    AuditService.logOutcome(userCtx(ctx, user), { event: event, entity: 'users', entityId: user.id, result: 'DENIED' });
  }

  function locked(retryAfterSec) {
    return new AppError('AUTH_LOCKED', 'Too many tries. Try again later.', { retry_after: retryAfterSec });
  }

  function findByEmployeeNo(no) {
    return Repository.all('users').filter((u) => u.is_active && u.hr_employee_no === no)[0] || null;
  }

  // A wrong password of a known user: re-read the user inside the lock, count, and pause at CFG-002 (spec 4.2).
  function recordFailure(ctx, userId) {
    return LockGuard.run(() => {
      const now = Clock.ms();
      const outcome = Repository.transact((uow) => {
        const u = uow.get('users', userId);
        if (u.cooldown_until && Clock.parse(u.cooldown_until) > now) return { user: u, paused: true, retry: Math.ceil((Clock.parse(u.cooldown_until) - now) / 1000) };
        const maxTries = SettingsService.intOr('CFG-002', 5);
        const pauseMin = SettingsService.intOr('CFG-003', 15);
        const count = (u.failed_attempts || 0) + 1;
        const actor = { userId: '', now: ctx.now };
        if (count >= maxTries) {
          uow.update('users', userId, { failed_attempts: 0, cooldown_until: Clock.isoAt(now + pauseMin * 60000) }, { expectedVersion: u.row_version, actor: actor });
          return { user: u, paused: true, retry: pauseMin * 60 };
        }
        uow.update('users', userId, { failed_attempts: count }, { expectedVersion: u.row_version, actor: actor });
        return { user: u, paused: false };
      });
      invalidateUser(userId);
      return outcome;
    }, 10000);
  }

  function signIn(ctx, p) {
    const pep = pepper();
    const user = findByEmployeeNo(p.employee_id);
    if (!user) {
      // Equal hashing work for an unknown or inactive number; no lock and no row (spec 4.2 item 2).
      Hasher.hash(p.password, 'unknown-user-salt', pep);
      throw new AppError('AUTH_FAILED', 'Sign-in failed. Check the employee ID and the password.');
    }
    const now = Clock.ms();
    // The pause is checked before any hash is computed.
    if (user.cooldown_until && Clock.parse(user.cooldown_until) > now) {
      auditFailure(ctx, user, 'AUTH.SIGNIN.LOCKED');
      throw locked(Math.ceil((Clock.parse(user.cooldown_until) - now) / 1000));
    }
    const ok = !!user.password_hash && !!user.salt && Hasher.verify(p.password, user.salt, pep, user.password_hash);
    if (!ok) {
      if (!user.password_hash) Hasher.hash(p.password, 'unknown-user-salt', pep);
      const out = recordFailure(ctx, user.id);
      if (out.paused) {
        auditFailure(ctx, user, 'AUTH.SIGNIN.LOCKED');
        throw locked(out.retry);
      }
      auditFailure(ctx, user, 'AUTH.SIGNIN.FAILED');
      throw new AppError('AUTH_FAILED', 'Sign-in failed. Check the employee ID and the password.');
    }
    // Success: reset the counters, note the time, and upgrade an old hash (TDMS AD-10), all under the lock.
    const fresh = LockGuard.run(() => Repository.transact((uow) => {
      const u = uow.get('users', user.id);
      const patch = { last_login_at: ctx.now };
      if (u.failed_attempts) patch.failed_attempts = 0;
      if (u.cooldown_until) patch.cooldown_until = null;
      if (Hasher.needsRehash(u.password_hash)) patch.password_hash = Hasher.hash(p.password, u.salt, pep);
      uow.update('users', user.id, patch, { expectedVersion: u.row_version, actor: { userId: u.id, now: ctx.now } });
      return u;
    }), 10000);
    invalidateUser(user.id);
    const rec = userRecord(user.id);
    const token = startSession(ctx, rec);
    AuditService.logOutcome(userCtx(ctx, rec), { event: 'AUTH.SIGNIN', entity: 'users', entityId: rec.id, result: 'OK' });
    return Object.assign({ token: token }, sessionInfo(rec));
  }

  // A wrong current password counts on the same per-user counter as a wrong sign-in password and starts the same pause
  // (Reviewer decision on PR #20, finding 1). While the user is paused the call is refused before any hash is computed.
  function changePassword(ctx, p) {
    const u = Repository.get('users', ctx.userId);
    if (!u) throw new AppError('AUTH_FAILED', 'The current password is not correct.');
    const now = Clock.ms();
    if (u.cooldown_until && Clock.parse(u.cooldown_until) > now) {
      auditFailure(ctx, u, 'AUTH.PASSWORD_CHANGE.FAILED');
      throw locked(Math.ceil((Clock.parse(u.cooldown_until) - now) / 1000));
    }
    const ok = !!u.password_hash && !!u.salt && Hasher.verify(p.current, u.salt, pepper(), u.password_hash);
    if (!ok) {
      const out = recordFailure(ctx, u.id);
      auditFailure(ctx, u, 'AUTH.PASSWORD_CHANGE.FAILED');
      if (out.paused) throw locked(out.retry);
      throw new AppError('AUTH_FAILED', 'The current password is not correct.');
    }
    const bad = PasswordRules.error('new', p.new, p.current);
    if (bad) throw bad;
    const cred = newCredentials(p.new);
    const patch = { password_hash: cred.password_hash, salt: cred.salt, must_change_password: false };
    Repository.transact((uow) => {
      const cur = uow.get('users', ctx.userId);
      if (cur.failed_attempts) patch.failed_attempts = 0;
      if (cur.cooldown_until) patch.cooldown_until = null;
      const r = uow.update('users', ctx.userId, patch, { expectedVersion: cur.row_version, actor: { userId: ctx.userId, now: ctx.now } });
      AuditService.changes(uow, ctx, 'users', ctx.userId, r.before, r.after);
      AuditService.event(uow, ctx, { event: 'AUTH.PASSWORD_CHANGED', entity: 'users', entityId: ctx.userId });
    });
    bumpEpoch(ctx.userId);
    invalidateUser(ctx.userId);
    CacheStore.remove('sess:' + ctx.token);
    return { token: startSession(ctx, userRecord(ctx.userId)) };
  }

  function methods() {
    return {
      'system.ping': { kind: 'R', auth: false, params: {}, handler: () => ({ pong: true, version: 1 }) },
      'auth.signIn': {
        kind: 'W', auth: false,
        params: {
          employee_id: { type: 'text', required: true, max: 20, pattern: /^\d{1,20}$/, patternMessage: 'Digits only.' },
          password: { type: 'text', required: true, max: 200 },
        },
        handler: signIn,
      },
      'auth.changePassword': {
        kind: 'W',
        params: { current: { type: 'text', required: true, max: 200 }, new: { type: 'text', required: true, max: 200 } },
        handler: changePassword,
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
        handler: (ctx) => sessionInfo(ctx.user),
      },
    };
  }

  return {
    PERMISSIONS: PERMISSIONS, ALLOWED_WHILE_MUST_CHANGE: ALLOWED_WHILE_MUST_CHANGE, methods: methods, session: session,
    userRecord: userRecord, invalidateUser: invalidateUser, epoch: epoch, bumpEpoch: bumpEpoch, newCredentials: newCredentials,
  };
})();
