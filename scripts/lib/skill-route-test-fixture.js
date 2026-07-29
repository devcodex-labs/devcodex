'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

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

function writeContextBindingState (fixture, contextEpoch, finalIntent = 'dev') {
  const planId = `plan-${contextEpoch}`
  const planContentId = `content-${contextEpoch}`
  const receiptId = `receipt-${contextEpoch}`
  const statePath = path.join(
    fixture.activeRoot,
    '.memory',
    'hooks',
    fixture.project,
    'lifecycle-state.json'
  )
  writeJson(statePath, {
    contextAcquisition: {
      contextEpoch,
      activeRoot: fixture.activeRoot.replace(/\\/g, '/'),
      project: fixture.project,
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
  })
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
    globalRuntime: {
      status: 'resolved',
      root: path.join(PACKAGE_ROOT, 'skills'),
      portfolioPath: path.join(PACKAGE_ROOT, 'skills', 'portfolio.json')
    }
  }
  fixture.runtimeOptions = {
    inputRoot: root,
    workspaceRoot: root,
    packageRoot: PACKAGE_ROOT,
    globalRuntime: fixture.globalRuntime,
    env: {}
  }
  fixture.cleanup = () => fs.rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 250
  })
  if (options.workspaceSkill !== false) {
    writeWorkspaceSkill(root, options.skillId || 'workspace-probe')
  }
  return fixture
}

module.exports = {
  PACKAGE_ROOT,
  createSkillRouteFixture,
  writeContextBindingState,
  writeWorkspaceSkill,
  writeJson
}
