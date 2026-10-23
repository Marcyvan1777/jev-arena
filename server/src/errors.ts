export class PublicError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.name = 'PublicError'; this.status = status; }
}

/**
 * The model answered, but not with a usable move (an action that is not legal right now, malformed JSON, a bad probability table).
 * Unlike a network or credential failure this does not stop the bout: the referee makes that boxer guard for the exchange.
 */
export class IllegalMoveError extends PublicError {
  readonly attempted: string;
  constructor(message: string, attempted: string) { super(message, 502); this.name = 'IllegalMoveError'; this.attempted = attempted.slice(0, 40); }
}
