'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  analyzePublicTextBuffer,
  checkPublicTextSurfaces,
  validateConfig
} = require('./lib/public-text-integrity')

const ROOT = path.resolve(__dirname, '..')
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'public-text-surfaces.json'), 'utf8'))

assert.strictEqual(validateConfig(config), config)
assert.throws(() => validateConfig({ schemaVersion: 'future', surfaces: [] }), /PublicTextSurfacesV1/)
assert.throws(() => validateConfig({ ...config, surfaces: [{ path: 'a' }, { path: 'a' }] }), /unique/)
assert.throws(
  () => validateConfig({ ...config, contaminationPatterns: [{ id: 'bad', pattern: '[' }] }),
  /invalid contamination pattern/
)

const clean = analyzePublicTextBuffer('clean.md', Buffer.from('# 标题\n正常 UTF-8 文本。\n'), config)
assert.strictEqual(clean.status, 'passed')

const invalidUtf8 = analyzePublicTextBuffer('invalid.md', Buffer.from([0xc3, 0x28]), config)
assert.strictEqual(invalidUtf8.blockers[0].ruleId, 'utf8-fatal')

const replacement = analyzePublicTextBuffer('replacement.md', Buffer.from('bad � text'), config)
assert.ok(replacement.blockers.some(item => item.ruleId === 'replacement-character'))

const contamination = analyzePublicTextBuffer('contamination.md', Buffer.from('[V59] page drift: missing heading'), config)
assert.ok(contamination.blockers.some(item => item.ruleId === 'validator-output-contamination'))

const mojibake = analyzePublicTextBuffer('mojibake.md', Buffer.from('楠岃瘉鍗敓'), config)
assert.ok(mojibake.blockers.some(item => item.ruleId === 'cjk-mojibake-cluster'))

const warning = analyzePublicTextBuffer('warning.md', Buffer.from('possibly Ã© encoded'), config)
assert.strictEqual(warning.blockers.length, 0)
assert.ok(warning.warnings.some(item => item.ruleId === 'latin-mojibake-marker'))

const allowed = analyzePublicTextBuffer('fixture.md', Buffer.from('[V59] drift: missing'), {
  ...config,
  allowlist: [{ path: 'fixture.md', ruleId: 'validator-output-contamination', line: 1 }]
})
assert.strictEqual(allowed.status, 'passed')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-public-text-'))
try {
  fs.writeFileSync(path.join(tempRoot, 'only.md'), '# clean\n')
  const missing = checkPublicTextSurfaces(tempRoot, { ...config, surfaces: [{ path: 'missing.md' }] })
  assert.ok(missing.blockers.some(item => item.ruleId === 'surface-missing'))
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

const current = checkPublicTextSurfaces(ROOT, config)
if (current.blockers.length) {
  for (const item of current.blockers) {
    process.stderr.write(`${item.path}:${item.line || 0} ${item.ruleId} ${item.excerpt}\n`)
  }
  process.exitCode = 1
} else {
  console.log(`public text integrity passed: surfaces=${current.surfaceCount} warnings=${current.warnings.length}`)
}
