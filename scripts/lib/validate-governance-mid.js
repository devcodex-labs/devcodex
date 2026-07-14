function buildGovernanceMidChecks(ctx) {
  const { ROOT, fs, path, read, err } = ctx

  function checkV29() {
    const probes = [
      {
        file: 'hooks/_runtime/lifecycle.cjs',
        needles: ['getVisibleReplyEvidence', 'collectProjectPayloadStrings']
      },
      {
        file: 'hooks/_runtime/lifecycle-bootstrap-state.cjs',
        needles: ['stickyProject', 'buildBootstrapMessage', 'bootstrapComplete']
      },
      {
        file: 'hooks/_runtime/lifecycle-visible-reply.cjs',
        needles: ['precheckStatus', 'verified-present', 'verified-missing']
      },
      {
        file: 'hooks/_runtime/lifecycle-project-target.cjs',
        needles: ['.devcodex/workspace/profile/', 'stickySessionKey', 'hasMultiProjectExemption']
      },
      {
        file: 'scripts/lib/test-hooks-runtime-bootstrap-layout.js',
        needles: ['stickyFollowup', 'roleUserPayloadAmbiguity', 'prefixProjectPayload', 'promptUserWordAmbiguity', 'stickyPromptUserWordFollowup', 'stickyRoleUserPayloadFollowup', 'stickyFuzzyPayloadFollowup']
      },
      {
        file: 'scripts/lib/test-hooks-runtime-visibility.js',
        needles: ['contentPartsStop', 'variantTranscriptStop', 'unverifiedStop']
      },
      {
        file: 'instructions.md',
        needles: ['意图扩展摘要', 'verified-present', 'unverified', '.devcodex/workspace/profile/']
      },
      {
        file: 'instructions/01-common.instructions.md',
        needles: ['用户可见意图扩展摘要', 'Stop 可见回复证据三态', 'sticky `activeProject`', '.devcodex/workspace/profile/']
      },
      {
        file: 'instructions/10-dev.instructions.md',
        needles: ['意图扩展摘要', '控制面或宿主能力差异']
      },
      {
        file: 'instructions/11-fix.instructions.md',
        needles: ['意图扩展摘要', '控制面或宿主能力差异']
      },
      {
        file: 'prompts/precheck-status.prompt.md',
        needles: ['意图扩展摘要', '备选路径']
      },
      {
        file: 'prompts/technical-design.prompt.md',
        needles: ['意图扩展摘要', '项目现实扩展后路由']
      },
      {
        file: 'prompts/report-dev.prompt.md',
        needles: ['Hook closure 三态证据', 'verified-present / verified-missing / unverified']
      },
      {
        file: 'prompts/report-fix.prompt.md',
        needles: ['Hook closure 三态证据', 'verified-present / verified-missing / unverified']
      },
      {
        file: 'skills/profile-bootstrap/SKILL.md',
        needles: ['.devcodex/workspace/profile/', 'workspace-namespace']
      },
      {
        file: 'README.md',
        needles: ['意图扩展摘要', 'Hook closure 三态', '.devcodex/workspace/profile/']
      },
      {
        file: 'website/docs/guide/development.md',
        needles: ['意图扩展摘要', 'Hook closure 三态', 'unverified']
      },
      {
        file: 'website/docs/specs/directory-structure.md',
        needles: ['.devcodex/workspace/profile/', 'Hook warning']
      },
      {
        file: 'changelogs/unreleased.md',
        needles: ['verified-present', 'sticky `activeProject`', '意图扩展摘要']
      }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V29] Hook visible reply / intent expansion drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V29] Hook visible reply / sticky project / intent expansion sync checked')
  }

  function checkV30() {
    const file = 'skills/routing/SKILL.md'
    const content = read(path.join(ROOT, file))
    for (const needle of ['先读今日 tasks/YYYYMMDD.md', '再读 Agent SUMMARY.md']) {
      if (!content.includes(needle)) {
        err(`[V30] resume restore ordering drift in ${file}: missing "${needle}"`)
      }
    }
    if (content.includes('RESTORE → 先读 Agent SUMMARY.md')) {
      err(`[V30] legacy resume restore ordering remains in ${file}`)
    }
    console.log('[V30] resume restore ordering sync checked')
  }

  function checkV31() {
    const probes = [
      'instructions/17-compliance.instructions.md',
      'prompts/precheck-status.prompt.md',
      'skills/audit-common/SKILL.md',
      'website/docs/specs/precheck-flow.md',
      'website/docs/specs/flowcharts.md'
    ]
    const required = ['.github/', '.claude/', 'AGENTS.md', '.agents/', '.codex/']
    const forbidden = ['.claude/.github/', '父链 `.claude/.github/`', '无父链 .claude/.github/', 'parent/source-root deployment']

    for (const file of probes) {
      const content = read(path.join(ROOT, file))
      for (const needle of required) {
        if (!content.includes(needle)) {
          err(`[V31] PC5 deployment surface drift in ${file}: missing "${needle}"`)
        }
      }
      for (const needle of forbidden) {
        if (content.includes(needle)) {
          err(`[V31] legacy PC5 deployment wording remains in ${file}: "${needle}"`)
        }
      }
    }

    const complianceContent = read(path.join(ROOT, 'instructions/17-compliance.instructions.md'))
    if (!complianceContent.includes('### PC5 部署体状态（v1.11.0+，全模式基础项）')) {
      err('[V31] PC5 section heading in instructions/17-compliance.instructions.md must be v1.11.0+')
    }

    const auditCommonContent = read(path.join(ROOT, 'skills/audit-common/SKILL.md'))
    if (!auditCommonContent.includes('【v1.11.0+ 父链部署体扫描】')) {
      err('[V31] audit-common parent deployment heading must be v1.11.0+')
    }
    for (const needle of ['.claude/{instructions,skills,prompts,agents,hooks}/', '.github/{instructions,skills,prompts,agents,hooks}/']) {
      if (!auditCommonContent.includes(needle)) {
        err(`[V31] audit-common parent deployment scan missing "${needle}"`)
      }
    }

    const deploymentCheckContent = read(path.join(ROOT, 'scripts/lib/validate-governance-package-deployment.js'))
    for (const needle of ['source-root deployment must not exist', 'single active deployment target', 'parent deployment']) {
      if (!deploymentCheckContent.includes(needle)) {
        err(`[V31] V8 deployment guard missing "${needle}"`)
      }
    }

    console.log('[V31] PC5 deployment surface sync checked')
  }

  function checkV32() {
    const probes = [
      {
        file: 'instructions/12-audit.instructions.md',
        required: ['<audit-root>/.audit-state/<session-id>.json', '<audit-root>/.audit-state/*.json', '取值与 active-root 一致'],
        forbidden: ['`.devcodex/.audit-state/<session-id>.json`', '扫描 `.audit-state/*.json`']
      },
      {
        file: 'skills/audit-session/SKILL.md',
        required: ['<audit-root>/.audit-state/<session-id>.json', '<audit-root>/.audit-state/', '<audit-root>/.audit-state/*.json'],
        forbidden: ['在 .devcodex/.audit-state/<session-id>.json 持久化', '`.devcodex/.audit-state/` 目录由本 Skill 首次写入时创建', '扫描 `.devcodex/.audit-state/*.json`', '读取 `.devcodex/.audit-state/` 下所有 `.json`']
      }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.required) {
        if (!content.includes(needle)) {
          err(`[V32] audit-state active-root drift in ${probe.file}: missing "${needle}"`)
        }
      }
      for (const needle of probe.forbidden) {
        if (content.includes(needle)) {
          err(`[V32] legacy audit-state wording remains in ${probe.file}: "${needle}"`)
        }
      }
    }

    console.log('[V32] audit-state active-root sync checked')
  }

  function checkV33() {
    const probes = [
      'instructions/16-report.instructions.md',
      'skills/report/SKILL.md',
      'prompts/report-audit.prompt.md'
    ]

    for (const file of probes) {
      const content = read(path.join(ROOT, file))
      if (!content.includes('连续 3 轮零发现')) {
        err(`[V33] audit convergence wording drift in ${file}: missing "连续 3 轮零发现"`)
      }
      if (content.includes('R{N}+R{N+1}')) {
        err(`[V33] legacy audit convergence wording remains in ${file}`)
      }
    }

    console.log('[V33] audit convergence wording sync checked')
  }

  function checkV34() {
    const file = 'prompts/contributing.prompt.md'
    const content = read(path.join(ROOT, file))

    for (const needle of ['<install-command>', '<dev-command>', '<test-command>', '若项目提供行为准则文件']) {
      if (!content.includes(needle)) {
        err(`[V34] contributing template missing generalized placeholder text: ${needle}`)
      }
    }
    for (const needle of ['pnpm install', 'pnpm dev', 'pnpm test', 'pnpm test:unit', 'pnpm test:coverage', 'CODE_OF_CONDUCT.md']) {
      if (content.includes(needle)) {
        err(`[V34] contributing template still hardcodes project-specific text: ${needle}`)
      }
    }

    console.log('[V34] contributing template assumptions checked')
  }

  function checkV35() {
    const probes = [
      {
        file: 'skills/spec-governance/SKILL.md',
        needles: ['Concept Sync Map', 'currentConsumers', 'historicalMirrors', 'validateProbes', 'deployCopies', 'yellowDeviationBoundary', 'source-consumer-sync']
      },
      {
        file: 'skills/source-consumer-sync/SKILL.md',
        needles: ['ConceptSyncMap', 'sourceOfTruth', 'currentConsumers', 'historicalMirrors', 'validateProbes', 'deployCopies', 'yellowDeviationBoundary']
      },
      {
        file: 'skills/execution-contract/SKILL.md',
        needles: ['consumerScope', 'verificationEvidence', 'deviationLog', 'currentConsumers', 'historicalMirrors']
      },
      {
        file: 'skills/document-sync/SKILL.md',
        needles: ['Concept Sync Map', '当前消费者', '历史镜像', 'source-consumer-sync']
      },
      {
        file: 'skills/report/SKILL.md',
        needles: ['ConceptSyncMap', '黄色偏离', '部署同步证据']
      },
      {
        file: 'prompts/technical-design.prompt.md',
        needles: ['Concept Sync Map', 'sourceOfTruth', 'yellowDeviationBoundary']
      },
      {
        file: 'prompts/implementation-plan.prompt.md',
        needles: ['ConceptSyncMap', 'currentConsumers', 'historicalMirrors', 'deployCopies']
      },
      {
        file: 'prompts/report-dev.prompt.md',
        needles: ['ConceptSyncMap', '黄色偏离', '部署同步证据']
      },
      {
        file: 'prompts/report-audit.prompt.md',
        needles: ['Concept Sync Map', '黄色偏离', '部署同步证据']
      },
      {
        file: 'prompts/report-optimization.prompt.md',
        needles: ['ConceptSyncMap', 'currentConsumers', 'yellowDeviationBoundary', '部署同步证据']
      },
      {
        file: 'prompts/report-scenario-test.prompt.md',
        needles: ['ConceptSyncMap', 'currentConsumers', 'yellowDeviationBoundary', '部署同步证据']
      },
      {
        file: 'prompts/implementation-progress.prompt.md',
        needles: ['ConceptSyncMap', 'currentConsumers', 'yellowDeviationBoundary']
      }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V35] concept sync map drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V35] concept sync map sync checked')
  }

  function checkV36() {
    const probes = [
      {
        file: 'skills/host-contract-verification/SKILL.md',
        needles: ['HostContractRoute', 'hostSurface', 'eventScope', 'visibleReplyEvidence', 'workspaceGuard', 'direct replay', 'fixture replay']
      },
      {
        file: 'skills/test-router/SKILL.md',
        needles: ['hostVerificationMode', 'workspaceGuard', 'evidenceSource', 'host-contract-verification']
      },
      {
        file: 'skills/report/SKILL.md',
        needles: ['HostContractVerification', 'hostSurface', 'workspaceGuard']
      },
      {
        file: 'prompts/technical-design.prompt.md',
        needles: ['hostVerificationMode', 'Concept Sync Map', 'HostContractRoute']
      },
      {
        file: 'prompts/implementation-plan.prompt.md',
        needles: ['HostContractVerification', 'hostSurface', 'workspaceGuard', 'bootstrapScope']
      },
      {
        file: 'prompts/report-dev.prompt.md',
        needles: ['HostContractVerification', 'HostContract 验证', 'host-contract probe']
      },
      {
        file: 'prompts/report-fix.prompt.md',
        needles: ['HostContractVerification', 'HostContract 验证', 'host-contract probe']
      },
      {
        file: 'prompts/report-optimization.prompt.md',
        needles: ['HostContractVerification', 'HostContract 验证', 'workspaceGuard', 'visibleReplyEvidence']
      },
      {
        file: 'prompts/report-scenario-test.prompt.md',
        needles: ['HostContractVerification', 'HostContract 验证', 'workspaceGuard', 'visibleReplyEvidence']
      },
      {
        file: 'prompts/implementation-progress.prompt.md',
        needles: ['HostContractVerification', 'workspaceGuard', 'bootstrapScope']
      },
      {
        file: 'README.md',
        needles: ['host-contract-verification', 'source-consumer-sync']
      },
      {
        file: 'website/docs/guide/development.md',
        needles: ['host-contract-verification', 'source-consumer-sync']
      }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V36] host contract verification drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V36] host contract verification sync checked')
  }

  function checkV37() {
    const probes = [
      {
        file: 'hooks/_runtime/workspace-layout.cjs',
        needles: ['namespaceHasRuntimeState', 'collectWorkspaceProjectNamespaces', 'UTILITY_ROOT_DIR_NAMES', 'CONTAINER_DIR_NAMES']
      },
      {
        file: 'hooks/_runtime/lifecycle.cjs',
        needles: ['collectWorkspaceProjectNamespaces']
      },
      {
        file: 'hooks/_runtime/lifecycle-project-target.cjs',
        needles: ['!currentSessionKey || !stickySessionKey', 'collectWorkspaceProjectNamespaces']
      },
      {
        file: 'index.js',
        needles: ['writeManagedJsonFile', 'mergeClaudeHooks', 'mergeClaudeMcpConfig', 'detectHostPlatform']
      },
      {
        file: 'scripts/lib/cli-maintenance-commands.js',
        needles: ['installed hosts:']
      },
      {
        file: 'scripts/test-cli-behavior.js',
        needles: ['testClaudeUpdateBacksUpAndPreservesCustomConfig', 'testDoctorAvoidsCodexBiasInMixedHostRepo', 'testProfileInitUsesNestedNamespaceRoot']
      },
      {
        file: 'scripts/lib/test-hooks-runtime-bootstrap-layout.js',
        needles: ['noSessionFollowup', 'nestedWorkspaceAmbiguity', 'toolingSiblingPrompt']
      },
      {
        file: 'scripts/test-migrate-layout.js',
        needles: ['nestedManifest', 'packages/app-a', 'tools']
      }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V37] namespace safety / CLI protection drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
    const scripts = pkg.scripts || {}
    if (!scripts['test:audit']) {
      err('[V37] package.json missing deterministic follow-up audit script: test:audit')
    }
    if ((scripts['test:all'] || '').includes('npm audit')) {
      err('[V37] package.json test:all must stay deterministic and must not invoke npm audit directly')
    }
    if (!(scripts['test:all:with-audit'] || '').includes('npm run test:audit')) {
      err('[V37] package.json test:all:with-audit must chain npm run test:audit')
    }

    console.log('[V37] namespace safety / CLI protection / deterministic test chain checked')
  }

  function checkV38() {
    const plugin = JSON.parse(read(path.join(ROOT, 'plugin.json')))
    const requiredSkills = [
      ['readme-authoring', 'skills/readme-authoring/SKILL.md'],
      ['audit-readme', 'skills/audit-readme/SKILL.md']
    ]

    for (const [id, file] of requiredSkills) {
      const entry = (plugin.skills || []).find(skill => skill.id === id)
      if (!entry) {
        err(`[V38] plugin.json missing README governance skill: ${id}`)
        continue
      }
      if (entry.file !== file) {
        err(`[V38] plugin.json ${id} has wrong file: ${entry.file}`)
      }
      const filePath = path.join(ROOT, file)
      if (!fs.existsSync(filePath)) {
        err(`[V38] README governance skill file missing: ${file}`)
        continue
      }
      const content = read(filePath)
      if (!content.includes(`name: ${id}`)) {
        err(`[V38] README governance skill frontmatter mismatch in ${file}`)
      }
    }

    const probes = [
      {
        file: 'skills/readme-authoring/SKILL.md',
        needles: ['primaryAudience', 'userJourney', 'consumerMap', '用户 / 使用者']
      },
      {
        file: 'skills/audit-readme/SKILL.md',
        needles: ['RM-1 用户路径完整性', 'RM-6 消费链一致性', '快速开始可执行性']
      },
      {
        file: 'skills/dev-docs/SKILL.md',
        needles: ['readme-authoring', 'audit-readme', 'README 专项写作分支']
      },
      {
        file: 'skills/dev-init/SKILL.md',
        needles: ['readme-authoring', 'audit-readme']
      },
      {
        file: 'skills/document-sync/SKILL.md',
        needles: ['readme-authoring', 'audit-readme', '目标用户 / 使用者是否明确']
      },
      {
        file: 'skills/audit-document/SKILL.md',
        needles: ['audit-readme', 'README 叠加规则']
      },
      {
        file: 'skills/audit-execution-guide/SKILL.md',
        needles: ['audit-readme', 'README / 用户使用文档']
      },
      {
        file: 'prompts/project-readme.prompt.md',
        needles: ['用户 / 使用者优先', '## 适用对象与使用场景', '## 常见用法', '## 常见问题与排错', '## 开发与贡献']
      },
      {
        file: 'README.md',
        needles: ['readme-authoring', 'audit-readme', 'README 专项能力']
      },
      {
        file: 'website/docs/intro/index.md',
        needles: ['readme-authoring', 'audit-readme']
      },
      {
        file: 'website/docs/specs/directory-structure.md',
        needles: ['readme-authoring', 'audit-readme']
      },
      {
        file: 'website/docs/guide/development.md',
        needles: ['readme-authoring', 'audit-readme']
      },
      {
        file: 'package.json',
        needles: ['test:readme-governance', 'node scripts/test-readme-governance.js']
      }
    ]

    for (const probe of probes) {
      const content = read(path.join(ROOT, probe.file))
      for (const needle of probe.needles) {
        if (!content.includes(needle)) {
          err(`[V38] README governance drift in ${probe.file}: missing "${needle}"`)
        }
      }
    }

    console.log('[V38] README authoring/review governance sync checked')
  }

  return {
    checkV29,
    checkV30,
    checkV31,
    checkV32,
    checkV33,
    checkV34,
    checkV35,
    checkV36,
    checkV37,
    checkV38
  }
}

module.exports = { buildGovernanceMidChecks }
