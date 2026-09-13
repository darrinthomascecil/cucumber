/** Every rule rejection the engine can produce. Carries a stable code so the
 *  transport layer can forward it without re-deriving the reason. */
export class IllegalMoveError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'IllegalMoveError'
    this.code = code
  }
}

export function illegal(code: string, message: string): never {
  throw new IllegalMoveError(code, message)
}
