/** Error with an HTTP status and a stable code; rendered as `{ error: { code, message, details } }` (SPEC §17). */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export const httpError = (status: number, code: string, details: Record<string, unknown> = {}) =>
  new HttpError(status, code, details);
