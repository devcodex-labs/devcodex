'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  commitTaskRecoveryState,
  readTaskRecoveryState,
  writeStableProjection
} = require('../../hooks/_runtime/task-recovery-store-v5.cjs')

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

function resolveFixtureGlobalRuntime (packageRoot = PACKAGE_ROOT) {
  const skillRoots = [
    path.join(packageRoot, 'content', 'skills'),
    path.join(packageRoot, 'skills')
  ]
  const root = skillRoots.find(candidate => fs.existsSync(path.join(candidate, 'portfolio.json')))
  if (!root) {
    const error = new Error('SKILL_ROUTE_FIXTURE_PORTFOLIO_MISSING')
    error.code = 'SKILL_ROUTE_FIXTURE_PORTFOLIO_MISSING'
    error.candidates = skillRoots
    throw error
  }
  return {
    status: 'resolved',
    root,
    companionRoot: root,
    portfolioPath: path.join(root, 'portfolio.json')
  }
}

function writeJson (file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeWorkspaceSkill (root, skillId, suffix = '') {
  const skillRoot = path.join(root, '.devcodex', 'workspace', 'skills', skillId)
  fs.mkdirSync(skillRoot, { recursive: true })
  fs.writeFileSync(
    path.join(skillRoot, 'SKILL.md'),
    [
      '---',
      `name: ${skillId}`,
      `description: Handle the isolated workspace routing probe${suffix}.`,
      '---',
      `# ${skillId}`,
      '',
      `WORKSPACE_ROUTE_BODY_${skillId}${suffix}`
    ].join('\n'),
    'utf8'
  )
  writeJson(path.join(skillRoot, 'intent.json'), {
    schemaVersion: 'SkillIntentV1',
    skillId,
    intents: [{
      id: 'workspace-probe',
      label: 'Workspace route probe',
      include: ['workspace', 'probe']
    }],
    examples: {
      positive: ['Run the workspace route probe', 'Use the isolated workspace skill'],
      negative: ['Review a release', 'Write a user manual']
    },
    summary: 'Use for the isolated workspace routing integration probe.'
  })
  return skillRoot
}

function writeContextBindingState (
  fixture,
  contextEpoch,
  finalIntent = 'dev',
  hostSessionId = `session-${contextEpoch}`,
  identitySuffix = ''
) {
  const planId = `plan-${contextEpoch}${identitySuffix}`
  const planContentId = `content-${contextEpoch}${identitySuffix}`
  const receiptId = `receipt-${contextEpoch}${identitySuffix}`
  const statePath = path.join(
    fixture.activeRoot,
    '.memory',
    'hooks',
    fixture.project,
    'lifecycle-state.json'
  )
  const metaDir = path.dirname(statePath)
  const existing = readTaskRecoveryState({
    metaDir,
    sessionKey: hostSessionId,
    expectedIdentity: {
      activeRoot: fixture.activeRoot,
      project: fixture.project
    }
  })
  const state = ['fresh', 'ephemeral-stub'].includes(existing.status)
    ? JSON.parse(JSON.stringify(existing.state || {}))
    : {}
  state.contextAcquisition = {
    ...(state.contextAcquisition || {}),
    contextEpoch,
    activeRoot: fixture.activeRoot.replace(/\\/g, '/'),
    project: fixture.project,
    targetResolved: true,
    hostSessionId,
    plan: {
        schemaVersion: 'ContextReadPlanV2',
        planId,
        planContentId,
        identity: {
          contextEpoch,
          finalIntent
        },
        changeTypes: [],
        selectedSources: [],
        mandatorySourceIds: []
    },
    receipt: {
        schemaVersion: 'ContextReadReceiptV2',
        receiptId,
        contextEpoch,
        planId,
        planContentId,
        status: 'relevant-complete'
    }
  }
  writeStableProjection(statePath, state)
  if (['fresh', 'ephemeral-stub'].includes(existing.status)) {
    const commit = commitTaskRecoveryState({
      metaDir,
      identity: existing.identity || {
        activeRoot: fixture.activeRoot,
        project: fixture.project
      },
      sessionKey: hostSessionId,
      state
    }, { force: true })
    if (['error', 'bypassed'].includes(commit.status)) {
      throw new Error(`fixture TaskRecoveryStoreV5 update failed: ${commit.errorCode || commit.status}`)
    }
  }
  return {
    schemaVersion: 'ContextReadBindingV1',
    contextEpoch,
    planId,
    planContentId,
    activeRoot: fixture.activeRoot,
    project: fixture.project
  }
}

function createSkillRouteFixture (options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-skill-route-'))
  const project = options.project || 'sample'
  const projectRoot = path.join(root, project)
  const activeRoot = path.join(root, '.devcodex', project)
  fs.mkdirSync(projectRoot, { recursive: true })
  fs.mkdirSync(activeRoot, { recursive: true })
  writeJson(path.join(projectRoot, 'package.json'), {
    name: project,
    private: true,
    version: '0.0.0-fixture'
  })
  writeJson(path.join(root, '.devcodex', 'layout.json'), {
    schemaVersion: 'WorkspaceLayoutV1',
    mode: 'workspace-namespace'
  })
  writeJson(path.join(activeRoot, 'profile', 'config.json'), {
    ENV_MODE: 'dev',
    profileTier: 'profile-lite'
  })
  fs.writeFileSync(
    path.join(activeRoot, 'profile', 'README.md'),
    '# Skill route fixture Profile\n',
    'utf8'
  )
  for (const [file, title] of [
    ['01-项目信息.md', 'Project information'],
    ['02-架构约束.md', 'Architecture constraints'],
    ['03-代码风格.md', 'Code style']
  ]) {
    fs.writeFileSync(
      path.join(activeRoot, 'profile', file),
      `# ${title}\n\nIsolated skill-route fixture content.\n`,
      'utf8'
    )
  }
  const fixture = {
    root,
    project,
    projectRoot,
    activeRoot,
    packageRoot: PACKAGE_ROOT,
    globalRuntime: resolveFixtureGlobalRuntime()
  }
  fixture.runtimeOptions = {
    inputRoot: root,
    workspaceRoot: root,
    packageRoot: PACKAGE_ROOT,
    globalRuntime: fixture.globalRuntime,
    env: {}
  }
  fixture.cleanup = () => {
    if (process.env.DEVCODEX_KEEP_TEST_ARTIFACTS === '1') {
      process.stderr.write(`[skill-route-test-fixture] retained ${root}\n`)
      return
    }
    fs.rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 250
    })
  }
  if (options.workspaceSkill !== false) {
    writeWorkspaceSkill(root, options.skillId || 'workspace-probe')
  }
  return fixture
}

module.exports = {
  PACKAGE_ROOT,
  createSkillRouteFixture,
  resolveFixtureGlobalRuntime,
  writeContextBindingState,
  writeWorkspaceSkill,
  writeJson
}
