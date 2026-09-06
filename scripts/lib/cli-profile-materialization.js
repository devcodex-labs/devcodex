'use strict'

const crypto = require('crypto')
const path = require('path')
const { spawnSync } = require('child_process')
const { materializeProfileDraft } = require('./profile-materialization-v1.js')
const { lifecycleForProfile } = require('../../hooks/_runtime/profile-availability-v1.cjs')

function validateMaterializedProfile(profileRoot, projectRoot) {
  const validator = path.join(__dirname, '..', 'validate-profile.js')
  const result = spawnSync(process.execPath, [
    validator,
    '--profile-dir', profileRoot,
    '--project-root', projectRoot
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.env
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  const accepted = result.status === 0 || result.status === 2
  return {
    ok: accepted,
    status: result.status,
    validator: 'scripts/validate-profile.js',
    errors: accepted ? [] : [output || `profile validator exited ${result.status ?? 'without status'}`],
    warnings: result.status === 2 ? [output || 'profile validator warnings'] : [],
    outputDigest: crypto.createHash('sha256').update(output).digest('hex')
  }
}

function materializeMissingProfile(input = {}) {
  const context = input.context || {}
  const runtimeOptions = input.runtimeOptions || {}
  const generators = input.generators || {}
  const contents = Object.fromEntries(
    (Array.isArray(input.actions) ? input.actions : [])
      .filter(item => item.action === 'generate')
      .map(item => [item.file, generators[item.file]()])
  )
  return materializeProfileDraft({
    projectIdentity: runtimeOptions.projectIdentity || path.basename(input.projectRoot),
    projectRoot: input.projectRoot,
    runtimeRoot: runtimeOptions.runtimeRoot || path.dirname(input.profileRoot),
    profileRoot: input.profileRoot,
    sourceScan: {
      packageName: context.pkg?.name || null,
      packageVersion: context.pkg?.version || null,
      branch: context.branch,
      architecture: context.arch,
      tree: context.tree,
      style: context.style,
      hasServices: context.hasServices
    },
    tier: input.tier,
    templateVersion: 'profile-bootstrap-v1',
    generatorVersion: input.generatorVersion,
    actions: input.actions,
    contents,
    dryRun: input.dryRun,
    operationId: runtimeOptions.operationId,
    faultAt: runtimeOptions.faultAt
  }, {
    beforeCommit: runtimeOptions.beforeCommit,
    validateProfile: validateMaterializedProfile
  })
}

function profileLifecycleForCli(profileRoot, fsImpl) {
  return fsImpl.existsSync(profileRoot)
    ? lifecycleForProfile(profileRoot)
    : { status: null, legacyUnclassified: false }
}

module.exports = {
  materializeMissingProfile,
  profileLifecycleForCli,
  validateMaterializedProfile
}
