// Users (spec sections 5 and 6.2). Admin only. The hash and salt columns are never returned and cannot be written here
// (they belong to password sign-in in Phase 2).
const UserService = (function () {
  const EDITABLE = ['display_name', 'hr_employee_no', 'role'];
  const ROLE_ENUM = ['Training Officer', 'Training Supervisor', 'Training Manager', 'Senior Training Manager', 'Admin'];

  const actorOf = (ctx) => ({ userId: ctx.userId, now: ctx.now });

  function view(u) {
    const c = Object.assign({}, u);
    delete c.password_hash;
    delete c.salt;
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
      const r = uow.update('users', p.id, opts.patch || {}, { expectedVersion: p.row_version, actor: actorOf(ctx), isActive: opts.isActive });
      if (r.changed.length === 0) return r;
      lastAdminGuard(uow, r.before, r.after);
      AuditService.changes(uow, ctx, 'users', p.id, r.before, r.after);
      AuditService.event(uow, ctx, { event: 'USER.' + suffix, entity: 'users', entityId: p.id, detail: { changed: r.changed } });
      return r;
    });
    AuthService.invalidateUser(p.id);
    return view(res.after);
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
          hr_employee_no: { type: 'text', max: 20 },
        },
        handler: (ctx, p) => Repository.transact((uow) => {
          const row = uow.insert('users', p, actorOf(ctx));
          AuditService.event(uow, ctx, { event: 'USER.CREATED', entity: 'users', entityId: row.id, detail: { role: row.role } });
          return view(row);
        }),
      },
      'users.update': {
        kind: 'W', params: Object.assign({ patch: { type: 'object', required: true } }, idRv),
        handler: (ctx, p) => {
          const bad = Object.keys(p.patch).filter((k) => EDITABLE.indexOf(k) < 0);
          if (bad.length) throw Errors.validation(bad.map((k) => ({ path: 'patch.' + k, code: 'UNKNOWN_FIELD', message: 'This field cannot be changed here.' })));
          return write(ctx, p, 'UPDATED', { patch: p.patch });
        },
      },
      'users.deactivate': { kind: 'W', params: idRv, handler: (ctx, p) => write(ctx, p, 'DEACTIVATED', { isActive: false }) },
      'users.reactivate': { kind: 'W', params: idRv, handler: (ctx, p) => write(ctx, p, 'REACTIVATED', { isActive: true }) },
    };
  }

  return { methods: methods };
})();
