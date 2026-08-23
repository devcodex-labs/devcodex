#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'validate-profile.js')
const ALL_SCRIPT = path.join(ROOT, 'scripts', 'validate-all-profiles.js')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const VERSION = pkg.version
const PACKAGE_NAME = pkg.name
const TEMP_ROOTS = []

function writeFile(root, relativePath, content) {
    const filePath = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
}

function createWorkspace(projectInfo) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-validate-profile-'))
    TEMP_ROOTS.push(root)

    writeFile(root, 'package.json', JSON.stringify({ name: PACKAGE_NAME }, null, 2))
    writeFile(root, '.devcodex/profile/README.md', '# README\n\n- Profile 档位：profile-lite。\n- `config.local.json`：本地私有 overlay。\n- `extensions.<namespace>`：扩展位需在 Profile 中说明。\n')
    writeFile(root, '.devcodex/profile/02-架构约束.md', '# 02\n')
    writeFile(root, '.devcodex/profile/03-代码风格.md', '# 03\n')
    writeFile(root, '.devcodex/profile/config.json', JSON.stringify({
        mode: 'dev',
        agent: 'claude-code',
        pluginVersion: VERSION
    }, null, 2))
    writeFile(root, '.devcodex/profile/01-项目信息.md', projectInfo)

    return root
}

function runValidate(workspaceRoot) {
    return spawnSync(process.execPath, [SCRIPT], {
        cwd: workspaceRoot,
        encoding: 'utf8'
    })
}

function featureInventoryDocument(overrides = {}) {
    const row = {
        featureId: 'cli-main',
        capabilityGroup: 'CLI',
        publicSurface: '`devcodex`',
        configEntrypoint: '命令参数',
        primaryConsumers: 'CLI 用户',
        docsEntrypoint: '`README.md`',
        validationRoute: '`node test.js`',
        sourceEvidence: 'package.json#bin.devcodex',
        maintenanceOwner: '项目维护者',
        releaseState: 'unverified',
        lifecycleState: 'implemented',
        evidenceState: 'source-backed',
        asOf: '2026-07-16',
        evidenceRefs: 'package.json#bin.devcodex',
        ...overrides
    }
    return [
        '# 06 — 功能清单',
        '',
        '> FeatureInventorySchemaV2',
        '',
        '| 能力 ID | 能力组 | 公开面 | 配置入口 | 主要消费者 | 文档入口 | 验证路线 | 事实来源 | 维护责任 | 发布状态 | 生命周期状态 | 证据状态 | 证据日期 | 证据引用 |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
        `| ${row.featureId} | ${row.capabilityGroup} | ${row.publicSurface} | ${row.configEntrypoint} | ${row.primaryConsumers} | ${row.docsEntrypoint} | ${row.validationRoute} | ${row.sourceEvidence} | ${row.maintenanceOwner} | ${row.releaseState} | ${row.lifecycleState} | ${row.evidenceState} | ${row.asOf} | ${row.evidenceRefs} |`,
        ''
    ].join('\n')
}

function featureInventoryV1Document() {
    return [
        '# 06 — 功能清单',
        '',
        '> FeatureInventorySchemaV1',
        '',
        '| 能力 ID | 能力组 | 公开面 | 配置入口 | 主要消费者 | 文档入口 | 验证路线 | 事实来源 | 维护责任 | 发布状态 |',
        '|---|---|---|---|---|---|---|---|---|---|',
        '| cli-main | CLI | `devcodex` | 命令参数 | CLI 用户 | `README.md` | `node test.js` | package.json#bin.devcodex | 项目维护者 | unverified |',
        ''
    ].join('\n')
}

function runValidateWithArgs(workspaceRoot, extraArgs) {
    return spawnSync(process.execPath, [SCRIPT].concat(extraArgs), {
        cwd: workspaceRoot,
        encoding: 'utf8'
    })
}

function runValidateAll(workspaceRoot) {
    return spawnSync(process.execPath, [ALL_SCRIPT, '--workspace', workspaceRoot], {
        cwd: workspaceRoot,
        encoding: 'utf8'
    })
}

function createWorkspaceNamespaceWorkspace(projectInfo) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-validate-profile-ws-'))
    TEMP_ROOTS.push(root)

    writeFile(root, 'package.json', JSON.stringify({ name: PACKAGE_NAME }, null, 2))
    writeFile(root, '.devcodex/layout.json', JSON.stringify({ version: 1, mode: 'workspace-namespace' }, null, 2))
    writeFile(root, '.devcodex/workspace/profile/README.md', '# README\n\n- Profile 档位：profile-lite。\n')
    writeFile(root, '.devcodex/workspace/profile/02-架构约束.md', '# 02\n')
    writeFile(root, '.devcodex/workspace/profile/03-代码风格.md', '# 03\n')
    writeFile(root, '.devcodex/workspace/profile/config.json', JSON.stringify({
        mode: 'dev',
        agent: 'claude-code',
        pluginVersion: VERSION
    }, null, 2))
    writeFile(root, '.devcodex/workspace/profile/01-项目信息.md', projectInfo)
    fs.mkdirSync(path.join(root, 'chat'), { recursive: true })

    return root
}

function createClosedLoopWorkspaceNamespace(projectInfo) {
    const root = createWorkspaceNamespaceWorkspace(projectInfo)
    writeFile(root, '.devcodex/workspace/profile/README.md', [
        '# README',
        '',
        '- Profile 档位：profile-closed-loop。',
        '- 生命周期：01~03 为稳定基线；04~07 为活文档；config.local.json 与 08+ 为条件 / 本地文档。'
    ].join('\n'))
    writeFile(root, '.devcodex/workspace/profile/04-测试规范.md', '# 04 — 测试规范\n')
    writeFile(root, '.devcodex/workspace/profile/05-发布规范.md', '# 05 — 发布规范\n')
    writeFile(root, '.devcodex/workspace/profile/06-功能清单.md', featureInventoryDocument())
    writeFile(root, '.devcodex/workspace/profile/07-用户文档与契约规范.md', '# 07 — 用户文档与契约规范\n')
    return root
}

function legacyProjectInfo() {
    return [
        '# 01 — 项目信息',
        '',
        '| 项目 | 值 |',
        '|------|----|',
        `| **当前版本** | ${VERSION} |`,
        `| **当前阶段** | ${VERSION} |`,
        '',
        '```',
        'devcodex/skills/        →   .github/skills/',
        'devcodex/instructions/  →   .github/instructions/',
        'devcodex/prompts/       →   .github/prompts/',
        'devcodex/data/          →   .github/data/',
        'devcodex/instructions.md → .github/copilot-instructions.md',
        'devcodex/RULES.md       →   .github/RULES.md',
        '```',
        '',
        '> 说明：`devcodex/agents/` 仍保留在源码仓中，但不再作为目标项目默认分发路径。',
        '',
        '## 授权层级',
        '',
        '| 层级 | 功能范围 |',
        '|------|---------|',
        '| **Free** | dev |',
        '| **Pro** | self-fix |',
        ''
    ].join('\n')
}

function currentProjectInfo() {
    return [
        '# 01 — 项目信息',
        '',
        '| 项目 | 值 |',
        '|------|----|',
        `| **当前版本** | ${VERSION} |`,
        `| **当前阶段** | ${VERSION} |`,
        '| **需求总览** | `website/docs/versions/v1/<active-version>/requirements/index.md` — 当前活跃版本的 P0/P1/P2 分层总览 |',
        '',
        '## GlobalOnlyHostConfigModeV1 + GlobalOnlyWorkspaceCleanModeV1',
        '',
        '- `npm install -g devcodex` 配置六宿主用户级 adapter。',
        '- 共享 full fallback 与 Skills 写入用户级 `.agents/devcodex/` 与 `.agents/skills/`。',
        '- `agents/` 保留为包内源资产，不向 workspace 分发。',
        '- workspace 不生成任何宿主目录、`.agents`、根级宿主入口或 `.mcp.json`，只保留 `.devcodex`。',
        '',
        '## 授权状态',
        '',
        '- 当前 `token-check` 仅为授权占位，不执行 tier 阻断。',
        '- 所有工作流和子类型当前全量开放。',
        '',
        '## 本地配置说明（可选）',
        '',
        '- `config.local.json` 用于用户 / 项目指定的本地 overlay，不覆盖 `mode` / `agent`。',
        '- 敏感信息、明文连接信息和硬编码默认允许；只有用户 / 项目要求时才使用 env、`*Env` 字段或 secretRef。',
        '- 若使用 `extensions.<namespace>`，需在本文件或 Profile README 说明字段语义。',
        '- Auto 别名全局默认 `@rocky`；`config.json` 可配置 `extensions.devcodex.autoAliases` 替换默认别名，空数组表示关闭默认别名。',
        '- `config.json` 可配置 `extensions.devcodex.concurrency` 并发策略：默认 `auto`，保守项目可设 `serial`，核心单写者锁不可删除。',
        ''
    ].join('\n')
}

function createClosedLoopWorkspace(lifecycle, readmeExtras = []) {
    const root = createWorkspace(currentProjectInfo())
    writeFile(root, '.devcodex/profile/README.md', [
        '# README',
        '',
        '- Profile 档位：profile-closed-loop。',
        `- 生命周期：${lifecycle}。`,
        ...readmeExtras
    ].join('\n'))
    writeFile(root, '.devcodex/profile/04-测试规范.md', '# 04 — 测试规范\n')
    writeFile(root, '.devcodex/profile/05-发布规范.md', '# 05 — 发布规范\n')
    writeFile(root, '.devcodex/profile/06-功能清单.md', featureInventoryDocument())
    writeFile(root, '.devcodex/profile/07-用户文档与契约规范.md', '# 07 — 用户文档与契约规范\n')
    return root
}

function validLocalConfig() {
    return JSON.stringify({
        connections: {
            reporting: {
                kind: 'postgres',
                description: '本地报表库只读连接',
                host: '127.0.0.1',
                port: 5432,
                database: 'analytics',
                username: 'reporting_user',
                password: 'local-password-placeholder',
                readonly: true
            }
        }
    }, null, 2)
}

function validUserSpecifiedEnvLocalConfig() {
    return JSON.stringify({
        connections: {
            reporting: {
                kind: 'postgres',
                description: '用户明确指定 env 的报表库连接',
                urlEnv: 'REPORTING_DB_URL',
                passwordEnv: 'REPORTING_DB_PASSWORD'
            }
        },
        extensions: {
            'docs-runtime': {
                description: '用户明确指定 env/secretRef 的本地文档运行时扩展',
                refs: {
                    tokenEnv: 'DOCS_RUNTIME_TOKEN',
                    secretRef: 'op://team/docs/runtime'
                },
                config: {
                    workspace: 'docs'
                }
            }
        }
    }, null, 2)
}

function validRawSecretLocalConfig() {
    return JSON.stringify({
        connections: {
            reporting: {
                kind: 'postgres',
                description: '本地授权明文字段示例',
                host: '127.0.0.1',
                port: 5432,
                database: 'analytics',
                username: 'reporting_user',
                password: 'local-password-placeholder',
                apiKey: 'local-api-key-placeholder',
                privateKey: 'local-private-key-placeholder',
                clientSecret: 'local-client-secret-placeholder',
                signingKey: 'local-signing-key-placeholder',
                connectionPassword: 'local-connection-password-placeholder',
                connectionString: 'postgres://reporting_user:local-password-placeholder@127.0.0.1:5432/analytics'
            }
        }
    }, null, 2)
}

function invalidLocalConfig() {
    return JSON.stringify({
        mode: 'prod',
        connections: {
            broken: {
                port: '5432'
            }
        }
    }, null, 2)
}

function staleS02ProfileText() {
    return [
        '# 02',
        '',
        '- 该例外仅适用于当前私有项目上下文，不可推广为通用规范，也不改变 S02 对其他敏感信息的默认禁止规则。'
    ].join('\n')
}

function currentAssetInventoryDocument(overrides = {}) {
    function recursiveJsCount(root) {
        return fs.readdirSync(root, { withFileTypes: true }).reduce((count, entry) => {
            if (entry.isDirectory()) return count + recursiveJsCount(path.join(root, entry.name))
            return count + (entry.isFile() && entry.name.endsWith('.js') ? 1 : 0)
        }, 0)
    }
    const counts = {
        Agent: fs.readdirSync(path.join(ROOT, 'agents')).filter(name => name.endsWith('.agent.md')).length,
        Skill: fs.readdirSync(path.join(ROOT, 'content', 'skills'), { withFileTypes: true })
            .filter(entry => entry.isDirectory() && !entry.name.startsWith('_')).length,
        Instruction: fs.readdirSync(path.join(ROOT, 'content', 'instructions')).filter(name => name.endsWith('.instructions.md')).length,
        Prompt: fs.readdirSync(path.join(ROOT, 'content', 'prompts')).filter(name => name.endsWith('.prompt.md')).length,
        'Hooks runtime': fs.readdirSync(path.join(ROOT, 'hooks', '_runtime')).filter(name => name.endsWith('.cjs')).length,
        'data 模板': fs.readdirSync(path.join(ROOT, 'data', 'templates')).filter(name => name.endsWith('.md')).length,
        'CLI 工程脚本': recursiveJsCount(path.join(ROOT, 'scripts')),
        ...overrides
    }
    return [
        '## 当前规范资产清单',
        '',
        '| 类型 | 数量 | 文件列表 |',
        '|---|---:|---|',
        ...Object.entries(counts).map(([label, count]) => `| **${label}** | ${count} | machine truth |`),
        ''
    ].join('\n')
}

function main() {
    try {
        const legacyRoot = createWorkspace(legacyProjectInfo())
        const legacyResult = runValidateWithArgs(legacyRoot, ['--source-repo-profile'])
        const legacyOutput = `${legacyResult.stdout}\n${legacyResult.stderr}`

        assert.strictEqual(legacyResult.status, 2, legacyOutput)
        assert.match(legacyOutput, /legacy agents distribution wording/)
        assert.match(legacyOutput, /legacy Free\/Pro authorization tiers/)
        assert.match(legacyOutput, /current formal requirement entry/)

        const currentRoot = createWorkspace(currentProjectInfo())
        const currentResult = runValidateWithArgs(currentRoot, ['--source-repo-profile'])
        const currentOutput = `${currentResult.stdout}\n${currentResult.stderr}`

        assert.strictEqual(currentResult.status, 0, currentOutput)

        const alignedAssetRoot = createWorkspace(`${currentProjectInfo()}\n${currentAssetInventoryDocument()}`)
        const alignedAssetResult = runValidateWithArgs(alignedAssetRoot, ['--source-repo-profile'])
        assert.strictEqual(alignedAssetResult.status, 0, `${alignedAssetResult.stdout}\n${alignedAssetResult.stderr}`)

        const staleAssetRoot = createWorkspace(`${currentProjectInfo()}\n${currentAssetInventoryDocument({
            'Hooks runtime': fs.readdirSync(path.join(ROOT, 'hooks', '_runtime')).filter(name => name.endsWith('.cjs')).length - 1
        })}`)
        const staleAssetResult = runValidateWithArgs(staleAssetRoot, ['--source-repo-profile'])
        const staleAssetOutput = `${staleAssetResult.stdout}\n${staleAssetResult.stderr}`
        assert.strictEqual(staleAssetResult.status, 1, staleAssetOutput)
        assert.match(staleAssetOutput, /CurrentAssetInventoryTruthGate Hooks runtime drift/)

        const nonSourceRoot = createWorkspace(currentProjectInfo().replaceAll(VERSION, '3.0.0'))
        writeFile(nonSourceRoot, 'package.json', JSON.stringify({
            name: 'sample-non-source-project',
            version: '3.0.0'
        }, null, 2))
        const nonSourceResult = runValidateWithArgs(nonSourceRoot, ['--project-root', nonSourceRoot])
        const nonSourceOutput = `${nonSourceResult.stdout}\n${nonSourceResult.stderr}`

        assert.strictEqual(nonSourceResult.status, 0, nonSourceOutput)
        assert.doesNotMatch(nonSourceOutput, /当前版本漂移|当前阶段漂移/)

        const samePackageNonSourceRoot = createWorkspace(currentProjectInfo().replaceAll(VERSION, '2.0.0'))
        writeFile(samePackageNonSourceRoot, 'package.json', JSON.stringify({
            name: 'devcodex',
            version: '1.7.0'
        }, null, 2))
        const samePackageNonSourceResult = runValidateWithArgs(samePackageNonSourceRoot, ['--project-root', samePackageNonSourceRoot])
        const samePackageNonSourceOutput = `${samePackageNonSourceResult.stdout}\n${samePackageNonSourceResult.stderr}`

        assert.strictEqual(samePackageNonSourceResult.status, 0, samePackageNonSourceOutput)
        assert.doesNotMatch(samePackageNonSourceOutput, /当前版本漂移|当前阶段漂移/)

        const sourceVersionDriftRoot = createWorkspace(currentProjectInfo().replaceAll(VERSION, '0.0.0'))
        const sourceVersionDriftResult = runValidateWithArgs(sourceVersionDriftRoot, ['--source-repo-profile'])
        const sourceVersionDriftOutput = `${sourceVersionDriftResult.stdout}\n${sourceVersionDriftResult.stderr}`

        assert.strictEqual(sourceVersionDriftResult.status, 2, sourceVersionDriftOutput)
        assert.match(sourceVersionDriftOutput, /当前版本漂移: 0\.0\.0/)
        assert.match(sourceVersionDriftOutput, /当前阶段漂移: 0\.0\.0/)

        const staleCurrentConsumerRoot = createWorkspace(currentProjectInfo())
        writeFile(staleCurrentConsumerRoot, '.devcodex/profile/07-用户文档与契约规范.md', [
            '# 07',
            '',
            '> 当前发布基线：v0.0.0。',
            '',
            '| 契约 | 来源 |',
            '|---|---|',
            '| 版本语义契约 | package `0.0.0` release truth |',
            '| v0.0.0 发布分发 | 当前 GitHub Packages 分发 |'
        ].join('\n'))
        const staleCurrentConsumerResult = runValidateWithArgs(staleCurrentConsumerRoot, ['--source-repo-profile'])
        const staleCurrentConsumerOutput = `${staleCurrentConsumerResult.stdout}\n${staleCurrentConsumerResult.stderr}`
        assert.strictEqual(staleCurrentConsumerResult.status, 2, staleCurrentConsumerOutput)
        assert.match(staleCurrentConsumerOutput, /ProfileReleaseTruthAuthorityMatrixGate 07-用户文档与契约规范\.md 当前发布基线漂移/)

        const staleCurrentFactsRoot = createWorkspace(`${currentProjectInfo()}\n## 发布关键字段\n\n| 字段 | 当前事实 |\n|---|---|\n| **tag/publish 触发链** | v0.0.0 已发布 |\n| **registry/tag 验收** | v0.0.0 R7 已验证 |\n`)
        const staleCurrentFactsResult = runValidateWithArgs(staleCurrentFactsRoot, ['--source-repo-profile'])
        const staleCurrentFactsOutput = `${staleCurrentFactsResult.stdout}\n${staleCurrentFactsResult.stderr}`
        assert.strictEqual(staleCurrentFactsResult.status, 2, staleCurrentFactsOutput)
        assert.match(staleCurrentFactsOutput, /01-项目信息\.md tag\/publish 触发链漂移/)
        assert.match(staleCurrentFactsOutput, /01-项目信息\.md registry\/tag 验收漂移/)

        const duplicateCurrentFactsRoot = createWorkspace(`${currentProjectInfo()}\n| **tag/publish 触发链** | v${VERSION} 已发布 |\n| **tag/publish 触发链** | v${VERSION} 重复事实 |\n`)
        const duplicateCurrentFactsResult = runValidateWithArgs(duplicateCurrentFactsRoot, ['--source-repo-profile'])
        const duplicateCurrentFactsOutput = `${duplicateCurrentFactsResult.stdout}\n${duplicateCurrentFactsResult.stderr}`
        assert.strictEqual(duplicateCurrentFactsResult.status, 2, duplicateCurrentFactsOutput)
        assert.match(duplicateCurrentFactsOutput, /duplicates current claim tag\/publish 触发链: 2/)

        const alignedCurrentConsumerRoot = createWorkspace(currentProjectInfo())
        writeFile(alignedCurrentConsumerRoot, '.devcodex/profile/07-用户文档与契约规范.md', `# 07\n\n> 当前发布基线：v${VERSION}。\n`)
        const alignedCurrentConsumerResult = runValidateWithArgs(alignedCurrentConsumerRoot, ['--source-repo-profile'])
        assert.strictEqual(alignedCurrentConsumerResult.status, 0, `${alignedCurrentConsumerResult.stdout}\n${alignedCurrentConsumerResult.stderr}`)

        const staleFeatureReleaseRoot = createClosedLoopWorkspace('stable baseline / living document / conditional-required local docs')
        writeFile(staleFeatureReleaseRoot, '.devcodex/profile/06-功能清单.md', featureInventoryDocument({
            releaseState: 'unreleased-after-v0.0.0',
            lifecycleState: 'validated',
            evidenceState: 'validated'
        }))
        const staleFeatureReleaseResult = runValidateWithArgs(staleFeatureReleaseRoot, ['--source-repo-profile'])
        const staleFeatureReleaseOutput = `${staleFeatureReleaseResult.stdout}\n${staleFeatureReleaseResult.stderr}`
        assert.strictEqual(staleFeatureReleaseResult.status, 2, staleFeatureReleaseOutput)
        assert.match(staleFeatureReleaseOutput, /release state lags current package for cli-main/)

        const staleValidationCountsRoot = createClosedLoopWorkspace('stable baseline / living document / conditional-required local docs')
        writeFile(staleValidationCountsRoot, '.devcodex/profile/06-功能清单.md', featureInventoryDocument({
            featureId: 'validation-execution',
            validationRoute: 'DAG negatives；89 nodes / full 87'
        }))
        const staleValidationCountsResult = runValidateWithArgs(staleValidationCountsRoot, ['--source-repo-profile'])
        const staleValidationCountsOutput = `${staleValidationCountsResult.stdout}\n${staleValidationCountsResult.stderr}`
        assert.strictEqual(staleValidationCountsResult.status, 2, staleValidationCountsOutput)
        assert.match(staleValidationCountsOutput, /ValidationRouteTruthGate validation-execution uses a legacy or missing count claim/)

        const historicalReleaseRoot = createWorkspace(currentProjectInfo())
        writeFile(historicalReleaseRoot, '.devcodex/profile/07-用户文档与契约规范.md', '# 07\n\n- 历史发布：package 0.0.0 release truth。\n')
        const historicalReleaseResult = runValidateWithArgs(historicalReleaseRoot, ['--source-repo-profile'])
        assert.strictEqual(historicalReleaseResult.status, 0, `${historicalReleaseResult.stdout}\n${historicalReleaseResult.stderr}`)

        const staleWorkspaceAuthorityRoot = createWorkspaceNamespaceWorkspace([
            '# Workspace 项目信息',
            '',
            '| 项目 | 内容 |',
            '|---|---|',
            '| **当前版本** | 0.0.0（DevCodex 工作区规范版本；workspace 本身无独立包版本） |',
            '| **当前阶段** | 0.0.0（DevCodex 工作区规范版本基线） |'
        ].join('\n'))
        const staleWorkspaceAuthorityResult = runValidate(path.join(staleWorkspaceAuthorityRoot, 'chat'))
        const staleWorkspaceAuthorityOutput = `${staleWorkspaceAuthorityResult.stdout}\n${staleWorkspaceAuthorityResult.stderr}`
        assert.strictEqual(staleWorkspaceAuthorityResult.status, 2, staleWorkspaceAuthorityOutput)
        assert.match(staleWorkspaceAuthorityOutput, /workspace\/01-项目信息\.md 当前版本漂移/)

        const standardRoot = createWorkspace(currentProjectInfo())
        writeFile(standardRoot, '.devcodex/profile/README.md', [
            '# README',
            '',
            '- Profile 档位：profile-standard。',
            '- `config.local.json`：本地私有 overlay。',
            '- `extensions.<namespace>`：扩展位需在 Profile 中说明。'
        ].join('\n'))
        writeFile(standardRoot, '.devcodex/profile/04-测试规范.md', '# 04 — 测试规范\n')
        writeFile(standardRoot, '.devcodex/profile/05-发布规范.md', '# 05 — 发布规范\n')
        writeFile(standardRoot, '.devcodex/profile/06-功能清单.md', featureInventoryDocument())
        const standardResult = runValidate(standardRoot)
        const standardOutput = `${standardResult.stdout}\n${standardResult.stderr}`

        assert.strictEqual(standardResult.status, 0, standardOutput)

        const standardLegacyRoot = createWorkspace(currentProjectInfo())
        writeFile(standardLegacyRoot, '.devcodex/profile/README.md', '# README\n\n- Profile 档位：profile-standard。\n')
        writeFile(standardLegacyRoot, '.devcodex/profile/04-测试规范.md', '# 04 — 测试规范\n')
        writeFile(standardLegacyRoot, '.devcodex/profile/05-发布规范.md', '# 05 — 发布规范\n')
        writeFile(standardLegacyRoot, '.devcodex/profile/06-功能清单.md', '# 06\n\n| 能力组 | 当前口径 | 主要证据 | 验证路线 |\n|---|---|---|---|\n| CLI | 已发布命令 | package.json#bin | npm test |\n')
        const standardLegacyResult = runValidate(standardLegacyRoot)
        assert.strictEqual(standardLegacyResult.status, 0, `${standardLegacyResult.stdout}\n${standardLegacyResult.stderr}`)

        const standardBulletsRoot = createWorkspace(currentProjectInfo())
        writeFile(standardBulletsRoot, '.devcodex/profile/README.md', '# README\n\n- Profile 档位：profile-standard。\n')
        writeFile(standardBulletsRoot, '.devcodex/profile/04-测试规范.md', '# 04 — 测试规范\n')
        writeFile(standardBulletsRoot, '.devcodex/profile/05-发布规范.md', '# 05 — 发布规范\n')
        writeFile(standardBulletsRoot, '.devcodex/profile/06-功能清单.md', '# 06 — 功能清单\n\n- CLI\n- Profile\n')
        const standardBulletsResult = runValidate(standardBulletsRoot)
        const standardBulletsOutput = `${standardBulletsResult.stdout}\n${standardBulletsResult.stderr}`

        assert.strictEqual(standardBulletsResult.status, 1, standardBulletsOutput)
        assert.match(standardBulletsOutput, /requires a structured Markdown table/)

        const conflictingTierRoot = createWorkspace(currentProjectInfo())
        writeFile(conflictingTierRoot, '.devcodex/profile/README.md', [
            '# README',
            '',
            '- Profile 档位：profile-lite。',
            '- Profile tier: profile-standard.'
        ].join('\n'))
        const conflictingTierResult = runValidate(conflictingTierRoot)
        const conflictingTierOutput = `${conflictingTierResult.stdout}\n${conflictingTierResult.stderr}`

        assert.strictEqual(conflictingTierResult.status, 1, conflictingTierOutput)
        assert.match(conflictingTierOutput, /multiple project-local profile tiers declared/)

        const closedLoopMissingRoot = createWorkspace(currentProjectInfo())
        writeFile(closedLoopMissingRoot, '.devcodex/profile/README.md', [
            '# README',
            '',
            '- Profile 档位：profile-closed-loop。',
            '- 生命周期：stable baseline / living document / conditional-required local docs。',
            '- FeatureInventoryProfileGate 来源：待补 `06-功能清单.md`。'
        ].join('\n'))
        writeFile(closedLoopMissingRoot, '.devcodex/profile/04-测试规范.md', '# 04 — 测试规范\n')
        writeFile(closedLoopMissingRoot, '.devcodex/profile/05-交付发布规范.md', '# 05 — 交付发布规范\n')
        const closedLoopMissingResult = runValidate(closedLoopMissingRoot)
        const closedLoopMissingOutput = `${closedLoopMissingResult.stdout}\n${closedLoopMissingResult.stderr}`

        assert.strictEqual(closedLoopMissingResult.status, 1, closedLoopMissingOutput)
        assert.match(closedLoopMissingOutput, /profile-closed-loop requires 06-功能清单\.md/)
        assert.match(closedLoopMissingOutput, /profile-closed-loop requires 07-用户文档与契约规范\.md/)

        const closedLoopRoot = createWorkspace(currentProjectInfo())
        writeFile(closedLoopRoot, '.devcodex/profile/README.md', [
            '# README',
            '',
            '- Profile 档位：profile-closed-loop。',
            '- 生命周期：stable baseline / living document / conditional-required local docs。'
        ].join('\n'))
        writeFile(closedLoopRoot, '.devcodex/profile/04-测试规范.md', '# 04 — 测试规范\n')
        writeFile(closedLoopRoot, '.devcodex/profile/05-交付发布规范.md', '# 05 — 交付发布规范\n')
        writeFile(closedLoopRoot, '.devcodex/profile/06-功能清单.md', featureInventoryDocument())
        writeFile(closedLoopRoot, '.devcodex/profile/07-用户文档与契约规范.md', '# 07 — 用户文档与契约规范\n')
        const closedLoopResult = runValidate(closedLoopRoot)
        const closedLoopOutput = `${closedLoopResult.stdout}\n${closedLoopResult.stderr}`

        assert.strictEqual(closedLoopResult.status, 0, closedLoopOutput)

        const compatibleV1Root = createClosedLoopWorkspace('stable baseline / living document / conditional-required local docs')
        writeFile(compatibleV1Root, '.devcodex/profile/06-功能清单.md', featureInventoryV1Document())
        const compatibleV1Result = runValidate(compatibleV1Root)
        assert.strictEqual(compatibleV1Result.status, 0, `${compatibleV1Result.stdout}\n${compatibleV1Result.stderr}`)

        for (const invalidV2 of [
            { overrides: { lifecycleState: 'published-by-doc' }, expected: /invalid lifecycleState/ },
            { overrides: { evidenceState: 'claimed' }, expected: /invalid evidenceState/ },
            { overrides: { asOf: 'today' }, expected: /invalid asOf/ },
            { overrides: { evidenceRefs: '' }, expected: /missing evidenceRefs/ }
        ]) {
            const invalidV2Root = createClosedLoopWorkspace('stable baseline / living document / conditional-required local docs')
            writeFile(invalidV2Root, '.devcodex/profile/06-功能清单.md', featureInventoryDocument(invalidV2.overrides))
            const invalidV2Result = runValidate(invalidV2Root)
            const invalidV2Output = `${invalidV2Result.stdout}\n${invalidV2Result.stderr}`
            assert.strictEqual(invalidV2Result.status, 1, invalidV2Output)
            assert.match(invalidV2Output, invalidV2.expected)
        }

        const closedLoopChineseRoot = createClosedLoopWorkspace('01~03 为稳定基线；04~07 为活文档；config.local.json 与 08+ 为条件 / 本地文档')
        const closedLoopChineseResult = runValidate(closedLoopChineseRoot)
        assert.strictEqual(
            closedLoopChineseResult.status,
            0,
            `${closedLoopChineseResult.stdout}\n${closedLoopChineseResult.stderr}`
        )

        const lifecycleDiagnosticCases = [
            {
                name: 'stable-baseline',
                lifecycle: 'living document / conditional-required local docs',
                expected: 'stable-baseline'
            },
            {
                name: 'living-document',
                lifecycle: 'stable baseline / conditional-required local docs',
                expected: 'living-document'
            },
            {
                name: 'conditional-or-local-docs',
                lifecycle: 'stable baseline / living document',
                extras: [
                    '- 本地命令：npm test。',
                    '- required checks remain enabled。',
                    '- conditional workflows are documented elsewhere。'
                ],
                expected: 'conditional-or-local-docs'
            }
        ]
        for (const diagnosticCase of lifecycleDiagnosticCases) {
            const diagnosticRoot = createClosedLoopWorkspace(diagnosticCase.lifecycle, diagnosticCase.extras)
            const diagnosticResult = runValidate(diagnosticRoot)
            const diagnosticOutput = `${diagnosticResult.stdout}\n${diagnosticResult.stderr}`
            assert.strictEqual(diagnosticResult.status, 1, `${diagnosticCase.name}: ${diagnosticOutput}`)
            assert.match(diagnosticOutput, new RegExp(`lifecycle missing ${diagnosticCase.expected}`))
            for (const category of ['stable-baseline', 'living-document', 'conditional-or-local-docs']) {
                if (category === diagnosticCase.expected) continue
                assert.doesNotMatch(diagnosticOutput, new RegExp(`lifecycle missing ${category}`))
            }
        }

        const missingColumnsRoot = createWorkspace(currentProjectInfo())
        writeFile(missingColumnsRoot, '.devcodex/profile/README.md', '# README\n\n- Profile 档位：profile-closed-loop。\n- 生命周期：stable baseline / living document / conditional-required local docs。\n')
        writeFile(missingColumnsRoot, '.devcodex/profile/04-测试规范.md', '# 04\n')
        writeFile(missingColumnsRoot, '.devcodex/profile/05-发布规范.md', '# 05\n')
        writeFile(missingColumnsRoot, '.devcodex/profile/06-功能清单.md', '# 06\n\n> FeatureInventorySchemaV1\n\n| 能力 | 公开面 | 消费者 | 验证路线 |\n|---|---|---|---|\n| CLI | devcodex | users | test |\n')
        writeFile(missingColumnsRoot, '.devcodex/profile/07-用户文档与契约规范.md', '# 07\n')
        const missingColumnsResult = runValidate(missingColumnsRoot)
        const missingColumnsOutput = `${missingColumnsResult.stdout}\n${missingColumnsResult.stderr}`
        assert.strictEqual(missingColumnsResult.status, 1, missingColumnsOutput)
        assert.match(missingColumnsOutput, /must contain columns/)

        const emptyInventoryRoot = createWorkspace(currentProjectInfo())
        writeFile(emptyInventoryRoot, '.devcodex/profile/README.md', '# README\n\n- Profile 档位：profile-closed-loop。\n- 生命周期：stable baseline / living document / conditional-required local docs。\n')
        writeFile(emptyInventoryRoot, '.devcodex/profile/04-测试规范.md', '# 04\n')
        writeFile(emptyInventoryRoot, '.devcodex/profile/05-发布规范.md', '# 05\n')
        writeFile(emptyInventoryRoot, '.devcodex/profile/06-功能清单.md', '# 06\n\n> FeatureInventorySchemaV1\n\n| 能力 ID | 能力组 | 公开面 | 配置入口 | 主要消费者 | 文档入口 | 验证路线 | 事实来源 | 维护责任 | 发布状态 |\n|---|---|---|---|---|---|---|---|---|---|\n')
        writeFile(emptyInventoryRoot, '.devcodex/profile/07-用户文档与契约规范.md', '# 07\n')
        const emptyInventoryResult = runValidate(emptyInventoryRoot)
        const emptyInventoryOutput = `${emptyInventoryResult.stdout}\n${emptyInventoryResult.stderr}`
        assert.strictEqual(emptyInventoryResult.status, 1, emptyInventoryOutput)
        assert.match(emptyInventoryOutput, /at least one non-placeholder row with source evidence/)

        const placeholderOnlyRoot = createWorkspace(currentProjectInfo())
        writeFile(placeholderOnlyRoot, '.devcodex/profile/README.md', '# README\n\n- Profile 档位：profile-closed-loop。\n- 生命周期：stable baseline / living document / conditional-required local docs。\n')
        writeFile(placeholderOnlyRoot, '.devcodex/profile/04-测试规范.md', '# 04\n')
        writeFile(placeholderOnlyRoot, '.devcodex/profile/05-发布规范.md', '# 05\n')
        writeFile(placeholderOnlyRoot, '.devcodex/profile/06-功能清单.md', featureInventoryDocument({ featureId: '待补充', sourceEvidence: '待补充' }))
        writeFile(placeholderOnlyRoot, '.devcodex/profile/07-用户文档与契约规范.md', '# 07\n')
        const placeholderOnlyResult = runValidate(placeholderOnlyRoot)
        const placeholderOnlyOutput = `${placeholderOnlyResult.stdout}\n${placeholderOnlyResult.stderr}`
        assert.strictEqual(placeholderOnlyResult.status, 1, placeholderOnlyOutput)
        assert.match(placeholderOnlyOutput, /at least one non-placeholder row with source evidence/)

        const fakeSourceRoot = createWorkspace(currentProjectInfo())
        writeFile(fakeSourceRoot, '.devcodex/profile/README.md', '# README\n\n- Profile 档位：profile-standard。\n- Feature inventory source: `missing/features.md`\n')
        writeFile(fakeSourceRoot, '.devcodex/profile/04-测试规范.md', '# 04\n')
        writeFile(fakeSourceRoot, '.devcodex/profile/05-发布规范.md', '# 05\n')
        const fakeSourceResult = runValidate(fakeSourceRoot)
        const fakeSourceOutput = `${fakeSourceResult.stdout}\n${fakeSourceResult.stderr}`
        assert.strictEqual(fakeSourceResult.status, 1, fakeSourceOutput)
        assert.match(fakeSourceOutput, /feature inventory source not found/)

        const externalLegacyRoot = createWorkspace(currentProjectInfo())
        writeFile(externalLegacyRoot, '.devcodex/profile/README.md', '# README\n\n- Profile 档位：profile-standard。\n- Feature inventory source: `inventory/features.md`\n')
        writeFile(externalLegacyRoot, '.devcodex/profile/04-测试规范.md', '# 04\n')
        writeFile(externalLegacyRoot, '.devcodex/profile/05-发布规范.md', '# 05\n')
        writeFile(externalLegacyRoot, '.devcodex/profile/inventory/features.md', '| 能力组 | 当前口径 | 主要证据 | 验证路线 |\n|---|---|---|---|\n| CLI | 已发布命令 | package.json#bin | npm test |\n')
        const externalLegacyResult = runValidate(externalLegacyRoot)
        assert.strictEqual(externalLegacyResult.status, 0, `${externalLegacyResult.stdout}\n${externalLegacyResult.stderr}`)

        const duplicateCanonicalRoot = createWorkspace(currentProjectInfo() + '\n' + featureInventoryDocument({ releaseState: 'unreleased' }))
        writeFile(duplicateCanonicalRoot, '.devcodex/profile/README.md', '# README\n\n- Profile 档位：profile-closed-loop。\n- 生命周期：stable baseline / living document / conditional-required local docs。\n')
        writeFile(duplicateCanonicalRoot, '.devcodex/profile/04-测试规范.md', '# 04\n')
        writeFile(duplicateCanonicalRoot, '.devcodex/profile/05-发布规范.md', '# 05\n')
        writeFile(duplicateCanonicalRoot, '.devcodex/profile/06-功能清单.md', featureInventoryDocument({ releaseState: 'v1.0.0' }))
        writeFile(duplicateCanonicalRoot, '.devcodex/profile/07-用户文档与契约规范.md', '# 07\n')
        const duplicateCanonicalResult = runValidate(duplicateCanonicalRoot)
        const duplicateCanonicalOutput = `${duplicateCanonicalResult.stdout}\n${duplicateCanonicalResult.stderr}`
        assert.strictEqual(duplicateCanonicalResult.status, 1, duplicateCanonicalOutput)
        assert.match(duplicateCanonicalOutput, /01-项目信息\.md must not duplicate/)

        const releaseStateConflictRoot = createWorkspace(currentProjectInfo())
        writeFile(releaseStateConflictRoot, '.devcodex/profile/README.md', '# README\n\n- Profile 档位：profile-closed-loop。\n- 生命周期：stable baseline / living document / conditional-required local docs。\n')
        writeFile(releaseStateConflictRoot, '.devcodex/profile/01-项目信息.md', '# 01\n\n- cli-main：未发布\n')
        writeFile(releaseStateConflictRoot, '.devcodex/profile/04-测试规范.md', '# 04\n')
        writeFile(releaseStateConflictRoot, '.devcodex/profile/05-发布规范.md', '# 05\n')
        writeFile(releaseStateConflictRoot, '.devcodex/profile/06-功能清单.md', featureInventoryDocument({ releaseState: 'v1.0.0' }))
        writeFile(releaseStateConflictRoot, '.devcodex/profile/07-用户文档与契约规范.md', '# 07\n')
        const releaseStateConflictResult = runValidate(releaseStateConflictRoot)
        const releaseStateConflictOutput = `${releaseStateConflictResult.stdout}\n${releaseStateConflictResult.stderr}`
        assert.strictEqual(releaseStateConflictResult.status, 1, releaseStateConflictOutput)
        assert.match(releaseStateConflictOutput, /release state conflicts/)

        const validAutoAliasRoot = createWorkspace(currentProjectInfo())
        writeFile(validAutoAliasRoot, '.devcodex/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'claude-code',
            pluginVersion: VERSION,
            extensions: {
                devcodex: {
                    autoAliases: ['@rocky', '@team-maintainer']
                }
            }
        }, null, 2))
        const validAutoAliasResult = runValidate(validAutoAliasRoot)
        const validAutoAliasOutput = `${validAutoAliasResult.stdout}\n${validAutoAliasResult.stderr}`

        assert.strictEqual(validAutoAliasResult.status, 0, validAutoAliasOutput)

        const validConcurrencyRoot = createWorkspace(currentProjectInfo())
        writeFile(validConcurrencyRoot, '.devcodex/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'claude-code',
            pluginVersion: VERSION,
            extensions: {
                devcodex: {
                    concurrency: {
                        mode: 'auto',
                        readOnly: { enabled: true, maxParallel: 4, allowAgents: true },
                        validation: { enabled: true, maxParallel: 2 },
                        locks: { additionalSingleWriterScopes: ['project-cache'] }
                    }
                }
            }
        }, null, 2))
        const validConcurrencyResult = runValidate(validConcurrencyRoot)
        const validConcurrencyOutput = `${validConcurrencyResult.stdout}\n${validConcurrencyResult.stderr}`

        assert.strictEqual(validConcurrencyResult.status, 0, validConcurrencyOutput)

        const serialConcurrencyRoot = createWorkspace(currentProjectInfo())
        writeFile(serialConcurrencyRoot, '.devcodex/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'claude-code',
            pluginVersion: VERSION,
            extensions: {
                devcodex: {
                    concurrency: { mode: 'serial' }
                }
            }
        }, null, 2))
        const serialConcurrencyResult = runValidate(serialConcurrencyRoot)
        const serialConcurrencyOutput = `${serialConcurrencyResult.stdout}\n${serialConcurrencyResult.stderr}`

        assert.strictEqual(serialConcurrencyResult.status, 0, serialConcurrencyOutput)

        const validWorkflowCompletionRoot = createWorkspace(currentProjectInfo())
        writeFile(validWorkflowCompletionRoot, '.devcodex/profile/01-项目信息.md', `${currentProjectInfo()}\n- extensions.devcodex.workflowCompletion.mode controls shadow rollout.\n`)
        writeFile(validWorkflowCompletionRoot, '.devcodex/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'claude-code',
            pluginVersion: VERSION,
            extensions: {
                devcodex: {
                    workflowCompletion: { mode: 'shadow' }
                }
            }
        }, null, 2))
        const validWorkflowCompletionResult = runValidate(validWorkflowCompletionRoot)
        assert.strictEqual(validWorkflowCompletionResult.status, 0, `${validWorkflowCompletionResult.stdout}\n${validWorkflowCompletionResult.stderr}`)

        const invalidWorkflowCompletionRoot = createWorkspace(currentProjectInfo())
        writeFile(invalidWorkflowCompletionRoot, '.devcodex/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'claude-code',
            pluginVersion: VERSION,
            extensions: {
                devcodex: {
                    workflowCompletion: { mode: 'automatic', autoPromote: true }
                }
            }
        }, null, 2))
        const invalidWorkflowCompletionResult = runValidate(invalidWorkflowCompletionRoot)
        const invalidWorkflowCompletionOutput = `${invalidWorkflowCompletionResult.stdout}\n${invalidWorkflowCompletionResult.stderr}`
        assert.strictEqual(invalidWorkflowCompletionResult.status, 1, invalidWorkflowCompletionOutput)
        assert.match(invalidWorkflowCompletionOutput, /workflowCompletion contains unsupported key: autoPromote/)
        assert.match(invalidWorkflowCompletionOutput, /workflowCompletion\.mode must be one of: off, shadow, enforce, rolled-back/)

        const validTaskRecoveryRoot = createWorkspace(`${currentProjectInfo()}\n- extensions.devcodex.taskRecovery.hardLimitMiB 配置 TaskRecoveryStoreV5 的 hard 水位。\n`)
        writeFile(validTaskRecoveryRoot, '.devcodex/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'codex',
            pluginVersion: VERSION,
            extensions: {
                devcodex: {
                    taskRecovery: { hardLimitMiB: 1024 }
                }
            }
        }, null, 2))
        const validTaskRecoveryResult = runValidate(validTaskRecoveryRoot)
        assert.strictEqual(validTaskRecoveryResult.status, 0, `${validTaskRecoveryResult.stdout}\n${validTaskRecoveryResult.stderr}`)

        const invalidTaskRecoveryRoot = createWorkspace(currentProjectInfo())
        writeFile(invalidTaskRecoveryRoot, '.devcodex/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'codex',
            pluginVersion: VERSION,
            extensions: {
                devcodex: {
                    taskRecovery: { hardLimitMiB: 128, disableSlotLimit: true }
                }
            }
        }, null, 2))
        const invalidTaskRecoveryResult = runValidate(invalidTaskRecoveryRoot)
        const invalidTaskRecoveryOutput = `${invalidTaskRecoveryResult.stdout}\n${invalidTaskRecoveryResult.stderr}`
        assert.strictEqual(invalidTaskRecoveryResult.status, 1, invalidTaskRecoveryOutput)
        assert.match(invalidTaskRecoveryOutput, /taskRecovery contains unsupported key: disableSlotLimit/)
        assert.match(invalidTaskRecoveryOutput, /taskRecovery\.hardLimitMiB must be a safe integer >= 512/)

        const invalidConcurrencyRoot = createWorkspace(currentProjectInfo())
        writeFile(invalidConcurrencyRoot, '.devcodex/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'claude-code',
            pluginVersion: VERSION,
            extensions: {
                devcodex: {
                    concurrency: {
                        mode: 'parallel',
                        allowParallelMutations: true,
                        readOnly: { maxParallel: 0 },
                        validation: { maxParallel: 99 },
                        locks: {
                            additionalSingleWriterScopes: ['project-cache', 'project-cache', 'memory'],
                            coreSingleWriterScopes: []
                        },
                        singleWriterScopes: []
                    }
                }
            }
        }, null, 2))
        const invalidConcurrencyResult = runValidate(invalidConcurrencyRoot)
        const invalidConcurrencyOutput = `${invalidConcurrencyResult.stdout}\n${invalidConcurrencyResult.stderr}`

        assert.strictEqual(invalidConcurrencyResult.status, 1, invalidConcurrencyOutput)
        assert.match(invalidConcurrencyOutput, /concurrency\.mode must be one of: auto, serial/)
        assert.match(invalidConcurrencyOutput, /allowParallelMutations/)
        assert.match(invalidConcurrencyOutput, /readOnly\.maxParallel must be an integer between 1 and 8/)
        assert.match(invalidConcurrencyOutput, /validation\.maxParallel must be an integer between 1 and 4/)
        assert.match(invalidConcurrencyOutput, /duplicates another additional scope/)
        assert.match(invalidConcurrencyOutput, /must not duplicate a core single-writer scope/)

        const invalidAutoAliasRoot = createWorkspace(currentProjectInfo())
        writeFile(invalidAutoAliasRoot, '.devcodex/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'claude-code',
            pluginVersion: VERSION,
            extensions: {
                devcodex: {
                    autoAliases: ['rocky', '@auto', '@bad alias', '@rocky', '@Rocky']
                }
            }
        }, null, 2))
        const invalidAutoAliasResult = runValidate(invalidAutoAliasRoot)
        const invalidAutoAliasOutput = `${invalidAutoAliasResult.stdout}\n${invalidAutoAliasResult.stderr}`

        assert.strictEqual(invalidAutoAliasResult.status, 1, invalidAutoAliasOutput)
        assert.match(invalidAutoAliasOutput, /exact mention token/)
        assert.match(invalidAutoAliasOutput, /reserved: @auto/)
        assert.match(invalidAutoAliasOutput, /duplicates another alias/)

        const validGitRoot = createWorkspace(`${currentProjectInfo()}\n- extensions.devcodex.git 分支策略：协作事实未知时 no-auto-branch；所有共享 Git 动作显式授权。\n- extensions.devcodex.executionOptimization.mode 执行优化配置。\n`)
        writeFile(validGitRoot, '.devcodex/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'claude-code',
            pluginVersion: VERSION,
            extensions: {
                devcodex: {
                    executionOptimization: { mode: 'full-only' },
                    git: {
                        collaborationMode: 'unverified',
                        branchPolicy: 'no-auto-branch',
                        worktreePolicy: 'explicit-only',
                        crossBranchIntegration: 'unverified',
                        sharedActionsRequireExplicitAuthorization: true
                    }
                }
            }
        }, null, 2))
        const validGitResult = runValidate(validGitRoot)
        assert.strictEqual(validGitResult.status, 0, `${validGitResult.stdout}\n${validGitResult.stderr}`)

        const invalidGitRoot = createWorkspace(`${currentProjectInfo()}\n- extensions.devcodex.git 分支策略。\n- extensions.devcodex.executionOptimization.mode 执行优化配置。\n`)
        writeFile(invalidGitRoot, '.devcodex/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'claude-code',
            pluginVersion: VERSION,
            extensions: {
                devcodex: {
                    executionOptimization: { mode: 'automatic', autoPromote: true },
                    git: {
                        collaborationMode: 'solo',
                        branchPolicy: 'no-auto-branch',
                        worktreePolicy: 'automatic',
                        crossBranchIntegration: 'merge-commit',
                        sharedActionsRequireExplicitAuthorization: false,
                        autoCreateBranch: true
                    }
                }
            }
        }, null, 2))
        const invalidGitResult = runValidate(invalidGitRoot)
        const invalidGitOutput = `${invalidGitResult.stdout}\n${invalidGitResult.stderr}`
        assert.strictEqual(invalidGitResult.status, 1, invalidGitOutput)
        assert.match(invalidGitOutput, /executionOptimization contains unsupported key: autoPromote/)
        assert.match(invalidGitOutput, /executionOptimization\.mode must be one of: safe-auto, full-only/)
        assert.match(invalidGitOutput, /git contains unsupported key: autoCreateBranch/)
        assert.match(invalidGitOutput, /sharedActionsRequireExplicitAuthorization must be true/)
        assert.match(invalidGitOutput, /solo collaboration must use branchPolicy=keep-current/)

        const staleS02Root = createWorkspace(currentProjectInfo())
        writeFile(staleS02Root, '.devcodex/profile/02-架构约束.md', staleS02ProfileText())
        writeFile(staleS02Root, '.devcodex/profile/03-代码风格.md', [
            '# 03',
            '',
            '| 禁止 | 原因 |',
            '|------|------|',
            '| 硬编码 API Key / Token / 密码 | S02 安全底线 |'
        ].join('\n'))
        const staleS02Result = runValidate(staleS02Root)
        const staleS02Output = `${staleS02Result.stdout}\n${staleS02Result.stderr}`

        assert.strictEqual(staleS02Result.status, 2, staleS02Output)
        assert.match(staleS02Output, /legacy S02 default-forbid wording/)
        assert.match(staleS02Output, /default S02 violation/)

        const localConfigRoot = createWorkspace(currentProjectInfo())
        writeFile(localConfigRoot, '.devcodex/profile/config.local.json', validLocalConfig())
        writeFile(localConfigRoot, '.gitignore', '.devcodex/profile/config.local.json\n.devcodex/*/profile/config.local.json\n')
        const localConfigResult = runValidate(localConfigRoot)
        const localConfigOutput = `${localConfigResult.stdout}\n${localConfigResult.stderr}`

        assert.strictEqual(localConfigResult.status, 0, localConfigOutput)

        const explicitEnvLocalRoot = createWorkspace(currentProjectInfo())
        writeFile(explicitEnvLocalRoot, '.devcodex/profile/config.local.json', validUserSpecifiedEnvLocalConfig())
        writeFile(explicitEnvLocalRoot, '.gitignore', '.devcodex/profile/config.local.json\n.devcodex/*/profile/config.local.json\n')
        const explicitEnvLocalResult = runValidate(explicitEnvLocalRoot)
        const explicitEnvLocalOutput = `${explicitEnvLocalResult.stdout}\n${explicitEnvLocalResult.stderr}`

        assert.strictEqual(explicitEnvLocalResult.status, 0, explicitEnvLocalOutput)

        const rawSecretLocalRoot = createWorkspace(currentProjectInfo())
        writeFile(rawSecretLocalRoot, '.devcodex/profile/config.local.json', validRawSecretLocalConfig())
        writeFile(rawSecretLocalRoot, '.gitignore', '.devcodex/profile/config.local.json\n')
        const rawSecretLocalResult = runValidate(rawSecretLocalRoot)
        const rawSecretLocalOutput = `${rawSecretLocalResult.stdout}\n${rawSecretLocalResult.stderr}`

        assert.strictEqual(rawSecretLocalResult.status, 0, rawSecretLocalOutput)

        const invalidLocalRoot = createWorkspace(currentProjectInfo())
        writeFile(invalidLocalRoot, '.devcodex/profile/config.local.json', invalidLocalConfig())
        writeFile(invalidLocalRoot, '.gitignore', '.devcodex/profile/config.local.json\n')
        const invalidLocalResult = runValidate(invalidLocalRoot)
        const invalidLocalOutput = `${invalidLocalResult.stdout}\n${invalidLocalResult.stderr}`

        assert.strictEqual(invalidLocalResult.status, 1, invalidLocalOutput)
        assert.match(invalidLocalOutput, /must not override "mode"/)
        assert.match(invalidLocalOutput, /connections\.broken\.port must be an integer/)

        const workspaceRoot = createWorkspaceNamespaceWorkspace(currentProjectInfo())
        const workspaceChild = path.join(workspaceRoot, 'chat')
        const workspaceResult = runValidate(workspaceChild)
        const workspaceOutput = `${workspaceResult.stdout}\n${workspaceResult.stderr}`

        assert.strictEqual(workspaceResult.status, 0, workspaceOutput)
        assert.doesNotMatch(workspaceOutput, /no \.devcodex\/profile\//)
        assert.doesNotMatch(workspaceOutput, /no profile dir at .*chat[\\/]?.*\.devcodex[\\/]profile/)

        const gitOverlayRoot = createWorkspaceNamespaceWorkspace(`${currentProjectInfo()}\n- extensions.devcodex.git 分支策略与共享动作授权。\n`)
        const gitOverlayProfile = path.join(gitOverlayRoot, '.devcodex', 'chat', 'profile')
        writeFile(gitOverlayRoot, '.devcodex/workspace/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'claude-code',
            pluginVersion: VERSION,
            extensions: {
                devcodex: {
                    git: {
                        collaborationMode: 'unverified',
                        branchPolicy: 'no-auto-branch',
                        worktreePolicy: 'explicit-only',
                        crossBranchIntegration: 'unverified',
                        sharedActionsRequireExplicitAuthorization: true
                    }
                }
            }
        }, null, 2))
        writeFile(gitOverlayRoot, '.devcodex/chat/profile/01-项目信息.md', `${currentProjectInfo()}\n- extensions.devcodex.git 分支策略与共享动作授权。\n`)
        writeFile(gitOverlayRoot, '.devcodex/chat/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'claude-code',
            pluginVersion: VERSION,
            extensions: { devcodex: { git: { collaborationMode: 'solo', branchPolicy: 'keep-current' } } }
        }, null, 2))
        const validGitOverlayResult = runValidateWithArgs(path.join(gitOverlayRoot, 'chat'), [
            '--profile-dir', gitOverlayProfile,
            '--workspace-profile', path.join(gitOverlayRoot, '.devcodex', 'workspace', 'profile')
        ])
        assert.strictEqual(validGitOverlayResult.status, 0, `${validGitOverlayResult.stdout}\n${validGitOverlayResult.stderr}`)

        writeFile(gitOverlayRoot, '.devcodex/chat/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'claude-code',
            pluginVersion: VERSION,
            extensions: { devcodex: { git: { collaborationMode: 'solo' } } }
        }, null, 2))
        const invalidMergedGitResult = runValidateWithArgs(path.join(gitOverlayRoot, 'chat'), [
            '--profile-dir', gitOverlayProfile,
            '--workspace-profile', path.join(gitOverlayRoot, '.devcodex', 'workspace', 'profile')
        ])
        const invalidMergedGitOutput = `${invalidMergedGitResult.stdout}\n${invalidMergedGitResult.stderr}`
        assert.strictEqual(invalidMergedGitResult.status, 1, invalidMergedGitOutput)
        assert.match(invalidMergedGitOutput, /effective workspace\/project config.*solo collaboration must use branchPolicy=keep-current/)

        writeFile(gitOverlayRoot, '.devcodex/chat/profile/config.json', JSON.stringify({
            mode: 'dev',
            agent: 'claude-code',
            pluginVersion: VERSION,
            extensions: { devcodex: { git: { sharedActionsRequireExplicitAuthorization: false } } }
        }, null, 2))
        const loweredGitOverlayResult = runValidateWithArgs(path.join(gitOverlayRoot, 'chat'), [
            '--profile-dir', gitOverlayProfile,
            '--workspace-profile', path.join(gitOverlayRoot, '.devcodex', 'workspace', 'profile')
        ])
        const loweredGitOverlayOutput = `${loweredGitOverlayResult.stdout}\n${loweredGitOverlayResult.stderr}`
        assert.strictEqual(loweredGitOverlayResult.status, 1, loweredGitOverlayOutput)
        assert.match(loweredGitOverlayOutput, /overlay must not lower .*sharedActionsRequireExplicitAuthorization from true to false/)

        const explicitFallbackRoot = createWorkspaceNamespaceWorkspace(currentProjectInfo())
        const chatProfileDir = path.join(explicitFallbackRoot, '.devcodex', 'chat', 'profile')
        writeFile(explicitFallbackRoot, '.devcodex/chat/profile/01-项目信息.md', currentProjectInfo())
        const explicitFallbackResult = runValidateWithArgs(
            path.join(explicitFallbackRoot, 'chat'),
            [
                '--profile-dir',
                chatProfileDir,
                '--workspace-profile',
                path.join(explicitFallbackRoot, '.devcodex', 'workspace', 'profile')
            ]
        )
        const explicitFallbackOutput = `${explicitFallbackResult.stdout}\n${explicitFallbackResult.stderr}`

        assert.strictEqual(explicitFallbackResult.status, 0, explicitFallbackOutput)
        assert.doesNotMatch(explicitFallbackOutput, /missing required/)

        const closedLoopFallbackRoot = createClosedLoopWorkspaceNamespace(currentProjectInfo())
        const closedLoopFallbackProfileDir = path.join(closedLoopFallbackRoot, '.devcodex', 'chat', 'profile')
        writeFile(closedLoopFallbackRoot, '.devcodex/chat/profile/01-项目信息.md', currentProjectInfo())
        const closedLoopFallbackResult = runValidateWithArgs(
            path.join(closedLoopFallbackRoot, 'chat'),
            [
                '--profile-dir',
                closedLoopFallbackProfileDir,
                '--workspace-profile',
                path.join(closedLoopFallbackRoot, '.devcodex', 'workspace', 'profile')
            ]
        )
        const closedLoopFallbackOutput = `${closedLoopFallbackResult.stdout}\n${closedLoopFallbackResult.stderr}`
        assert.strictEqual(closedLoopFallbackResult.status, 0, closedLoopFallbackOutput)
        assert.doesNotMatch(closedLoopFallbackOutput, /lifecycle missing/)

        const localTierOverridesFallbackRoot = createWorkspaceNamespaceWorkspace(currentProjectInfo())
        const localStandardProfileDir = path.join(localTierOverridesFallbackRoot, '.devcodex', 'sample', 'profile')
        writeFile(localTierOverridesFallbackRoot, '.devcodex/sample/profile/01-项目信息.md', [
            currentProjectInfo(),
            '',
            '- Profile 档位：profile-standard。'
        ].join('\n'))
        fs.mkdirSync(path.join(localTierOverridesFallbackRoot, 'sample'), { recursive: true })
        writeFile(localTierOverridesFallbackRoot, 'sample/package.json', JSON.stringify({
            name: 'sample',
            version: '0.0.1',
            scripts: { test: 'node -e "1"' }
        }, null, 2))
        const localTierOverridesFallbackResult = runValidateWithArgs(
            path.join(localTierOverridesFallbackRoot, 'sample'),
            [
                '--profile-dir',
                localStandardProfileDir,
                '--workspace-profile',
                path.join(localTierOverridesFallbackRoot, '.devcodex', 'workspace', 'profile'),
                '--project-root',
                path.join(localTierOverridesFallbackRoot, 'sample')
            ]
        )
        const localTierOverridesFallbackOutput = `${localTierOverridesFallbackResult.stdout}\n${localTierOverridesFallbackResult.stderr}`

        assert.strictEqual(localTierOverridesFallbackResult.status, 1, localTierOverridesFallbackOutput)
        assert.match(localTierOverridesFallbackOutput, /profile-standard requires 04-测试规范\.md/)
        assert.match(localTierOverridesFallbackOutput, /profile-standard requires 05-交付发布规范\.md or 05-发布规范\.md/)

        const allProfilesRoot = createWorkspaceNamespaceWorkspace(currentProjectInfo())
        writeFile(allProfilesRoot, '.devcodex/chat/profile/01-项目信息.md', currentProjectInfo())
        const allProfilesResult = runValidateAll(allProfilesRoot)
        const allProfilesOutput = `${allProfilesResult.stdout}\n${allProfilesResult.stderr}`

        assert.strictEqual(allProfilesResult.status, 0, allProfilesOutput)
        assert.match(allProfilesOutput, /checked=2/)
        const batchEResult = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test-v1178-batch-e.js')], {
            cwd: ROOT,
            encoding: 'utf8'
        })
        assert.strictEqual(batchEResult.status, 0, `${batchEResult.stdout}\n${batchEResult.stderr}`)
        console.log('\x1b[32m✓ validate-profile regression tests passed\x1b[0m')
    } finally {
        TEMP_ROOTS.forEach(root => fs.rmSync(root, { recursive: true, force: true }))
    }
}

main()
