// The pure Team Leader rules (Phase 2 spec section 7): the deadline, the rounding, the grades in force, the entry check,
// the final grade, the transition table and the overdue flag. No I/O, no Google services, no clock, no Date object:
// dates are yyyy-mm-dd text and the calendar arithmetic is done by hand.
const TlRules = (function () {
  const OPEN = ['Entry', 'Probationary', 'Certification check', 'Extended'];
  const SUPERVISOR_UP = ['Training Supervisor', 'Training Manager', 'Senior Training Manager'];
  const OFFICER_ACTION_ROLES = ['Training Officer', 'Training Supervisor', 'Training Manager', 'Senior Training Manager', 'Admin'];

  function isLeap(y) { return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0); }
  function daysIn(y, m) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
  function pad(n, w) { return String(n).padStart(w, '0'); }
  function parts(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }
  function text(y, m, d) { return pad(y, 4) + '-' + pad(m, 2) + '-' + pad(d, 2); }

  // Days since 1970-01-01 for a civil date, and back (proleptic Gregorian, no Date object).
  function toDays(y, m, d) {
    const yy = m <= 2 ? y - 1 : y;
    const era = Math.floor(yy / 400);
    const yoe = yy - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }
  function fromDays(z0) {
    const z = z0 + 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const m = mp < 10 ? mp + 3 : mp - 9;
    const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
    return { y: y, m: m, d: d };
  }

  // Entry date + months; when the day does not exist in the target month, the last day of that month (spec 7.1).
  function deadline(entryDateIso, months) {
    const p = parts(entryDateIso);
    const total = p.y * 12 + (p.m - 1) + months;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    return text(y, m, Math.min(p.d, daysIn(y, m)));
  }

  function addDays(iso, days) {
    const p = parts(iso);
    const q = fromDays(toDays(p.y, p.m, p.d) + days);
    return text(q.y, q.m, q.d);
  }

  // Half up to 2 decimals (P2-5). The product is cut to 12 significant digits first, so 84.995 x 100 is 8499.5 and not 8499.499999.
  function round2(n) {
    return Math.round(Number((n * 100).toPrecision(12))) / 100;
  }

  // Assessment rows that no other row supersedes (TDMS D072).
  function inForce(rows) {
    const replaced = new Set();
    rows.forEach((r) => { if (r.supersedes_id) replaced.add(r.supersedes_id); });
    return rows.filter((r) => !replaced.has(r.id));
  }

  // The entry check (spec 7.2). The average is the mean of the required components' grades, rounded, and only once all are in.
  function entryState(requiredComponentIds, gradesInForce) {
    const byComponent = {};
    gradesInForce.forEach((g) => { byComponent[g.component_id] = g.score; });
    const missing = requiredComponentIds.filter((id) => byComponent[id] === undefined);
    const complete = missing.length === 0;
    let average = null;
    if (complete && requiredComponentIds.length > 0) {
      const sum = requiredComponentIds.reduce((a, id) => a + byComponent[id], 0);
      average = round2(sum / requiredComponentIds.length);
    }
    return { complete: complete, missing: missing, average: average };
  }

  // The final grade (spec 7.3, P2-4, P2-5). scores: { checklist, exam, kitchen?, manager? }; weights: { cert: [wc, we, wf], feedback: [wk, wm] }.
  function finalGrade(scores, weights) {
    const hasK = scores.kitchen !== undefined && scores.kitchen !== null;
    const hasM = scores.manager !== undefined && scores.manager !== null;
    let feedback;
    if (hasK && hasM) feedback = (weights.feedback[0] * scores.kitchen + weights.feedback[1] * scores.manager) / 100;
    else if (hasK) feedback = scores.kitchen;
    else if (hasM) feedback = scores.manager;
    else throw new Error('At least one feedback score is needed.');
    const c = weights.cert;
    return round2((c[0] * scores.checklist + c[1] * scores.exam + c[2] * feedback) / 100);
  }

  function blocked(ruleId, message) { return { ok: false, code: 'BLOCKED_BY_RULE', rule_id: ruleId, message: message }; }
  function forbidden() { return { ok: false, code: 'FORBIDDEN', message: 'You are not allowed to do this.' }; }

  // facts: { entryComplete, finalGrade, passMark, extensionsUsed, extensionLimit, courseGrade, coursePassMark }
  function courseOk(f) {
    if (f.courseGrade === null || f.courseGrade === undefined) return false;
    if (f.coursePassMark === null || f.coursePassMark === undefined) return true; // safety net (spec 7.5)
    return f.courseGrade >= f.coursePassMark;
  }
  function courseBelow(f) {
    return f.courseGrade !== null && f.courseGrade !== undefined
      && f.coursePassMark !== null && f.coursePassMark !== undefined && f.courseGrade < f.coursePassMark;
  }

  // The transition table of spec 7.12 and the role column of spec 6. Role first (FORBIDDEN), then the state, then the facts.
  function decide(action, status, role, facts) {
    const f = facts || {};
    if ((action === 'returnToProbation' || action === 'promote') && SUPERVISOR_UP.indexOf(role) < 0) return forbidden();
    if (OFFICER_ACTION_ROLES.indexOf(role) < 0) return forbidden();
    const open = OPEN.indexOf(status) >= 0;
    const noState = () => blocked('WF-002', 'This action is not allowed from the status ' + status + '.');
    switch (action) {
      case 'recordEntryGrade':
        return open ? { ok: true } : noState();
      case 'recordCertCheck':
        if (status === 'Entry') return blocked('RULE-101', 'Every required entry grade must be recorded first.');
        if (['Probationary', 'Certification check', 'Extended'].indexOf(status) < 0) return noState();
        return f.entryComplete === false ? blocked('RULE-101', 'Every required entry grade must be recorded first.') : { ok: true };
      case 'certify':
        if (status !== 'Certification check') return noState();
        if (!(f.finalGrade >= f.passMark)) return blocked('RULE-102', 'The final grade is below the pass mark.');
        if (f.courseGrade === null || f.courseGrade === undefined) return blocked('RULE-102', 'The TL course program grade is not recorded.');
        if (!courseOk(f)) return blocked('RULE-102', 'The TL course program grade is below the course pass mark.');
        return { ok: true };
      case 'extend': {
        if (status !== 'Certification check') return noState();
        const failing = f.finalGrade < f.passMark || courseBelow(f);
        if (!failing) return blocked('RULE-104', 'The grades pass, so the record is certified, not extended.');
        if (f.extensionLimit === null || f.extensionLimit === undefined) {
          return { ok: false, code: 'CONFIG_MISSING', rule_id: 'RULE-104', key: 'CFG-047', message: 'The extension limit is not set.' };
        }
        if (f.extensionsUsed >= f.extensionLimit) return blocked('RULE-104', 'The extension limit is reached.');
        return { ok: true };
      }
      case 'close':
        return ['Certification check', 'Extended'].indexOf(status) >= 0 ? { ok: true } : noState();
      case 'quit':
        return open ? { ok: true } : noState();
      case 'returnToProbation':
        return ['Certification check', 'Extended'].indexOf(status) >= 0 ? { ok: true } : noState();
      case 'promote':
        return status === 'Certified' ? { ok: true } : noState();
      default:
        throw new Error('Unknown action: ' + action);
    }
  }

  function overdue(status, deadlineIso, todayIso) {
    return OPEN.indexOf(status) >= 0 && !!deadlineIso && deadlineIso < todayIso;
  }

  return {
    deadline: deadline, addDays: addDays, round2: round2, inForce: inForce, entryState: entryState, finalGrade: finalGrade,
    decide: decide, overdue: overdue, OPEN: OPEN, SUPERVISOR_UP: SUPERVISOR_UP,
  };
})();
