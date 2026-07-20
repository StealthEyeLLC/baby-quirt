/** Authentication errors. */

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class IdempotentReplay extends AuthError {
  constructor(public readonly cachedResponse: unknown) {
    super('idempotent_replay', JSON.stringify(cachedResponse));
  }
}
