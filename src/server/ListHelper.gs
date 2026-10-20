// Filters, search, one sort key and paging for list methods (spec section 4, TDMS API-CONTRACT 6.1). Pure: no I/O.
const Lists = (function () {
  const MAX_PAGE = 50;
  const DEFAULT_PAGE = 25;

  // cfg: { filters: [field names], search: [field names], sortable: [field names], defaultSort: 'name' }
  function run(rows, p, cfg) {
    const errs = [];
    const f = p.filters || {};
    Object.keys(f).forEach((k) => {
      if (cfg.filters.indexOf(k) < 0) errs.push({ path: 'filters.' + k, code: 'UNKNOWN_FIELD', message: 'This filter is not allowed.' });
    });
    const page = p.page === undefined ? 1 : p.page;
    const size = p.page_size === undefined ? DEFAULT_PAGE : p.page_size;
    if (!Number.isInteger(page) || page < 1) errs.push({ path: 'page', code: 'RANGE', message: 'page must be 1 or more.' });
    if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE) errs.push({ path: 'page_size', code: 'RANGE', message: 'page_size must be 1 to ' + MAX_PAGE + '.' });
    const sortSpec = p.sort || cfg.defaultSort;
    const desc = sortSpec.charAt(0) === '-';
    const sortField = desc ? sortSpec.slice(1) : sortSpec;
    if (cfg.sortable.indexOf(sortField) < 0) errs.push({ path: 'sort', code: 'NOT_ALLOWED', message: 'Cannot sort by this field.' });
    if (errs.length) throw Errors.validation(errs);

    let out = rows.filter((r) => Object.keys(f).every((k) => r[k] === f[k]));
    if (p.q) {
      const q = String(p.q).toLowerCase();
      out = out.filter((r) => cfg.search.some((k) => String(r[k] === null || r[k] === undefined ? '' : r[k]).toLowerCase().indexOf(q) >= 0));
    }
    const key = (r) => {
      const v = r[sortField];
      return typeof v === 'string' ? v.toLowerCase() : v;
    };
    out = out.slice().sort((a, b) => {
      const x = key(a), y = key(b);
      let c = 0;
      if (x === y || (x === null && y === null)) c = 0;
      else if (x === null || x === undefined) c = 1;
      else if (y === null || y === undefined) c = -1;
      else c = x < y ? -1 : 1;
      if (desc) c = -c;
      if (c !== 0) return c;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const total = out.length;
    const items = out.slice((page - 1) * size, page * size);
    return { items: items, page: { page: page, page_size: size, total: total } };
  }

  // Param definitions that every list method accepts.
  const PARAMS = {
    filters: { type: 'object' },
    sort: { type: 'text', max: 40 },
    page: { type: 'int' },
    page_size: { type: 'int' },
    q: { type: 'text', max: 100 },
  };

  return { run: run, PARAMS: PARAMS, MAX_PAGE: MAX_PAGE };
})();
