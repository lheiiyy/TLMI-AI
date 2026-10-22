// Checks input against a table definition from Schema. Pure: no I/O.
const Validator = {
  DEFAULT_MAX: 50000,

  // mode: 'create' (required fields must be present) or 'patch' (an absent field is unchanged, null clears an optional field).
  clean(def, input, mode) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw Errors.validation([{ path: '', code: 'TYPE', message: 'An object is expected.' }]);
    }
    const errs = [];
    const out = {};
    Object.keys(input).forEach((key) => {
      const spec = def.fields[key];
      if (!spec) { errs.push({ path: key, code: 'UNKNOWN_FIELD', message: 'Unknown field.' }); return; }
      if (mode === 'patch' && spec.immutable) { errs.push({ path: key, code: 'IMMUTABLE', message: 'This field cannot be changed.' }); return; }
      let v = input[key];
      if (v === undefined) return;
      if (v === null) {
        if (spec.required) errs.push({ path: key, code: 'REQUIRED', message: 'A value is required.' });
        else out[key] = null;
        return;
      }
      const r = Validator._value(spec, v);
      if (r.err) errs.push({ path: key, code: r.err, message: r.msg });
      else if (spec.required && r.value === '') errs.push({ path: key, code: 'REQUIRED', message: 'A value is required.' });
      else out[key] = r.value;
    });
    if (mode === 'create') {
      Object.keys(def.fields).forEach((key) => {
        if (def.fields[key].required && out[key] === undefined && !errs.some((e) => e.path === key)) {
          errs.push({ path: key, code: 'REQUIRED', message: 'A value is required.' });
        }
      });
    }
    if (errs.length) throw Errors.validation(errs);
    return out;
  },

  _value(spec, v) {
    const max = spec.max || Validator.DEFAULT_MAX;
    switch (spec.type) {
      case 'text': {
        if (typeof v !== 'string') return { err: 'TYPE', msg: 'Text is expected.' };
        const t = v.trim();
        if (t.length > max) return { err: 'TOO_LONG', msg: 'At most ' + max + ' characters.' };
        if (spec.enum && t !== '' && spec.enum.indexOf(t) < 0) return { err: 'NOT_ALLOWED', msg: 'Not an allowed value.' };
        if (spec.pattern && t !== '' && !spec.pattern.test(t)) return { err: 'PATTERN', msg: spec.patternMessage || 'Not in the expected format.' };
        return { value: t };
      }
      case 'json': {
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        if (s.length > max) return { err: 'TOO_LONG', msg: 'At most ' + max + ' characters.' };
        return { value: s };
      }
      case 'object':
        return (v !== null && typeof v === 'object' && !Array.isArray(v)) ? { value: v } : { err: 'TYPE', msg: 'An object is expected.' };
      case 'int':
        return Number.isInteger(v) ? { value: v } : { err: 'TYPE', msg: 'A whole number is expected.' };
      case 'number':
        return (typeof v === 'number' && isFinite(v)) ? { value: v } : { err: 'TYPE', msg: 'A number is expected.' };
      case 'bool':
        return typeof v === 'boolean' ? { value: v } : { err: 'TYPE', msg: 'true or false is expected.' };
      case 'date':
        return (typeof v === 'string' && Validator._isDate(v)) ? { value: v } : { err: 'TYPE', msg: 'A date as yyyy-mm-dd is expected.' };
      case 'timestamp':
        return (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v))
          ? { value: v } : { err: 'TYPE', msg: 'An ISO 8601 UTC timestamp is expected.' };
      default:
        return { err: 'TYPE', msg: 'Unsupported field type.' };
    }
  },

  _isDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1) return false;
    const days = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= days[mo - 1];
  },
};
