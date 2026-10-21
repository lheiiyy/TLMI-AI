// Password rule FX-002 (TDMS CONFIGURATION). Pure: no I/O. A password is never written to a log, an audit row or a message.
const PasswordRules = {
  MIN_LENGTH: 8,

  // newPassword: at least 8 characters, at least one letter and one digit, and not equal to the current password.
  // Returns { ok: true } or { ok: false, code } with one of TOO_SHORT, NEEDS_LETTER, NEEDS_DIGIT, SAME_AS_CURRENT.
  check(newPassword, currentPassword) {
    const p = typeof newPassword === 'string' ? newPassword : '';
    if (p.length < PasswordRules.MIN_LENGTH) return { ok: false, code: 'TOO_SHORT' };
    if (!/[A-Za-z]/.test(p)) return { ok: false, code: 'NEEDS_LETTER' };
    if (!/[0-9]/.test(p)) return { ok: false, code: 'NEEDS_DIGIT' };
    if (typeof currentPassword === 'string' && currentPassword !== '' && p === currentPassword) return { ok: false, code: 'SAME_AS_CURRENT' };
    return { ok: true };
  },

  MESSAGES: {
    TOO_SHORT: 'Use at least 8 characters.',
    NEEDS_LETTER: 'Use at least one letter.',
    NEEDS_DIGIT: 'Use at least one digit.',
    SAME_AS_CURRENT: 'The new password must be different from the current one.',
  },

  // The rule as a validation error for the field `path`, or null when the password passes.
  error(path, newPassword, currentPassword) {
    const r = PasswordRules.check(newPassword, currentPassword);
    return r.ok ? null : Errors.validation([{ path: path, code: r.code, message: PasswordRules.MESSAGES[r.code] }]);
  },
};
