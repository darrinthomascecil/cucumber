import { describe as group, expect, it } from 'vitest'
import { describe, VERSION } from '../src/lib/version'

group('version', () => {
  it('reports the package version', () => {
    expect(describe()).toBe(`cucumber ${VERSION}`)
  })
})
