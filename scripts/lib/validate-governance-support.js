'use strict'

function buildGovernanceSupportChecks(ctx) {
  const {
    ROOT,
    fs,
    path,
    read,
    err,
    warn,
    execSync,
    activePath,
    mustInclude
  } = ctx

  function checkV25() {
    const probes = [
      ['instructions.md', 'Intent Expansion Card', 'instructions single-source intent card'],
      ['instructions.md', 'ConfirmationRequest', 'instructions single-source confirmation abstraction'],
      ['instructions.md', 'ECR 执行闭环复审', 'instructions single-source ECR'],
      ['instructions.md', '推荐结论', 'instructions single-source recommendation'],
      ['instructions.md', 'ComparativeResearchGate', 'instructions single-source comparative research gate'],
      ['instructions/01-common.instructions.md', 'Intent Expansion Card', '01-common intent card'],
      ['instructions/01-common.instructions.md', 'QuestionEvidenceGate', '01-common question evidence gate'],
      ['instructions/10-dev.instructions.md', 'ECR-1', '10-dev ECR checklist'],
      ['instructions/11-fix.instructions.md', 'ECR-1', '11-fix ECR checklist'],
      ['instructions/13-analyze.instructions.md', '推荐结论', '13-analyze recommendation conclusion'],
      ['instructions/13-analyze.instructions.md', 'ComparativeResearchGate', '13-analyze comparative gate'],
      ['skills/analyze-research/SKILL.md', '同类产品 / 项目', 'analyze research same-type comparison'],
      ['instructions/17-compliance.instructions.md', '推荐：无后续动作', '17-compliance recommendation fallback'],
      ['skills/dev-default/SKILL.md', 'ECR-1', 'dev-default ECR checklist'],
      ['skills/fix-default/SKILL.md', 'ECR 执行闭环复审', 'fix-default ECR'],
      ['skills/report/SKILL.md', '推荐结论', 'report recommendation conclusion'],
      ['skills/compliance/SKILL.md', '推荐：无后续动作', 'compliance recommendation fallback'],
      ['skills/intent/SKILL.md', 'Intent Expansion Card', 'intent card'],
      ['skills/load-profile/SKILL.md', 'host-capability', 'load-profile host capability field'],
      ['skills/cp-gate/SKILL.md', 'ConfirmationRequest', 'cp-gate confirmation abstraction'],
      ['prompts/precheck-status.prompt.md', 'Intent Expansion Card', 'precheck prompt intent card'],
      ['prompts/report-analysis.prompt.md', '推荐结论', 'analysis report recommendation'],
      ['prompts/report-analysis.prompt.md', 'QuestionEvidenceGate', 'analysis report question evidence gate'],
      ['prompts/report-audit.prompt.md', '推荐结论', 'audit report recommendation'],
      ['prompts/report-dev.prompt.md', 'ECR 执行闭环复审', 'dev report ECR'],
      ['prompts/report-fix.prompt.md', 'ECR 执行闭环复审', 'fix report ECR'],
      ['prompts/report-optimization.prompt.md', 'ECR 执行闭环复审', 'optimization report ECR'],
      ['prompts/report-scenario-test.prompt.md', 'ECR 执行闭环复审', 'scenario report ECR'],
      ['README.md', 'ECR 执行闭环复审', 'README ECR'],
      ['README.md', '推荐结论', 'README recommendation'],
      ['README.md', '对比调研门禁', 'README comparative research gate'],
      ['README.md', 'ConfirmationRequest', 'README confirmation abstraction'],
      ['website/docs/guide/development.md', 'ECR 执行闭环复审', 'website development ECR'],
      ['website/docs/guide/development.md', 'QuestionEvidenceGate', 'website question evidence gate'],
      ['website/docs/specs/exec-compliance-flow.md', '推荐结论', 'website compliance recommendation'],
      ['website/docs/specs/precheck-flow.md', 'Intent Expansion Card', 'website precheck intent card'],
      ['website/docs/specs/report-output-flow.md', '推荐结论', 'website report recommendation']
    ]
    for (const [file, needle, label] of probes) mustInclude(file, needle, label)
    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
    const releaseChangelog = `changelogs/releases/v${pkg.version}.md`
    const releaseNeedleFound = (
      fs.existsSync(path.join(ROOT, releaseChangelog)) &&
      read(path.join(ROOT, releaseChangelog)).includes('Intent Expansion Card')
    ) || read(path.join(ROOT, 'changelogs/unreleased.md')).includes('Intent Expansion Card')
    if (!releaseNeedleFound) {
      err(`[V25] ECR change missing required text in changelogs/unreleased.md or ${releaseChangelog}: Intent Expansion Card`)
    }
    console.log('[V25] ECR / intent card / confirmation / recommendation semantics checked')
  }

  function checkV26() {
    const probes = [
      {
        file: 'skills/spec-governance/SKILL.md',
        needles: [
          'RecordRouter',
          'SCV-0',
          'SCV-7',
          'record.violation',
          'record.ambiguous',
          'AI 与确定性边界',
          '你刚才漏了/错了/违反流程了',
          'VL/PF 关闭前必须具备修复方案',
          '当前 DevCodex 源仓或规范维护项目的 active-root'
        ]
      },
      {
        file: 'instructions.md',
        needles: [
          '规范治理生命周期（RecordRouter + SCV）',
          'record.spec-defect',
          'SCV（Spec Change Verification）',
          '你刚才漏了/错了/违反流程了',
          'VL/PF 关闭前必须具备修复方案'
        ]
      },
      {
        file: 'instructions/18-spec-radar.instructions.md',
        needles: ['Intent Detection → RecordRouter', 'record.audit-gap', 'skills/spec-governance/SKILL.md']
      },
      {
        file: 'website/docs/specs/precheck-flow.md',
        needles: ['Intent Detection → RecordRouter', 'PF/VL/GAP → RecordRouter']
      },
      {
        file: 'website/docs/specs/spec-radar-flow.md',
        needles: ['RecordRouter 分流口径', 'PF/VL/GAP → RecordRouter']
      },
      {
        file: 'instructions/14-self-fix.instructions.md',
        needles: ['T_RECORD / RecordRouter', 'record.process-improvement', 'record.ambiguous']
      },
      {
        file: 'skills/intent/SKILL.md',
        needles: ['record.violation', 'record.none', 'RecordRouter']
      },
      {
        file: 'skills/report/SKILL.md',
        needles: ['规范化意图', 'SCV-0~SCV-7']
      }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V26] spec governance drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    const templateProbes = [
      ['data/templates/violations.md', 'record.violation'],
      ['data/templates/violations.md', '验证证据'],
      ['data/templates/violations.md', '关闭时间'],
      ['data/templates/pending-fixes.md', 'record.spec-defect'],
      ['data/templates/pending-fixes.md', 'SCV要求'],
      ['data/templates/pending-fixes.md', '验证证据'],
      ['data/templates/process-improvements.md', 'record.process-improvement'],
      ['data/templates/pending-issues.md', 'record.pending-issue'],
      ['data/templates/gap-registry.md', 'record.audit-gap']
    ]
    for (const [file, needle] of templateProbes) mustInclude(file, needle, `template ${needle}`)

    const activeRuleFiles = [
      'README.md',
      'instructions.md',
      'instructions/00-safety.instructions.md',
      'instructions/12-audit.instructions.md',
      'instructions/18-spec-radar.instructions.md',
      'skills/cp-gate/SKILL.md',
      'skills/spec-governance/SKILL.md',
      'data/templates/violations.md',
      'data/templates/pending-fixes.md',
      'data/templates/process-improvements.md',
      'data/templates/pending-issues.md',
      'data/templates/gap-registry.md'
    ]
    for (const file of activeRuleFiles) {
      const content = read(path.join(ROOT, file))
      if (content.includes('.devcodex/.maintainer-state')) {
        err(`[V26] current governance rule file must use active-root, not .devcodex/.maintainer-state: ${file}`)
      }
    }

    const genericDistributedFiles = [
      'instructions.md',
      'instructions/00-safety.instructions.md',
      'instructions/12-audit.instructions.md',
      'skills/spec-governance/SKILL.md',
      'data/README.md',
      'data/templates/violations.md',
      'data/templates/pending-fixes.md',
      'data/templates/process-improvements.md',
      'data/templates/pending-issues.md',
      'data/templates/gap-registry.md'
    ]
    for (const file of genericDistributedFiles) {
      const content = read(path.join(ROOT, file))
      const sourceProjectName = ['devcodex', 'v1'].join('-')
      if (content.includes(sourceProjectName)) {
        err(`[V26] generic distributed governance asset must not hard-code source project name: ${file}`)
      }
    }

    try {
      execSync('node scripts/test-spec-governance.js', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    } catch (e) {
      const detail = String((e.stderr || e.stdout || e.message || '')).trim().split('\n').slice(0, 8).join(' | ')
      err(`[V26] test-spec-governance failed${detail ? `: ${detail}` : ''}`)
    }
    console.log('[V26] spec governance semantics checked')
  }

  function checkV27() {
    const workspaceRoot = path.dirname(ROOT)
    const rootArtifactPatterns = [
      /^AGENTS\.md\.bak\./i,
      /^mail.*\.json$/i,
      /^update-mail-temp-content/i,
      /^webstorm-update-mail/i,
      /^hs_err_pid.*\.log$/i,
      /^replay_pid.*\.log$/i
    ]
    const misplacedRootArtifacts = fs.readdirSync(workspaceRoot, { withFileTypes: true })
      .filter(entry => entry.isFile() && rootArtifactPatterns.some(re => re.test(entry.name)))
      .map(entry => entry.name)
    if (misplacedRootArtifacts.length) {
      err(`[V27] workspace root contains transient artifacts that must live under .devcodex/workspace/.tmp: ${misplacedRootArtifacts.join(', ')}`)
    }

    let layout = null
    try {
      layout = JSON.parse(fs.readFileSync(path.join(workspaceRoot, '.devcodex', 'layout.json'), 'utf8'))
    } catch {
      layout = null
    }
    if (layout && String(layout.mode || '').trim() === 'workspace-namespace') {
      const projectTmpLeaks = fs.readdirSync(workspaceRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name !== '.devcodex')
        .flatMap(entry => {
          const tmpDir = path.join(workspaceRoot, entry.name, '.devcodex', '.tmp')
          if (!fs.existsSync(tmpDir)) return []
          const files = fs.readdirSync(tmpDir, { recursive: true })
            .map(name => path.join(tmpDir, name))
            .filter(file => fs.existsSync(file) && fs.statSync(file).isFile())
          return files.map(file => path.relative(workspaceRoot, file).replace(/\\/g, '/'))
        })
      if (projectTmpLeaks.length) {
        err(`[V27] project-local .devcodex/.tmp leaks found under workspace-namespace: ${projectTmpLeaks.slice(0, 8).join(', ')}`)
      }
    }

    const indexSrc = read(path.join(ROOT, 'index.js'))
    for (const needle of ['resolveActiveRuntimeRoot', 'ensureRuntimeDirs', 'resolveGitignoreRoot', 'backupDir', '.devcodex/*/.tmp/']) {
      if (!indexSrc.includes(needle)) {
        err(`[V27] index.js active-root resolver missing "${needle}"`)
      }
    }

    const lifecycleSrc = read(path.join(ROOT, 'hooks', '_runtime', 'lifecycle.cjs'))
    for (const needle of ['ACTIVE_RUNTIME_ROOT', 'isDevCodexManagedPath', 'DEVCODEX_DEPLOYMENT_PATH_RE']) {
      if (!lifecycleSrc.includes(needle)) {
        err(`[V27] lifecycle runtime active-root guard missing "${needle}"`)
      }
    }
    if (/const\s+DEVCODEX_PATH_RE\s*=\s*\/\\\.devcodex\[\/\\{2}\]\|/.test(lifecycleSrc)) {
      err('[V27] lifecycle runtime still globally whitelists every .devcodex path')
    }

    console.log('[V27] active-root and transient artifact boundary checked')
  }

  function checkV28() {
    const supportSkills = ['execution-contract', 'test-router', 'release-verification', 'host-contract-verification', 'source-consumer-sync']
    const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
    const skillFiles = fs.readdirSync(path.join(ROOT, 'skills'), { recursive: true })
      .map(name => path.join(ROOT, 'skills', name))
      .filter(file => path.basename(file) === 'SKILL.md')
    const pluginSkillIds = new Set((plugin.skills || []).map(skill => skill.id))

    if ((plugin.skills || []).length !== skillFiles.length) {
      err(`[V28] plugin skill count (${(plugin.skills || []).length}) does not match SKILL.md count (${skillFiles.length})`)
    }

    for (const id of supportSkills) {
      const skill = (plugin.skills || []).find(item => item.id === id)
      const expectedFile = `skills/${id}/SKILL.md`
      if (!skill) {
        err(`[V28] plugin.json missing support skill: ${id}`)
        continue
      }
      if (skill.file !== expectedFile) {
        err(`[V28] plugin.json support skill ${id} has wrong file: ${skill.file}`)
      }
      const filePath = path.join(ROOT, expectedFile)
      if (!fs.existsSync(filePath)) {
        err(`[V28] support skill file missing: ${expectedFile}`)
        continue
      }
      const content = read(filePath)
      if (!content.includes(`name: ${id}`)) {
        err(`[V28] support skill frontmatter mismatch in ${expectedFile}`)
      }
      if (!pluginSkillIds.has(id)) {
        err(`[V28] support skill not registered in plugin ids: ${id}`)
      }
    }

    const probes = [
      {
        file: 'instructions/01-common.instructions.md',
        needles: ['execution-contract', 'test-router', 'release-verification', 'host-contract-verification', 'source-consumer-sync', '不是工作流子类型']
      },
      {
        file: 'instructions/10-dev.instructions.md',
        needles: ['execution-contract/test-router', 'release-verification', '05-实施进度.md', '多批次']
      },
      {
        file: 'instructions/11-fix.instructions.md',
        needles: ['execution-contract/test-router', '05-实施进度.md', '多批次修复']
      },
      {
        file: 'instructions/02-output-paths.instructions.md',
        needles: ['05-实施进度 触发条件', '多批次', '预计修改 ≥10 文件', 'R0~R7']
      },
      {
        file: 'instructions/17-compliance.instructions.md',
        needles: ['ExecutionContract/TestRoute/ReleaseAudit/ReleaseVerification', '实施进度（触发时）']
      },
      {
        file: 'skills/report/SKILL.md',
        needles: ['dev/fix 支撑产物字段', 'ExecutionContract', 'TestRoute', 'ReleaseVerification', '05-实施进度.md']
      },
      {
        file: 'skills/dev-testing/SKILL.md',
        needles: ['与 test-router 的关系', 'TestRoute 包含对外 HTTP API']
      },
      {
        file: 'skills/api-verification/SKILL.md',
        needles: ['与 test-router 的关系', '.http + .cjs']
      },
      {
        file: 'skills/dev-scenario-test/SKILL.md',
        needles: ['TestRoute 中的场景/负载/E2E 路线', 'TestRoute 已确认']
      },
      {
        file: 'prompts/report-dev.prompt.md',
        needles: ['支撑产物状态', 'TestRoute 覆盖', 'ExecutionContract：✅ 完成 / N/A']
      },
      {
        file: 'prompts/report-fix.prompt.md',
        needles: ['支撑产物状态', 'TestRoute 覆盖', 'ExecutionContract：✅ 完成 / N/A']
      },
      {
        file: 'prompts/report-optimization.prompt.md',
        needles: ['支撑产物状态', 'TestRoute 覆盖', 'ConceptSyncMap', 'HostContractVerification', '05-实施进度.md']
      },
      {
        file: 'prompts/report-scenario-test.prompt.md',
        needles: ['支撑产物状态', 'TestRoute 覆盖', 'ConceptSyncMap', 'HostContractVerification', '05-实施进度.md']
      },
      {
        file: 'instructions/10-dev.instructions.md',
        needles: ['host-contract-verification', 'source-consumer-sync', '支撑型 Skill']
      },
      {
        file: 'prompts/technical-design.prompt.md',
        needles: ['§7.0 TestRoute', 'ExecutionContract', 'ReleaseVerification R0~R7']
      },
      {
        file: 'prompts/implementation-plan.prompt.md',
        needles: ['§4.1 执行契约与支持技能', 'ExecutionContract', 'TestRoute', 'ConceptSyncMap 已建立并核对当前消费者/探针/部署副本', 'HostContractVerification 已建立并核对宿主证据/guard/visible reply', '05-实施进度.md']
      },
      {
        file: 'prompts/implementation-progress.prompt.md',
        needles: ['多批次执行', '预计修改 ≥10 文件', '支撑产物状态', 'ExecutionContract', 'ConceptSyncMap', 'HostContractVerification']
      },
      {
        file: 'prompts/delivery-checklist.prompt.md',
        needles: ['预计修改 ≥10 文件', 'ExecutionContract', 'TestRoute', 'ReleaseVerification', 'ConceptSyncMap', 'HostContractVerification']
      },
      {
        file: 'README.md',
        needles: ['支撑型 Skill', 'host-contract-verification', 'source-consumer-sync']
      },
      {
        file: 'website/docs/index.md',
        needles: ['宿主契约验证', '真相源-消费者同步']
      },
      {
        file: 'website/docs/intro/index.md',
        needles: ['host-contract-verification', 'source-consumer-sync']
      },
      {
        file: 'website/docs/specs/directory-structure.md',
        needles: ['host-contract-verification', 'source-consumer-sync']
      },
      {
        file: 'website/docs/guide/development.md',
        needles: ['支撑型 Skill', '05-实施进度.md']
      },
      {
        file: 'website/docs/guide/release.md',
        needles: ['ReleaseVerification R0~R7', 'release-verification']
      },
      {
        file: 'website/docs/guide/requirements.md',
        needles: ['预计修改 ≥10 文件', '05-实施进度.md']
      },
      {
        file: 'agents/devcodex-auto.agent.md',
        needles: ['ExecutionContract', 'allowedPaths']
      },
      {
        file: 'agents/README.md',
        needles: ['ExecutionContract', 'ReleaseVerification']
      },
      {
        file: 'changelogs/unreleased.md',
        needles: ['execution-contract', 'test-router', 'release-verification', 'host-contract-verification', 'source-consumer-sync']
      }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V28] support skill/progress drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    const activeProfileProbes = [
      { file: activePath('profile', '01-项目信息.md'), needles: ['host-contract-verification', 'source-consumer-sync'] },
      { file: activePath('profile', '02-架构约束.md'), needles: ['支撑型（5）', 'host-contract-verification'] }
    ]
    for (const probe of activeProfileProbes) {
      if (!fs.existsSync(probe.file)) {
        warn(`[V28] active profile missing, skip support skill profile probe: ${path.relative(ROOT, probe.file)}`)
        continue
      }
      const content = read(probe.file)
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V28] active profile support skill drift in ${path.relative(ROOT, probe.file)}: missing "${needle}"`)
        }
      }
    }

    const legacyProgressNeedles = [
      ['prompts/implementation-progress.prompt.md', '仅在任务跨多轮/多阶段、存在明确阻塞或用户要求持续跟踪'],
      ['skills/dev-optimization/SKILL.md', '仅在跨多轮、存在明确阻塞或用户要求持续跟踪时启用'],
      ['changelogs/unreleased.md', '当前无未发布条目。'],
      ['skills/document-sync/SKILL.md', '支撑型 Skill（`execution-contract` / `test-router` / `release-verification`）的注册、触发说明、报告模板、validate 探针和用户文档是否一致']
    ]
    for (const [file, needle] of legacyProgressNeedles) {
      const content = read(path.join(ROOT, file))
      if (content.includes(needle)) {
        err(`[V28] legacy progress/release wording remains in ${file}: "${needle}"`)
      }
    }

    console.log('[V28] support skills / progress / release verification sync checked')
  }

  return {
    checkV25,
    checkV26,
    checkV27,
    checkV28
  }
}

module.exports = { buildGovernanceSupportChecks }
