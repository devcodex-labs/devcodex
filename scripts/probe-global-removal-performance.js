#!/usr/bin/env node
'use strict'

// Compare the actual pre-change and candidate inventory algorithms on the same
// owned bytes. "Cold" is a fresh inventory call, not a flushed OS page cache.
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')
const crypto = require('crypto')
const assert = require('assert')
const { execFileSync } = require('child_process')
const { performance } = require('perf_hooks')
const candidate = require('./lib/global-host-removal.js').unknownFilesInManagedRoots
const packageRoot = path.resolve(__dirname, '..')
const ref = process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11)
if (!/^[a-f0-9]{40}$/.test(ref || '')) throw new Error('--baseline=<full commit SHA> is required')
const source = execFileSync('git', ['show', `${ref}:scripts/lib/global-host-removal.js`], { cwd: packageRoot, encoding: 'utf8' })
const moduleFile = path.join(packageRoot, 'scripts/lib/global-host-removal-baseline.cjs')
const baselineModule = new Module(moduleFile, module)
baselineModule.filename = moduleFile
baselineModule.paths = Module._nodeModulePaths(path.dirname(moduleFile))
baselineModule._compile(source + '\nmodule.exports.inventory = unknownFilesInManagedRoots;\n', moduleFile)
const baseline = baselineModule.exports.inventory
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-removal-perf-'))
const evidence = { baselineRef: ref, baselineSourceDigest: crypto.createHash('sha256').update(source).digest('hex'),
  cacheDefinition: 'first and repeated filesystem access; OS cache was not flushed; no global FS cache', rounds: [] }
function instrument() {
  const counters = {}
  const observed = Object.create(fs)
  for (const name of ['existsSync', 'realpathSync', 'lstatSync', 'readdirSync']) {
    const wrap = impl => (...args) => { counters[name] = (counters[name] || 0) + 1; return impl(...args) }
    observed[name] = wrap(fs[name].bind(fs))
    if (fs[name].native) observed[name].native = wrap(fs[name].native.bind(fs))
  }
  return { observed, counters }
}
try {
  for (let round = 0; round < 3; round++) {
    const root = path.join(tmp, `round-${round}`)
    const roots = Array.from({ length: 16 }, (_, i) => path.join(root, `runtime-${i}`))
    const paths = []
    for (const generation of roots) {
      fs.mkdirSync(path.join(generation, 'assets'), { recursive: true })
      for (let i = 0; i < 40; i++) {
        const file = path.join(generation, 'assets', `${i}.txt`)
        fs.writeFileSync(file, `owned-${i}\n`); paths.push(file)
      }
    }
    const receipt = { runtimeRoot: roots[0], retainedRuntimeRoots: roots.slice(1), managedPaths: paths }
    const target = { runtimeBaseRoot: root, files: {} }
    const measurements = []
    // Alternate order so filesystem warming does not always favor candidate.
    const implementations = round % 2 ? [['candidate', candidate], ['baseline', baseline]] : [['baseline', baseline], ['candidate', candidate]]
    for (const [name, impl] of implementations) {
      for (const pass of ['first', 'repeat']) {
        const { observed, counters } = instrument()
        const started = performance.now()
        const unknown = impl(receipt, target, observed)
        const elapsedMs = performance.now() - started
        assert.deepStrictEqual(unknown, [])
        measurements.push({ name, pass, elapsedMs, counters })
      }
    }
    const unknownFile = path.join(roots[2], 'user.txt')
    fs.writeFileSync(unknownFile, 'user-owned')
    assert.deepStrictEqual(candidate(receipt, target), baseline(receipt, target))
    const candidateCalls = measurements.filter(item => item.name === 'candidate').map(item => item.counters.realpathSync)
    const baselineCalls = measurements.filter(item => item.name === 'baseline').map(item => item.counters.realpathSync)
    assert.ok(Math.max(...candidateCalls) < Math.min(...baselineCalls) / 10, 'unique-path inventory must remove repeated physical resolution')
    evidence.rounds.push({ round, files: paths.length, roots: roots.length, measurements })
  }
  evidence.status = 'PASS'
  const output = path.join(tmp, 'result.json')
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ status: 'PASS', evidence: output, rounds: evidence.rounds }))
} finally {
  if (process.env.DEVCODEX_TEST_KEEP_TEMP !== '1') fs.rmSync(tmp, { recursive: true, force: true })
}
