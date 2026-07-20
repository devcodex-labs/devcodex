'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  analyzePublicTextBuffer,
  checkPublicTextSurfaces,
  collectConfiguredSurfaces,
  validateConfig
} = require('./lib/public-text-integrity')

const ROOT = path.resolve(__dirname, '..')
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'public-text-surfaces.json'), 'utf8'))

assert.strictEqual(validateConfig(config), config)
assert.throws(() => validateConfig({ schemaVersion: 'future', surfaces: [] }), /PublicTextSurfacesV1/)
assert.throws(() => validateConfig({ ...config, surfaces: [{ path: 'a' }, { path: 'a' }] }), /unique/)
assert.throws(() => validateConfig({ ...config, surfaces: [{ path: '../outside.md' }] }), /safe relative/)
assert.throws(() => validateConfig({ ...config, roots: [{ path: 'skills' }] }), /extensions or fileNames/)
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

const privateUse = analyzePublicTextBuffer('private-use.md', Buffer.from('bad \uE044 text'), config)
assert.ok(privateUse.blockers.some(item => item.ruleId === 'private-use-character'))

const contamination = analyzePublicTextBuffer('contamination.md', Buffer.from('[V59] page drift: missing heading'), config)
assert.ok(contamination.blockers.some(item => item.ruleId === 'validator-output-contamination'))

const traditionalChinese = analyzePublicTextBuffer('traditional.md', Buffer.from('區塊鏈技術、供應鏈管理、鏈路追蹤都是合法中文。'), config)
assert.strictEqual(traditionalChinese.blockers.length, 0)

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

  fs.mkdirSync(path.join(tempRoot, 'skills', 'nested'), { recursive: true })
  fs.writeFileSync(path.join(tempRoot, 'skills', 'nested', 'SKILL.md'), '[V67] consumer drift: missing anchor\n')
  fs.writeFileSync(path.join(tempRoot, 'skills', 'nested', 'ignored.txt'), '\uE044\n')
  const rootConfig = {
    ...config,
    surfaces: [{ path: 'only.md' }],
    roots: [{ path: 'skills', fileNames: ['SKILL.md'] }]
  }
  const collected = collectConfiguredSurfaces(tempRoot, rootConfig)
  assert.deepStrictEqual(collected.map(item => item.path), ['only.md', 'skills/nested/SKILL.md'])
  const rooted = checkPublicTextSurfaces(tempRoot, rootConfig)
  assert.ok(rooted.blockers.some(item => item.path === 'skills/nested/SKILL.md' && item.ruleId === 'validator-output-contamination'))
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

const current = checkPublicTextSurfaces(ROOT, config)
assert.ok(current.surfaceCount > config.surfaces.length, 'normative/public root expansion must be active')
assert.ok(!current.results.some(item => item.path.startsWith('website/docs/versions/')), 'historical version docs must not be current public-text surfaces')
assert.ok(!current.results.some(item => item.path.startsWith('changelogs/releases/')), 'historical release notes must not be current public-text surfaces')
if (current.blockers.length) {
  for (const item of current.blockers) {
    process.stderr.write(`${item.path}:${item.line || 0} ${item.ruleId} ${item.excerpt}\n`)
  }
  process.exitCode = 1
} else {
  console.log(`public text integrity passed: surfaces=${current.surfaceCount} warnings=${current.warnings.length}`)
}
