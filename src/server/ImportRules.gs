// Name matching, date and grade parsing, uniform-cell splitting and status mapping for the legacy import review
// (spec section 10, docs: migration/LEGACY-DATA-PROFILE.md). Pure functions: no I/O, no Google services, no clock.
// Nothing here guesses: a value is mapped only when it matches exactly one master record; anything else is a candidate.
const ImportRules = (function () {
  const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const SIZES = ['XSMALL', 'SMALL', 'MEDIUM', 'LARGE', 'XLARGE', 'XXLARGE', '2XLARGE'];
  const STATUS_MAP = {
    CERTIFIED: 'Certified', PROMOTION: 'Promoted', PROMOTED: 'Promoted', QUIT: 'Quit',
    EXTENDED: 'Extended', FAILED: 'Failed', PROBATIONARY: 'Probationary', DISQUALIFIED: 'Failed',
  };
  const REPORT_FLAGS = ['FOR REPORTING', 'NEW ENTRY'];
  const APPOINTMENT = ['SIGNED', 'AGENCY', 'ON-GOING PROMOTION'];

  const tidy = (s) => String(s === undefined || s === null ? '' : s).trim().replace(/\s+/g, ' ');

  // Upper case, trimmed, spaces collapsed, punctuation removed. Letters keep their accents (a tilde is a different letter).
  function normalizeName(s) {
    return tidy(s).toUpperCase().replace(/[-_/]+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  }

  function editDistance(a, b) {
    if (a === b) return 0;
    let prev = [];
    for (let j = 0; j <= b.length; j++) prev.push(j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function near(a, b) {
    const limit = Math.min(a.length, b.length) >= 6 ? 2 : 1;
    if (editDistance(a, b) <= limit) return true;
    const ta = a.split(' '), tb = b.split(' ');
    const small = ta.length <= tb.length ? ta : tb;
    const big = ta.length <= tb.length ? tb : ta;
    if (small.length < 2 && small[0].length < 4) return false;
    return small.every((t) => big.indexOf(t) >= 0);
  }

  // aliases: { 'raw spelling': 'master name' } that an officer has already confirmed.
  function matchMaster(raw, masterNames, aliases) {
    const n = normalizeName(raw);
    if (!n) return { status: 'none' };
    if (aliases) {
      const hit = Object.keys(aliases).find((k) => normalizeName(k) === n);
      if (hit) return { status: 'exact', match: aliases[hit], via: 'alias' };
    }
    const masters = masterNames.map((m) => ({ name: m, n: normalizeName(m) }));
    const exact = masters.filter((m) => m.n === n);
    const asterisk = String(raw).indexOf('*') >= 0;
    if (exact.length === 1 && !asterisk) return { status: 'exact', match: exact[0].name };
    if (exact.length >= 1) {
      const r = { status: 'candidate', candidates: exact.map((m) => m.name) };
      if (asterisk) r.note = 'ASTERISK';
      return r;
    }
    const cands = masters.filter((m) => near(n, m.n)).slice(0, 5).map((m) => m.name);
    return cands.length ? { status: 'candidate', candidates: cands } : { status: 'none' };
  }

  // A short name maps to a user only when exactly one officer's name starts with it; otherwise it is a candidate.
  function matchOfficer(raw, userNames) {
    const n = normalizeName(raw);
    if (!n) return { status: 'none' };
    const users = userNames.map((u) => ({ name: u, n: normalizeName(u) }));
    const starts = users.filter((u) => u.n.indexOf(n) === 0 || u.n.split(' ')[0].indexOf(n) === 0);
    // One or two letters are not a name: they can only be a candidate.
    if (n.length < 3) return starts.length ? { status: 'candidate', candidates: starts.map((u) => u.name) } : { status: 'none' };
    if (starts.length === 1) return { status: 'exact', match: starts[0].name };
    if (starts.length > 1) return { status: 'candidate', candidates: starts.map((u) => u.name) };
    const limit = n.length >= 6 ? 2 : 1;
    const cands = users.filter((u) => editDistance(n, u.n.split(' ')[0]) <= limit || editDistance(n, u.n) <= limit).slice(0, 5).map((u) => u.name);
    return cands.length ? { status: 'candidate', candidates: cands } : { status: 'none' };
  }

  // Notes that officers typed into an officer column.
  function looksLikeNote(s) {
    return /\d/.test(s) || /(^|[^A-Za-z])(NO CERT|RESIGN[A-Z]*|QUIT|EXTEND[A-Z]*|N\/A|NONE)([^A-Za-z]|$)/i.test(s);
  }

  function validDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1) return false;
    const days = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= days[m - 1];
  }

  const pad = (n, w) => String(n).padStart(w, '0');
  const isoOf = (y, m, d) => pad(y, 4) + '-' + pad(m, 2) + '-' + pad(d, 2);

  // For dd/mm/yyyy text whose day is 12 or less and differs from the month: the date read with day and month swapped.
  function swappedIso(display) {
    const mt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: \d{1,2}:\d{2}(?::\d{2})?)?$/.exec(tidy(display));
    if (!mt) return null;
    const d = Number(mt[1]), m = Number(mt[2]), y = Number(mt[3]);
    if (d > 12 || m === d || !validDate(y, d, m)) return null;
    return isoOf(y, d, m);
  }

  // Formats: d MMM yyyy, dd/mm/yyyy (day first, optional time), yyyy-mm-dd. today is yyyy-mm-dd.
  function parseDate(display, today) {
    const s = tidy(display);
    if (s === '') return {};
    let y, m, d;
    let mt = /^(\d{1,2}) ([A-Za-z]{3,9}) (\d{4})$/.exec(s);
    if (mt) {
      d = Number(mt[1]); m = MONTHS[mt[2].slice(0, 3).toUpperCase()]; y = Number(mt[3]);
    } else if ((mt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: \d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s))) {
      d = Number(mt[1]); m = Number(mt[2]); y = Number(mt[3]);
    } else if ((mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) {
      y = Number(mt[1]); m = Number(mt[2]); d = Number(mt[3]);
    } else {
      return { issue: 'UNREADABLE' };
    }
    if (!m || !validDate(y, m, d)) return { issue: 'UNREADABLE' };
    if (y === 1899 && m === 12 && d === 30) return { issue: 'SERIAL_1899' };
    const iso = isoOf(y, m, d);
    if (iso > today) {
      const out = { iso: iso, issue: 'FUTURE' };
      const swapped = swappedIso(s);
      if (swapped && swapped <= today) out.proposed = swapped;
      return out;
    }
    return { iso: iso };
  }

  // "95%" is 95. "9475%" is a scaled value (94.75), proposed but never applied.
  function parseGrade(display) {
    const s = tidy(display);
    if (s === '') return {};
    if (parseDate(s, '9999-12-31').issue === 'SERIAL_1899') return { issue: 'SERIAL_1899' };
    const m = /^(-?\d+(?:\.\d+)?)\s*%?$/.exec(s);
    if (!m) return { issue: 'UNREADABLE' };
    const n = Number(m[1]);
    if (n < 0) return { issue: 'OUT_OF_RANGE' };
    if (n <= 100) return { value: n };
    // The legacy pattern is four digits with two implied decimals (9475% is 94.75). Nothing else is proposed.
    if (Number.isInteger(n) && n >= 1000 && n <= 10000) return { issue: 'PERCENT_SCALED', proposed: n / 100 };
    return { issue: 'OUT_OF_RANGE' };
  }

  // "3 SMALL | 1 LARGE", "1 XLARGE (DR#700003248)". A part that cannot be read goes to issues.
  function splitUniform(cell) {
    const items = [];
    const issues = [];
    String(cell === undefined || cell === null ? '' : cell).split('|').map(tidy).filter((p) => p !== '').forEach((part) => {
      const m = /^(\d+)\s+([A-Za-z0-9]+)(?:\s*\(?\s*DR\s*#?\s*(\d+)\s*\)?)?$/i.exec(part);
      if (!m) { issues.push({ part: part, code: 'UNREADABLE' }); return; }
      const qty = Number(m[1]);
      const size = m[2].toUpperCase();
      if (SIZES.indexOf(size) < 0) { issues.push({ part: part, code: 'UNKNOWN_SIZE' }); return; }
      if (qty < 1) { issues.push({ part: part, code: 'BAD_QUANTITY' }); return; }
      const item = { qty: qty, size: size };
      if (m[3]) item.drNo = m[3];
      items.push(item);
    });
    return { items: items, issues: issues };
  }

  // RESULT is the status; STATUS holds report flags, appointment letter values and notes.
  function mapStatus(result, statusFlag) {
    const r = tidy(result).toUpperCase();
    if (r === '') return { issue: 'BLANK_STATUS' };
    if (!STATUS_MAP[r]) return { issue: 'UNKNOWN_STATUS' };
    const out = { status: STATUS_MAP[r] };
    if (r === 'DISQUALIFIED') out.closeReason = 'Disqualified';
    const f = tidy(statusFlag).toUpperCase();
    if (f !== '') {
      if (REPORT_FLAGS.indexOf(f) >= 0 || f === 'RESIGNED') out.flag = f;
      else if (APPOINTMENT.indexOf(f) >= 0) out.appointment = f;
      else out.statusIssue = 'UNKNOWN_STATUS_VALUE';
    }
    return out;
  }

  const REQUIRED = ['entry_date', 'full_name', 'mother_store', 'result'];
  const DATES = ['entry_date', 'cert_deadline', 'date_certified'];
  const GRADES = ['istv', 'techval_fp', 'techval_pm', 'exam_fp', 'exam_pm', 'entry_average', 'cert_grade', 'exam_grade', 'cert_average'];

  // rec: the raw text of one MASTER_LOG row under canonical field names. Returns the problems found, in a fixed order.
  function checkRow(rec, today) {
    const issues = [];
    const dates = {};
    REQUIRED.forEach((f) => {
      if (tidy(rec[f]) === '') issues.push({ field: f, raw: '', code: 'BLANK_REQUIRED' });
    });
    DATES.forEach((f) => {
      const p = parseDate(rec[f], today);
      dates[f] = p.iso;
      if (!p.issue) return;
      if (p.issue === 'FUTURE' && f === 'cert_deadline') return; // a deadline in the future is normal
      const issue = { field: f, raw: tidy(rec[f]), code: p.issue };
      if (p.proposed) issue.proposed = p.proposed;
      issues.push(issue);
    });
    if (dates.entry_date && dates.date_certified && dates.date_certified < dates.entry_date) {
      const issue = { field: 'date_certified', raw: tidy(rec.date_certified), code: 'CERT_BEFORE_ENTRY' };
      const swapped = swappedIso(rec.date_certified);
      if (swapped && swapped >= dates.entry_date && swapped <= today) issue.proposed = swapped;
      issues.push(issue);
    }
    GRADES.forEach((f) => {
      const g = parseGrade(rec[f]);
      if (!g.issue) return;
      const issue = { field: f, raw: tidy(rec[f]), code: g.issue };
      if (g.proposed !== undefined) issue.proposed = g.proposed;
      issues.push(issue);
    });
    return issues;
  }

  // Names with the same first and last word but a different middle part. Equal names are not duplicates.
  function findDuplicates(names) {
    const seen = new Map();
    const list = [];
    names.forEach((raw) => {
      const n = normalizeName(raw);
      if (n === '' || seen.has(n)) return;
      seen.set(n, raw);
      list.push({ raw: raw, n: n });
    });
    const groups = new Map();
    list.forEach((x) => {
      const t = x.n.split(' ');
      if (t.length < 2) return;
      const k = t[0] + '|' + t[t.length - 1];
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    });
    const out = [];
    groups.forEach((g) => {
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) out.push({ a: g[i].raw, b: g[j].raw, reason: 'MIDDLE_PART_DIFFERS' });
    });
    return out;
  }

  // FNV-1a, 8 hex digits. Used in review row keys to tell whether a source value changed.
  function hash(s) {
    let h = 0x811c9dc5;
    const str = String(s);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  return {
    normalizeName: normalizeName, matchMaster: matchMaster, matchOfficer: matchOfficer, looksLikeNote: looksLikeNote,
    parseDate: parseDate, parseGrade: parseGrade, splitUniform: splitUniform, mapStatus: mapStatus,
    checkRow: checkRow, findDuplicates: findDuplicates, hash: hash, editDistance: editDistance,
  };
})();
