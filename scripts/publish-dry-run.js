#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { runChecked } = require('./lib/checked-command')

const ROOT = path.resolve(__dirname, '..')
const PACKAGE_NAME = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name
const targets = {
  npmjs: { registry: 'https://registry.npmjs.org/', access: 'public' },
  github: { registry: 'https://npm.pkg.github.com/', access: 'restricted' }
}

function readTarget(argv) {
  const index = argv.indexOf('--registry')
  return index >= 0 ? argv[index + 1] : 'all'
}

function packageScope(packageName) {
  if (typeof packageName !== 'string' || !packageName.startsWith('@')) return null
  const slash = packageName.indexOf('/')
  return slash > 1 ? packageName.slice(0, slash) : null
}

function assertTargetSupported(name, packageName = PACKAGE_NAME) {
  const target = targets[name]
  if (!target) throw new Error(`Unknown registry target: ${name || '(missing)'}`)
  if (name === 'github' && !packageScope(packageName)) {
    const error = new Error(`REGISTRY_TARGET_UNSUPPORTED: GitHub Packages requires a scoped npm package; ${packageName} is unscoped`)
    error.code = 'REGISTRY_TARGET_UNSUPPORTED'
    throw error
  }
  return target
}

function supportedTargets(packageName = PACKAGE_NAME) {
  return Object.keys(targets).filter(name => {
    try {
      assertTargetSupported(name, packageName)
      return true
    } catch (error) {
      if (error?.code === 'REGISTRY_TARGET_UNSUPPORTED') return false
      throw error
    }
  })
}

function buildPublishArgs(name, packageName = PACKAGE_NAME, packageArtifact = '.') {
  const target = assertTargetSupported(name, packageName)
  const args = [
    'publish',
    packageArtifact,
    '--dry-run',
    '--json',
    `--registry=${target.registry}`,
    `--access=${target.access}`
  ]
  const scope = packageScope(packageName)
  if (scope) args.push(`--${scope}:registry=${target.registry}`)
  return args
}

function parsePackJson(stdout) {
  const text = String(stdout || '').trim()
  const match = text.match(/(\[\s*\{[\s\S]*\}\s*\])\s*$/)
  if (!match) throw new Error('PACK_JSON_INVALID: npm pack did not return a JSON array')
  const payload = JSON.parse(match[1])
  if (!Array.isArray(payload) || payload.length !== 1 || typeof payload[0]?.filename !== 'string') {
    throw new Error('PACK_JSON_INVALID: npm pack must return exactly one filename')
  }
  return payload[0]
}

function createCandidateTarball(tempRoot) {
  const pack = runChecked('npm', [
    'pack',
    '--json',
    '--pack-destination',
    tempRoot
  ], {
    cwd: ROOT,
    timeoutMs: 120000,
    maxBuffer: 16 * 1024 * 1024,
    summaryLimit: 2 * 1024 * 1024
  })
  const metadata = parsePackJson(pack.stdout)
  const tarballPath = path.resolve(tempRoot, metadata.filename)
  const boundary = path.relative(path.resolve(tempRoot), tarballPath)
  if (boundary.startsWith('..') || path.isAbsolute(boundary) || !fs.existsSync(tarballPath)) {
    throw new Error('PACK_ARTIFACT_INVALID: npm pack returned a missing or out-of-boundary tarball')
  }
  return { evidence: pack, metadata, tarballPath }
}

function main(argv = process.argv.slice(2)) {
  const selected = readTarget(argv)
  if (!['npmjs', 'github', 'all'].includes(selected)) {
    console.error(`Unknown registry target: ${selected || '(missing)'}`)
    return 2
  }

  let tempRoot = null
  try {
    const names = selected === 'all' ? supportedTargets(PACKAGE_NAME) : [selected]
    for (const name of names) assertTargetSupported(name, PACKAGE_NAME)
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-publish-dry-run-'))
    const candidate = createCandidateTarball(tempRoot)
    const evidence = [{
      label: 'candidate-pack',
      ...candidate.evidence
    }]
    for (const name of names) {
      evidence.push({
        label: `publish-dry-run:${name}`,
        ...runChecked('npm', buildPublishArgs(name, PACKAGE_NAME, candidate.tarballPath), {
          cwd: ROOT,
          timeoutMs: 120000
        })
      })
    }
    for (const item of evidence) {
      console.log(`✓ ${item.label}: exitCode=${item.exitCode} durationMs=${item.durationMs}`)
    }
    return 0
  } catch (error) {
    const evidence = error && error.evidence ? error.evidence : {}
    console.error(`✗ registry dry-run failed: code=${error?.code || 'COMMAND_FAILED'} command=${evidence.command || 'unknown'} exitCode=${evidence.exitCode}`)
    if (error?.message) console.error(error.message)
    if (evidence.stderr) console.error(evidence.stderr)
    return 1
  } finally {
    if (tempRoot) {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }) } catch { /* isolated temp cleanup only */ }
    }
  }
}

if (require.main === module) process.exitCode = main()

module.exports = {
  assertTargetSupported,
  buildPublishArgs,
  createCandidateTarball,
  main,
  packageScope,
  parsePackJson,
  readTarget,
  supportedTargets,
  targets
}
