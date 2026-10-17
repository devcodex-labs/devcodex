'use strict'

const assert = require('assert')
const { createReviewExecutionPlan } = require('../hooks/_runtime/review-execution-contract.cjs')
const narrow = createReviewExecutionPlan({ workflow: 'audit', stage: 'audit', userIntent: 'explicit single-file audit fixture',
  candidateDigest: 'unit-candidate', changedSet: ['document.md'], affectedClosure: ['document.md'],
  risk: { class: 'normal', flags: [] }, claims: ['contract'], dimensions: ['contract'], freshEvidence: ['unit-only'],
  staleEvidence: [], exclusions: [], auditConvergence: { explicitNarrowScope: true, scaleDecision: 'single-pass',
    crossHostControlPlane: false, multipleConsumers: false } })
const narrowSession = { convergenceMode: 'narrow-2', reviewExecutionPlan: narrow }

// Exercise the actual V15 consumer as well as the policy helper. These are
// isolated schema fixtures, not evidence that a real audit has converged.
{
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  const { buildValidateCoreChecks } = require('./lib/validate-core-checks')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-audit-convergence-'))
  const stateDir = path.join(root, '.audit-state')
  fs.mkdirSync(stateDir)
  const priorScope = process.env.DEVCODEX_VALIDATION_SCOPE
  delete process.env.DEVCODEX_VALIDATION_SCOPE
  try {
    for (const [overrides, pass] of [
      [narrowSession, true], [{}, false], [{ convergenceMode: 'narrow-2' }, false],
      [{ ...narrowSession, reviewExecutionPlan: { ...narrow, exit: { ...narrow.exit, requiredZeroFindingRounds: 1 } } }, false],
      [{ ...narrowSession, crsPassed: false }, false], [{ ...narrowSession, pcvPassed: false }, false],
      [{ ...narrowSession, zeroFindingStreak: '2' }, false],
      [{ zeroFindingStreak: 3 }, true],
      [{ ...narrowSession, findings: [{ id: 'open', status: 'open' }] }, false]
    ]) {
      const warnings = []
      const state = { schemaVersion: 'AuditSessionStateV2', sessionId: 'unit-only', state: 'converged',
        findings: [], zeroFindingStreak: 2, crsPassed: true, pcvPassed: true, ...overrides }
      fs.writeFileSync(path.join(stateDir, 'unit.json'), JSON.stringify(state))
      buildValidateCoreChecks({ ROOT: root, fs, path, activePath: relative => path.join(root, relative),
        read: file => fs.readFileSync(file, 'utf8'), warn: message => warnings.push(message), err: message => warnings.push(message) }).checkV15()
      assert.strictEqual(warnings.length === 0, pass, warnings.join('; '))
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    if (priorScope === undefined) delete process.env.DEVCODEX_VALIDATION_SCOPE
    else process.env.DEVCODEX_VALIDATION_SCOPE = priorScope
  }
}

console.log('audit convergence V15 consumer passed')

// These current consumers previously contradicted the Owner and V15. Keep the
// bounded exception explicit without making a targeted label lower the gate.
{
  const fs = require('fs'), path = require('path')
  for (const relative of ['content/prompts/report-audit.prompt.md', 'content/instructions/16-report.instructions.md',
    'content/instructions/13-analyze.instructions.md', 'content/skills/intent/SKILL.md', 'content/skills/audit-execution-guide/SKILL.md', 'content/skills/audit-common/SKILL.md',
    'content/instructions/12-audit.instructions.md', 'content/instructions.md']) {
    const body = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
    assert(body.includes('audit-session') && body.includes('narrow-2'), relative)
    assert(!/所有(?:子|审查)类型统一，不区分定向\/全面/.test(body), relative)
    assert(!/最近\s*3\s*次有效零发现/.test(body), relative)
  }
}

{
  const body = require('fs').readFileSync(require('path').join(__dirname, '../content/instructions.md'), 'utf8')
  const audit = body.split('## 审计工作流（audit）')[1].split('### 审查目标类型路由')[0]
  assert(!audit.includes('阻断项立即自我审视 + self-fix'))
  assert(audit.includes('不在当前 audit 内穿插改源'))
}
