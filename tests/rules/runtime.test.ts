import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The server and the tools run straight from TypeScript source, with Node
 * stripping the types rather than compiling them. Stripping cannot handle
 * every construct tsc accepts — constructor parameter properties are the one
 * that keeps catching us out — and the failure only appears at runtime, in a
 * process that has already started. So check it here instead.
 */
const ROOT = new URL('../..', import.meta.url).pathname

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sources(full, found)
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) found.push(full)
  }
  return found
}

describe('every source file survives Node type stripping', () => {
  const files = [
    ...sources(join(ROOT, 'packages')),
    ...sources(join(ROOT, 'apps/server/src')),
    ...sources(join(ROOT, 'tools')),
  ]

  it('finds files to check', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('parses each one the way Node will', () => {
    const broken: string[] = []
    for (const file of files) {
      try {
        execFileSync(process.execPath, ['--experimental-strip-types', '--check', file], {
          stdio: 'pipe',
        })
      } catch (error) {
        const message = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error)
        broken.push(`${file.replace(ROOT, '')}: ${message.split('\n').find((l) => l.includes('Error')) ?? 'failed'}`)
      }
    }
    expect(broken).toEqual([])
  }, 120_000)
})
