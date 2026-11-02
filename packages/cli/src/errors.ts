/** Ends a command with a specific exit code (message already printed). */
export class ExitError extends Error {
  constructor(public code: number, message = "") {
    super(message);
  }
}
