// Users (Phase 1 spec sections 5 and 6.2, Phase 2 spec section 4). Admin only. The hash, the salt and the failure counters
// are never returned. A password is set only through a temporary password (create, resetPassword), which is returned once.
const UserService = (function () {
  const EDITABLE = ['display_name', 'hr_employee_no', 'role'];
  const ROLE_ENUM = ['Training Officer', 'Training Supervisor', 'Training Manager', 'Senior Training Manager', 'Admin'];

  const actorOf = (ctx) => ({ userId: ctx.userId, now: ctx.now });

  function view(u) {
    const c = Object.assign({}, u);
    delete c.password_hash;
    delete c.salt;
    delete c.failed_attempts;
    delete c.cooldown_until;
    c.paused = !!u.cooldown_until && Clock.parse(u.cooldown_until) > Clock.ms();
    c.must_change_password = u.must_change_password === true;
    return c;
  }

  function lastAdminGuard(uow, before, after) {
    const wasAdmin = before.role === 'Admin' && before.is_active;
    const stillAdmin = after.role === 'Admin' && after.is_active;
    if (!wasAdmin || stillAdmin) return;
    const others = uow.all('users').filter((u) => u.id !== before.id && u.role === 'Admin' && u.is_active);
    if (others.length === 0) {
      throw Errors.validation([{ path: after.is_active ? 'role' : 'is_active', code: 'LAST_ADMIN', message: 'The last active Admin cannot be removed.' }]);
    }
  }

  function write(ctx, p, suffix, opts) {
    const res = Repository.transact((uow) => {
      const before = uow.get('users', p.id);
      if (!before) throw Errors.notFound();
      if (opts.patch && 'role' in opts.patch && opts.patch.role !== before.role && p.id === ctx.userId) {
        throw Errors.forbidden('You cannot change your own role.');
      }
      // Once set, the HR employee number cannot be emptied: it is the sign-in ID (spec 4.3).
      if (opts.patch && 'hr_employee_no' in opts.patch && before.hr_employee_no && !opts.patch.hr_employee_no) {
        throw Errors.validation([{ path: 'patch.hr_employee_no', code: 'REQUIRED', message: 'The HR employee number cannot be removed.' }]);
      }
      const r = uow.update('users', p.id, opts.patch || {}, { expectedVersion: p.row_version, actor: actorOf(ctx), isActive: opts.isActive });
      if (r.changed.length === 0) return r;
      lastAdminGuard(uow, r.before, r.after);
      AuditService.changes(uow, ctx, 'users', p.id, r.before, r.after);
      AuditService.event(uow, ctx, { event: 'USER.' + suffix, entity: 'users', entityId: p.id, detail: { changed: r.changed } });
      return r;
    });
    AuthService.invalidateUser(p.id);
    // A role change or a deactivation ends the user's sessions (spec 4.1 rule 6).
    if (res.changed.indexOf('role') >= 0 || res.changed.indexOf('is_active') >= 0) AuthService.bumpEpoch(p.id);
    return view(res.after);
  }

  // A new temporary password for a user: a new salt and hash, must_change_password set, the pause cleared, the sessions ended.
  function resetPassword(ctx, p) {
    if (p.id === ctx.userId) throw Errors.forbidden('Use Change password for your own account.');
    const temp = Ids.tempPassword();
    const cred = AuthService.newCredentials(temp);
    const patch = { password_hash: cred.password_hash, salt: cred.salt, must_change_password: true, failed_attempts: 0, cooldown_until: null };
    const res = Repository.transact((uow) => {
      const before = uow.get('users', p.id);
      if (!before) throw Errors.notFound();
      const r = uow.update('users', p.id, patch, { expectedVersion: p.row_version, actor: actorOf(ctx) });
      AuditService.changes(uow, ctx, 'users', p.id, r.before, r.after);
      AuditService.event(uow, ctx, { event: 'USER.PASSWORD_RESET', entity: 'users', entityId: p.id });
      return r;
    });
    AuthService.bumpEpoch(p.id);
    AuthService.invalidateUser(p.id);
    return { user: view(res.after), temporary_password: temp };
  }

  function clearCooldown(ctx, p) {
    const res = Repository.transact((uow) => {
      const before = uow.get('users', p.id);
      if (!before) throw Errors.notFound();
      const r = uow.update('users', p.id, { failed_attempts: 0, cooldown_until: null }, { expectedVersion: p.row_version, actor: actorOf(ctx) });
      AuditService.event(uow, ctx, { event: 'USER.COOLDOWN_CLEARED', entity: 'users', entityId: p.id });
      return r;
    });
    AuthService.invalidateUser(p.id);
    return { user: view(res.after) };
  }

  function methods() {
    const idRv = { id: { type: 'text', required: true, max: 40 }, row_version: { type: 'int', required: true } };
    return {
      'users.list': {
        kind: 'R', params: Lists.PARAMS,
        handler: (ctx, p) => {
          const r = Lists.run(Repository.all('users').map(view), p, {
            filters: ['role', 'is_active'], search: ['display_name', 'hr_employee_no'],
            sortable: ['id', 'display_name', 'role', 'is_active', 'created_at'], defaultSort: 'display_name',
          });
          return Api.paged(r.items, r.page);
        },
      },
      'users.get': {
        kind: 'R', params: { id: { type: 'text', required: true, max: 40 } },
        handler: (ctx, p) => {
          const u = Repository.get('users', p.id);
          if (!u) throw Errors.notFound();
          return view(u);
        },
      },
      'users.create': {
        kind: 'W',
        params: {
          display_name: { type: 'text', required: true, max: 150 },
          role: { type: 'text', required: true, enum: ROLE_ENUM },
          hr_employee_no: { type: 'text', required: true, max: 20, pattern: /^\d{1,20}$/, patternMessage: 'Digits only.' },
        },
        handler: (ctx, p) => {
          const temp = Ids.tempPassword();
          const cred = AuthService.newCredentials(temp);
          const row = Repository.transact((uow) => {
            const r = uow.insert('users', Object.assign({}, p, { password_hash: cred.password_hash, salt: cred.salt, must_change_password: true }), actorOf(ctx));
            AuditService.event(uow, ctx, { event: 'USER.CREATED', entity: 'users', entityId: r.id, detail: { role: r.role } });
            return r;
          });
          return { user: view(row), temporary_password: temp };
        },
      },
      'users.update': {
        kind: 'W', params: Object.assign({ patch: { type: 'object', required: true } }, idRv),
        handler: (ctx, p) => {
          const bad = Object.keys(p.patch).filter((k) => EDITABLE.indexOf(k) < 0);
          if (bad.length) throw Errors.validation(bad.map((k) => ({ path: 'patch.' + k, code: 'UNKNOWN_FIELD', message: 'This field cannot be changed here.' })));
          return write(ctx, p, 'UPDATED', { patch: p.patch });
        },
      },
      'users.resetPassword': { kind: 'W', params: idRv, handler: resetPassword },
      'users.clearCooldown': { kind: 'W', params: idRv, handler: clearCooldown },
      'users.deactivate': { kind: 'W', params: idRv, handler: (ctx, p) => write(ctx, p, 'DEACTIVATED', { isActive: false }) },
      'users.reactivate': { kind: 'W', params: idRv, handler: (ctx, p) => write(ctx, p, 'REACTIVATED', { isActive: true }) },
    };
  }

  return { methods: methods };
})();
