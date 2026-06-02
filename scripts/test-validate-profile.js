#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'validate-profile.js')
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
    writeFile(root, '.devcodex/profile/README.md', '# README\n\n- `config.local.json`：本地私有 overlay。\n- `extensions.<namespace>`：扩展位需在 Profile 中说明。\n')
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

function createWorkspaceNamespaceWorkspace(projectInfo) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-validate-profile-ws-'))
    TEMP_ROOTS.push(root)

    writeFile(root, 'package.json', JSON.stringify({ name: PACKAGE_NAME }, null, 2))
    writeFile(root, '.devcodex/layout.json', JSON.stringify({ version: 1, mode: 'workspace-namespace' }, null, 2))
    writeFile(root, '.devcodex/workspace/profile/README.md', '# README\n')
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
        '```',
        'devcodex/skills/        →   .github/skills/',
        'devcodex/instructions/  →   .github/instructions/',
        'devcodex/prompts/       →   .github/prompts/',
        'devcodex/data/          →   .github/data/',
        'devcodex/agents/        →   .github/agents/（仅 Copilot 默认分发）',
        'devcodex/instructions.md → .github/copilot-instructions.md（Copilot）',
        'devcodex/RULES.md       →   .github/RULES.md',
        '```',
        '',
        '> 说明：`instructions.md` 是单源规范文件，安装时按平台 rename 到 `.github/copilot-instructions.md` 或 `CLAUDE.md`；`agents/` 当前仅在 Copilot 端默认分发，Claude Code 端仍通过 Skills 路由，不分发 agents。',
        '',
        '## 授权状态',
        '',
        '- 当前 `token-check` 仅为授权占位，不执行 tier 阻断。',
        '- 所有工作流和子类型当前全量开放。',
        '',
        '## 本地配置说明（可选）',
        '',
        '- `config.local.json` 用于本地私有 overlay，不覆盖 `mode` / `agent`。',
        '- 若使用 `extensions.<namespace>`，需在本文件或 Profile README 说明字段语义。',
        ''
    ].join('\n')
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
                readonly: true,
                urlEnv: 'REPORTING_DB_URL',
                passwordEnv: 'REPORTING_DB_PASSWORD'
            }
        },
        extensions: {
            'docs-runtime': {
                description: '本地文档运行时扩展',
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
                connectionPassword: 'local-connection-password-placeholder'
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

function main() {
    try {
        const legacyRoot = createWorkspace(legacyProjectInfo())
        const legacyResult = runValidate(legacyRoot)
        const legacyOutput = `${legacyResult.stdout}\n${legacyResult.stderr}`

        assert.strictEqual(legacyResult.status, 2, legacyOutput)
        assert.match(legacyOutput, /legacy agents distribution wording/)
        assert.match(legacyOutput, /legacy Free\/Pro authorization tiers/)
        assert.match(legacyOutput, /current formal requirement entry/)

        const currentRoot = createWorkspace(currentProjectInfo())
        const currentResult = runValidate(currentRoot)
        const currentOutput = `${currentResult.stdout}\n${currentResult.stderr}`

        assert.strictEqual(currentResult.status, 0, currentOutput)

        const localConfigRoot = createWorkspace(currentProjectInfo())
        writeFile(localConfigRoot, '.devcodex/profile/config.local.json', validLocalConfig())
        writeFile(localConfigRoot, '.gitignore', '.devcodex/profile/config.local.json\n.devcodex/*/profile/config.local.json\n')
        const localConfigResult = runValidate(localConfigRoot)
        const localConfigOutput = `${localConfigResult.stdout}\n${localConfigResult.stderr}`

        assert.strictEqual(localConfigResult.status, 0, localConfigOutput)

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
        console.log('\x1b[32m✓ validate-profile regression tests passed\x1b[0m')
    } finally {
        TEMP_ROOTS.forEach(root => fs.rmSync(root, { recursive: true, force: true }))
    }
}

main()
