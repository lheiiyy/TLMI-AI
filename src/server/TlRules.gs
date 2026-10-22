// The Team Leader rules (Phase 2 spec section 7): the deadline, the entry check, the final grade and the transition table.
// Pure functions: no I/O, no Google services, no clock (today is passed in). TlService reads and writes; this file decides.
const TlRules = (function () {
  const S = {
    ENTRY: 'Entry', PROBATION: 'Probationary', CHECK: 'Certification check', CERTIFIED: 'Certified', EXTENDED: 'Extended',
    FAILED: 'Failed', QUIT: 'Quit', PROMOTED: 'Promoted',
  };
  const OPEN = [S.ENTRY, S.PROBATION, S.CHECK, S.EXTENDED];

  // The actions of spec section 7.12, and who may do them. Admin does every officer action (P2-6) but neither promotes
  // nor returns to probation.
  const OFFICER_ROLES = ['Training Officer', 'Training Supervisor', 'Training Manager', 'Senior Training Manager', 'Admin'];
  const SENIOR_ROLES = ['Training Supervisor', 'Training Manager', 'Senior Training Manager'];
  const ACTIONS = {
    recordEntryGrade: OFFICER_ROLES, recordCertCheck: OFFICER_ROLES, certify: OFFICER_ROLES, extend: OFFICER_ROLES,
    close: OFFICER_ROLES, quit: OFFICER_ROLES, returnToProbation: SENIOR_ROLES, promote: SENIOR_ROLES,
  };

  // The statuses each action may start from (spec 7.12). The conditions inside a status are in decide().
  const FROM = {
    recordEntryGrade: [S.ENTRY, S.PROBATION, S.CHECK, S.EXTENDED],
    recordCertCheck: [S.PROBATION, S.CHECK, S.EXTENDED],
    certify: [S.CHECK],
    extend: [S.CHECK],
    close: [S.CHECK, S.EXTENDED],
    quit: OPEN,
    returnToProbation: [S.CHECK, S.EXTENDED],
    promote: [S.CERTIFIED],
  };

  // The rule that blocks an action that is not allowed from the current status (TDMS WF-002: one stage at a time).
  const STATE_RULE = {
    recordEntryGrade: 'WF-002', recordCertCheck: 'WF-002', certify: 'WF-002', extend: 'WF-002', close: 'WF-002',
    quit: 'RULE-105', returnToProbation: 'WF-002', promote: 'RULE-106',
  };

  const pad = (n, w) => String(n).padStart(w, '0');

  function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    const p = m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
    if (!p || p.m < 1 || p.m > 12 || p.d < 1 || p.d > daysInMonth(p.y, p.m)) throw new Error('A date as yyyy-mm-dd is expected.');
    return p;
  }

  function daysInMonth(y, m) {
    return [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  // The entry date plus `months` calendar months. When the day does not exist in the target month, the last day of that
  // month is used (30 Nov + 3 months = 28 or 29 Feb).
  function deadline(entryDateIso, months) {
    const p = parseIso(entryDateIso);
    const total = p.y * 12 + (p.m - 1) + months;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    return pad(y, 4) + '-' + pad(m, 2) + '-' + pad(Math.min(p.d, daysInMonth(y, m)), 2);
  }

  // The date plus a number of days (the extension, CFG-042), without the clock or the local time zone.
  function addDays(iso, days) {
    const p = parseIso(iso);
    let y = p.y, m = p.m, d = p.d + days;
    while (d > daysInMonth(y, m)) { d -= daysInMonth(y, m); m += 1; if (m > 12) { m = 1; y += 1; } }
    while (d < 1) { m -= 1; if (m < 1) { m = 12; y -= 1; } d += daysInMonth(y, m); }
    return pad(y, 4) + '-' + pad(m, 2) + '-' + pad(d, 2);
  }

  // Half up to 2 decimals (P2-5). The product is rounded to 12 significant digits first, so that 84.995 (which a binary
  // number holds as 84.99499999...) rounds to 85.
  function round2(n) {
    return Math.round(Number((n * 100).toPrecision(12))) / 100;
  }

  // The assessment rows that no other row supersedes (TDMS D072).
  function inForce(rows) {
    const replaced = new Set(rows.map((r) => r.supersedes_id).filter((x) => x));
    return rows.filter((r) => !replaced.has(r.id));
  }

  // The entry check (RULE-101): complete when every required component has a grade in force. The average is the mean of
  // the grades in force for the required components, to 2 decimals, or null when there is none. It is computed on read.
  function entryState(requiredComponentIds, gradesInForce) {
    const byComp = {};
    gradesInForce.forEach((g) => { byComp[g.component_id] = g; });
    const missing = requiredComponentIds.filter((id) => !byComp[id]);
    const scores = requiredComponentIds.filter((id) => byComp[id]).map((id) => byComp[id].score);
    return {
      complete: missing.length === 0,
      missing: missing,
      average: scores.length ? round2(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    };
  }

  // The feedback part: both forms weigh kitchen and manager (CFG-045); with one form, that score alone (P2-4).
  function feedback(kitchen, manager, wk, wm) {
    const hasK = kitchen !== undefined && kitchen !== null;
    const hasM = manager !== undefined && manager !== null;
    if (hasK && hasM) return (wk * kitchen + wm * manager) / (wk + wm);
    if (hasK) return kitchen;
    if (hasM) return manager;
    return null;
  }

  // final = (w_checklist x checklist + w_exam x exam + w_feedback x feedback) / 100, rounded half up (RULE-102).
  function finalGrade(scores, weights) {
    const fb = feedback(scores.kitchen, scores.manager, weights.feedback[0], weights.feedback[1]);
    if (fb === null) throw new Error('At least one feedback score is required.');
    const wc = weights.cert;
    return round2((wc[0] * scores.checklist + wc[1] * scores.exam + wc[2] * fb) / 100);
  }

  // Overdue: an open status and a deadline before today (RULE-109).
  function overdue(status, deadlineIso, today) {
    return OPEN.indexOf(status) >= 0 && !!deadlineIso && deadlineIso < today;
  }

  function blocked(rule, message) { return { ok: false, code: 'BLOCKED_BY_RULE', rule_id: rule, message: message }; }

  // Whether `role` may do `action` on a record in `status`, with these facts:
  //   { entryComplete, finalGrade, passMark, extensionsUsed, extensionLimit, courseGrade, coursePassMark }
  // Returns { ok: true } or { ok: false, code, rule_id?, message }. The role is checked first (FORBIDDEN), then the status
  // (BLOCKED_BY_RULE), then the conditions. Unset limits are CONFIG_MISSING with the key.
  function decide(action, status, role, facts) {
    const f = facts || {};
    if (!ACTIONS[action]) throw new Error('Unknown action: ' + action);
    if (ACTIONS[action].indexOf(role) < 0) return { ok: false, code: 'FORBIDDEN', message: 'You are not allowed to do this.' };
    if (FROM[action].indexOf(status) < 0) {
      if (action === 'recordCertCheck' && status === S.ENTRY) return blocked('RULE-101', 'All required entry grades must be recorded first.');
      return blocked(STATE_RULE[action], 'This cannot be done while the status is ' + status + '.');
    }
    if (action === 'recordCertCheck' && !f.entryComplete) return blocked('RULE-101', 'All required entry grades must be recorded first.');
    const hasCourse = f.courseGrade !== undefined && f.courseGrade !== null;
    const courseOk = hasCourse && (f.coursePassMark === undefined || f.coursePassMark === null || f.courseGrade >= f.coursePassMark);
    const finalOk = f.finalGrade !== undefined && f.finalGrade !== null && f.passMark !== undefined && f.passMark !== null && f.finalGrade >= f.passMark;
    if (action === 'certify') {
      if (f.passMark === undefined || f.passMark === null) return { ok: false, code: 'CONFIG_MISSING', key: 'CFG-041', message: 'The certification pass mark is not set.' };
      if (!finalOk) return blocked('RULE-102', 'The final grade is below the pass mark.');
      if (!hasCourse) return blocked('RULE-102', 'The TL course program grade is not recorded.');
      if (!courseOk) return blocked('RULE-102', 'The TL course program grade is below its pass mark.');
    }
    if (action === 'extend') {
      // Interim X-4: extend when the final is below the pass mark or the course grade is below its pass mark.
      if (f.extensionLimit === undefined || f.extensionLimit === null) return { ok: false, code: 'CONFIG_MISSING', key: 'CFG-047', message: 'The extension limit is not set.' };
      if (finalOk && courseOk) return blocked('RULE-104', 'The grades pass, so the record is certified, not extended.');
      if ((f.extensionsUsed || 0) >= f.extensionLimit) return blocked('RULE-104', 'The extension limit is reached.');
    }
    return { ok: true };
  }

  // The actions that decide() allows for a role and status, for the screens (allowed_actions).
  function allowedActions(status, role, facts) {
    return Object.keys(ACTIONS).filter((a) => decide(a, status, role, facts).ok);
  }

  return {
    STATUS: S, OPEN: OPEN, ACTIONS: ACTIONS, FROM: FROM,
    deadline: deadline, addDays: addDays, round2: round2, inForce: inForce, entryState: entryState, finalGrade: finalGrade,
    feedback: feedback, overdue: overdue, decide: decide, allowedActions: allowedActions,
  };
})();
