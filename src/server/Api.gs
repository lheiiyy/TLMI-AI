// The only functions the browser may use: tlmiApi(request) and doGet(). Spec section 4. Any other top-level function can be
// reached with google.script.run, so each of those starts with EditorGuard.check() (Platform.gs, Setup.gs; limit L-3).
// Order of checks: parse, session, user and role, permission table, validate params, service. The first failure stops the call.
const Api = (function () {
  const REQUEST_KEYS = ['v', 'rid', 'method', 'params', 'token', 'reason'];

  // Every method of every service. Services that do not exist yet are skipped.
  function registry() {
    const reg = {};
    const sources = [
      AuthService.methods(),
      typeof MasterDataService !== 'undefined' ? MasterDataService.methods() : {},
      typeof SettingsService !== 'undefined' && SettingsService.methods ? SettingsService.methods() : {},
      typeof UserService !== 'undefined' ? UserService.methods() : {},
      AuditService.methods(),
      typeof SeedService !== 'undefined' ? SeedService.methods() : {},
      typeof ImportReviewService !== 'undefined' ? ImportReviewService.methods() : {},
      typeof PersonService !== 'undefined' ? PersonService.methods() : {},
      typeof TlService !== 'undefined' ? TlService.methods() : {},
    ];
    sources.forEach((s) => Object.keys(s).forEach((k) => { reg[k] = s[k]; }));
    return reg;
  }

  // A handler returns its data, or paged(data, page) for a list.
  function paged(data, page) { return { __paged: true, data: data, page: page }; }

  function meta(requestId, rid, page) {
    const m = { request_id: requestId, rid: rid, server_time: Clock.iso(), server_date: Clock.today() };
    if (page) m.page = page;
    return m;
  }

  function failure(e, requestId, rid) {
    if (e instanceof AppError) {
      const err = { code: e.code, message: e.message };
      ['fields', 'retry_after', 'current', 'rule_id'].forEach((k) => { if (e[k] !== undefined) err[k] = e[k]; });
      return { ok: false, error: err, meta: meta(requestId, rid) };
    }
    Log.error(requestId, e);
    return { ok: false, error: { code: 'SERVER', message: 'Something went wrong. Quote request ' + requestId + '.' }, meta: meta(requestId, rid) };
  }

  function parse(request) {
    if (request === null || typeof request !== 'object' || Array.isArray(request)) {
      throw Errors.validation([{ path: '', code: 'TYPE', message: 'An object is expected.' }]);
    }
    const errs = [];
    Object.keys(request).forEach((k) => {
      if (REQUEST_KEYS.indexOf(k) < 0) errs.push({ path: k, code: 'UNKNOWN_FIELD', message: 'Unknown field.' });
    });
    if (request.v !== 1) errs.push({ path: 'v', code: 'VALUE', message: 'v must be 1.' });
    if (typeof request.method !== 'string' || request.method === '') errs.push({ path: 'method', code: 'REQUIRED', message: 'method is required.' });
    if (request.params !== undefined && (request.params === null || typeof request.params !== 'object' || Array.isArray(request.params))) {
      errs.push({ path: 'params', code: 'TYPE', message: 'params must be an object.' });
    }
    if (errs.length) throw Errors.validation(errs);
  }

  function handle(request) {
    const requestId = Ids.uuid();
    const rid = request && typeof request.rid === 'string' ? request.rid.slice(0, 64) : null;
    let ctx = null;
    let method = '';
    try {
      parse(request);
      method = request.method;
      const def = Api.registry()[method];
      if (!def) throw Errors.notFound('Unknown method.');
      ctx = { requestId: requestId, now: Clock.iso(), method: method, token: request.token };
      if (def.auth !== false) {
        const s = AuthService.session(request.token);
        ctx.userId = s.user.id; ctx.hrEmployeeNo = s.user.hr_employee_no || ''; ctx.role = s.role; ctx.user = s.user;
        // A temporary password must be changed first: every other method is refused until it is (spec 4.1 rule 5).
        if (s.user.must_change_password && AuthService.ALLOWED_WHILE_MUST_CHANGE.indexOf(method) < 0) {
          throw Errors.forbidden('Change your password first.');
        }
        const roles = AuthService.PERMISSIONS[method];
        if (!roles || roles.indexOf(s.role) < 0) throw Errors.forbidden();
      }
      const params = Validator.clean({ name: method, fields: def.params || {} }, request.params === undefined ? {} : request.params, 'create');
      const out = def.handler(ctx, params);
      const isPaged = out && out.__paged === true;
      return { ok: true, data: isPaged ? out.data : out, meta: meta(requestId, rid, isPaged ? out.page : null) };
    } catch (e) {
      // A refused or conflicting call by a signed-in user is written to the audit log.
      if (e instanceof AppError && ctx && ctx.userId && (e.code === 'FORBIDDEN' || e.code === 'CONFLICT')) {
        const id = request.params && typeof request.params.id === 'string' ? request.params.id : '';
        AuditService.logOutcome(ctx, {
          event: 'API.' + e.code, entity: method, entityId: id, result: e.code === 'FORBIDDEN' ? 'DENIED' : 'FAILED',
        });
      }
      return failure(e, requestId, rid);
    }
  }

  return { handle: handle, registry: registry, paged: paged };
})();

function tlmiApi(request) { return Api.handle(request); }

function doGet() { return Html.page('index'); }
