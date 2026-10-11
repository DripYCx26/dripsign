export const DOMAIN_ERROR_CODES = [
  "not_found",
  "conflict",
  "invalid",
  "rate_limited",
  "verification_required",
  "unavailable",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/**
 * The only error the domain raises on purpose. Forbidden access is reported as `not_found`
 * so callers cannot probe for resources they may not see.
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DomainError";
    this.code = code;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function notFound(): DomainError {
  return new DomainError("not_found", "This agreement isn’t available.");
}
