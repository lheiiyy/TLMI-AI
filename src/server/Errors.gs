// Errors returned to the browser as data (spec section 4). Codes are the TDMS API-CONTRACT codes.
class AppError extends Error {
  constructor(code, message, extra) {
    super(message || code);
    this.name = 'AppError';
    this.code = code;
    if (extra) Object.keys(extra).forEach((k) => { this[k] = extra[k]; });
  }
}

const Errors = {
  validation(fields) { return new AppError('VALIDATION', 'The request has invalid values.', { fields: fields }); },
  forbidden(msg) { return new AppError('FORBIDDEN', msg || 'You are not allowed to do this.'); },
  notFound(msg) { return new AppError('NOT_FOUND', msg || 'Not found.'); },
  conflict(current) { return new AppError('CONFLICT', 'The record was changed by someone else.', { current: current }); },
  busy(retryAfter) { return new AppError('BUSY', 'The system is busy. Try again.', { retry_after: retryAfter || 5 }); },
  configMissing(key) { return new AppError('CONFIG_MISSING', 'A setting is not configured: ' + key); },
};
