/** Deterministic RNG so a self-play run can be replayed exactly. */
export interface Random {
  next(): number
  int(maxExclusive: number): number
}

export function xorshift(seed: number): Random {
  let state = seed >>> 0 || 0x9e3779b9
  const next = () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x100000000
  }
  return { next, int: (maxExclusive: number) => Math.floor(next() * maxExclusive) % maxExclusive }
}
