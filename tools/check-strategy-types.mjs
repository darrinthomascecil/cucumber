import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const compiler = process.env.TYPESCRIPT_PATH
if (!compiler) throw new Error('Set TYPESCRIPT_PATH to an installed typescript.js; no package download is needed')
const ts = require(resolve(compiler))
const root = resolve('.')
const files = ['game-engine', 'strategy'].flatMap((name) => ts.sys.readDirectory(resolve(root, `packages/${name}/src`), ['.ts']))
const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noUncheckedIndexedAccess: true,
  noEmit: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  types: [],
  paths: Object.fromEntries(['shared', 'game-engine', 'strategy'].map((name) => [`@cucumber/${name}`, [resolve(root, `packages/${name}/src/index.ts`)]])),
}
const program = ts.createProgram(files, options)
const diagnostics = ts.getPreEmitDiagnostics(program)
const host = { getCurrentDirectory: () => root, getCanonicalFileName: (file) => file, getNewLine: () => '\n' }
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host))
  process.exitCode = 1
} else console.log(`STRATEGY_TYPES_PASS: ${files.length} engine/strategy files checked with TypeScript ${ts.version}`)