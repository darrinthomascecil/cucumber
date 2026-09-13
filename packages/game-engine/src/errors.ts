/** Every rule rejection the engine can produce. Carries a stable code so the
 *  transport layer can forward it without re-deriving the reason. */
export class IllegalMoveError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'IllegalMoveError'
  }
}

export function illegal(code: string, message: string): never {
  throw new IllegalMoveError(code, message)
}
