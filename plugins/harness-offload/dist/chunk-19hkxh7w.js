// src/errors.ts
class ExitError extends Error {
  code;
  constructor(code, message = "") {
    super(message);
    this.code = code;
  }
}

export { ExitError };
