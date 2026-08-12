'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const {
  GLOBAL_HOST_RECEIPT_SCHEMA,
  applyGlobalHostConfig
} = require('./global-host-config')
const { resolveGlobalHostTarget } = require('./global-host-target')
const {
  getLifecycleHostAdapterDigest
} = require('../../hooks/_runtime/host-adapter-identity.cjs')
const {
  syncGrokWorkspacePluginInstallation
} = require('./host-adapter-scope')

const CANDIDATE_HOST_ROOTS = Object.freeze({
  codex: { env: 'CODEX_HOME', directory: '.codex' },
  grok: { env: 'GROK_HOME', directory: '.grok' }
})

const CANDIDATE_CREDENTIAL_FILES = Object.freeze({
  codex: ['auth.json'],
  grok: ['auth.json']
})

function candidateHomeEnvName (hostId) {
  return `DEVCODEX_S15_${String(hostId || '').trim().toUpperCase()}_CANDIDATE_HOME`
}

function credentialJsonHasRefreshToken (value) {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) {
    return value.some(item => credentialJsonHasRefreshToken(item))
  }
  return Object.entries(value).some(([key, nested]) =>
    /^refresh[_-]?token$/i.test(key) || credentialJsonHasRefreshToken(nested)
  )
}

function failCandidateCredential (code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function assertCredentialCopySafe (hostId, source, fsImpl = fs) {
  if (hostId !== 'grok') return
  let credential
  try {
    credential = JSON.parse(fsImpl.readFileSync(source, 'utf8'))
  } catch (error) {
    failCandidateCredential(
      'S15_CREDENTIAL_INSPECTION_FAILED',
      'S15 cannot verify whether the Grok credential is safe to copy'
    )
  }
  if (credentialJsonHasRefreshToken(credential)) {
    failCandidateCredential(
      'S15_ROTATING_CREDENTIAL_COPY_BLOCKED',
      'S15 refuses to copy a rotating Grok refresh token into a disposable HOME; use a dedicated persistent candidate HOME or XAI_API_KEY'
    )
  }
}

function buildCandidateHostEnv (hostId, home, baseEnv = process.env) {
  const descriptor = CANDIDATE_HOST_ROOTS[hostId]
  assert(descriptor, `S15 candidate isolation is not supported for host: ${hostId}`)
  const resolvedHome = path.resolve(home)
  const hostRoot = path.join(resolvedHome, descriptor.directory)
  const sharedRoot = path.join(hostRoot, 'devcodex-candidate-shared')
  const env = {
    ...baseEnv,
    DEVCODEX_TEST_HOME: resolvedHome,
    DEVCODEX_GLOBAL_SHARED_ROOT: sharedRoot,
    DEVCODEX_GLOBAL_SKILLS_RUNTIME: path.join(sharedRoot, 'devcodex', 'skills'),
    DEVCODEX_GLOBAL_FULL_FALLBACK: path.join(
      sharedRoot,
      'devcodex',
      'instructions.full.md'
    ),
    [descriptor.env]: hostRoot
  }
  delete env.DEVCODEX_GLOBAL_SKILLS_ROOT
  return env
}

function copyCandidateCredentials (
  hostId,
  sourceTarget,
  candidateTarget,
  fsImpl = fs
) {
  const copied = []
  for (const relative of CANDIDATE_CREDENTIAL_FILES[hostId] || []) {
    const source = path.join(sourceTarget.root, relative)
    if (!fsImpl.existsSync(source)) continue
    assertCredentialCopySafe(hostId, source, fsImpl)
    const destination = path.join(candidateTarget.root, relative)
    fsImpl.mkdirSync(path.dirname(destination), { recursive: true })
    fsImpl.copyFileSync(source, destination)
    copied.push(relative)
  }
  return copied
}

function bindInstalledSourceCandidateRuntime (options = {}) {
  const bound = bindInstalledProductionRuntime(options)
  return {
    ...bound,
    source: 'installed-source-candidate'
  }
}

function isPathInside (root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function bindInstalledProductionRuntime (options = {}) {
  const hostId = String(options.hostId || '').trim().toLowerCase()
  assert(CANDIDATE_HOST_ROOTS[hostId], `S15 installed production is not supported for host: ${hostId}`)
  const rawHome = String(options.home || '').trim()
  assert(rawHome, 'S15 installed production user home is required')
  const expectedRuntimeDigest = String(options.expectedRuntimeDigest || '').trim()
  const expectedHostAdapterDigest = String(options.expectedHostAdapterDigest || '').trim()
  assert.match(expectedRuntimeDigest, /^[a-f0-9]{64}$/, 'S15 expected runtime digest is required')
  assert.match(expectedHostAdapterDigest, /^[a-f0-9]{64}$/, 'S15 expected host adapter digest is required')

  const home = path.resolve(rawHome)
  const packageRoot = path.resolve(options.packageRoot || path.join(__dirname, '..', '..'))
  const baseEnv = options.baseEnv || process.env
  const fsImpl = options.fs || fs
  const resolveTarget = options.resolveGlobalHostTarget || resolveGlobalHostTarget
  const readAdapterDigest = options.getLifecycleHostAdapterDigest || getLifecycleHostAdapterDigest
  const target = resolveTarget(hostId, {
    env: baseEnv,
    home,
    packageRoot,
    fs: fsImpl
  })
  assert(target.receiptFile, `S15 installed ${hostId} production receipt path is missing`)
  assert(fsImpl.existsSync(target.receiptFile), `S15 installed ${hostId} production receipt is missing`)
  const receipt = JSON.parse(fsImpl.readFileSync(target.receiptFile, 'utf8'))
  assert.strictEqual(
    receipt.schemaVersion,
    GLOBAL_HOST_RECEIPT_SCHEMA,
    `S15 installed ${hostId} production receipt schema mismatch`
  )
  assert.strictEqual(receipt.host, hostId, `S15 installed ${hostId} production receipt host mismatch`)
  assert.strictEqual(receipt.result, 'committed', `S15 installed ${hostId} production receipt is not committed`)
  assert.strictEqual(
    receipt.packageName,
    'devcodex',
    `S15 installed ${hostId} production receipt package mismatch`
  )
  assert(target.runtimeBaseRoot, `S15 installed ${hostId} production managed runtime root is missing`)
  assert(target.shared?.root, `S15 installed ${hostId} production managed shared root is missing`)

  const packageManifest = JSON.parse(fsImpl.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
  const expectedPackageVersion = String(options.expectedPackageVersion || packageManifest.version || '').trim()
  assert(expectedPackageVersion, 'S15 expected package version is required')
  assert.strictEqual(
    receipt.packageVersion,
    expectedPackageVersion,
    `S15 installed ${hostId} production package version does not match current source`
  )

  const runtimeRoot = path.resolve(String(receipt.runtimeRoot || ''))
  assert(
    receipt.runtimeRoot && isPathInside(target.runtimeBaseRoot, runtimeRoot),
    `S15 installed ${hostId} production runtime escapes the managed host root`
  )
  const skillsRuntime = path.resolve(String(receipt.skillsRuntimeRoot || ''))
  assert(
    receipt.skillsRuntimeRoot && isPathInside(target.shared.root, skillsRuntime),
    `S15 installed ${hostId} production skills runtime escapes the managed shared root`
  )
  assert(
    fsImpl.existsSync(skillsRuntime),
    `S15 installed ${hostId} production skills runtime is missing`
  )
  const generationFile = path.join(runtimeRoot, 'runtime-generation.json')
  assert(fsImpl.existsSync(generationFile), `S15 installed ${hostId} production generation is missing`)
  const generation = JSON.parse(fsImpl.readFileSync(generationFile, 'utf8'))
  assert.strictEqual(
    generation.packageVersion,
    expectedPackageVersion,
    `S15 installed ${hostId} production generation version mismatch`
  )
  assert.strictEqual(
    generation.runtimeContractDigest,
    expectedRuntimeDigest,
    `S15 installed ${hostId} production runtime does not match current source`
  )
  const installedHostAdapterDigest = readAdapterDigest(hostId, {
    runtimeRoot: path.join(runtimeRoot, 'hooks', '_runtime'),
    fs: fsImpl
  })
  assert.strictEqual(
    installedHostAdapterDigest,
    expectedHostAdapterDigest,
    `S15 installed ${hostId} production adapter does not match current source`
  )

  return {
    schemaVersion: 'SkillRouteS15CandidateHostRuntimeV1',
    source: 'installed-production-receipt',
    hostId,
    home,
    env: baseEnv,
    target: {
      ...target,
      runtimeRoot,
      runtimeGeneration: generation,
      shared: {
        ...target.shared,
        skillsRuntime
      }
    },
    generation,
    receipt: {
      schemaVersion: receipt.schemaVersion || null,
      packageVersion: receipt.packageVersion,
      runtimeRoot,
      skillsRuntimeRoot: skillsRuntime
    },
    credentialFiles: ['host-auth:existing'],
    nativeRegistration: null
  }
}

function prepareCandidateHostRuntime (options = {}) {
  const hostId = String(options.hostId || '').trim().toLowerCase()
  const rawFixtureRoot = String(options.fixtureRoot || '').trim()
  assert(rawFixtureRoot, 'S15 candidate fixture root is required')
  const fixtureRoot = path.resolve(rawFixtureRoot)
  const packageRoot = path.resolve(options.packageRoot || path.join(__dirname, '..', '..'))
  const baseEnv = options.baseEnv || process.env
  const fsImpl = options.fs || fs
  const apply = options.applyGlobalHostConfig || applyGlobalHostConfig
  const resolveTarget = options.resolveGlobalHostTarget || resolveGlobalHostTarget
  const syncGrok = options.syncGrokWorkspacePluginInstallation || syncGrokWorkspacePluginInstallation
  const rawSourceHome = String(
    options.sourceHome || baseEnv.USERPROFILE || baseEnv.HOME || ''
  ).trim()
  assert(rawSourceHome, 'S15 candidate credential source home is required')
  const sourceHome = path.resolve(rawSourceHome)

  const configuredCandidateHome = String(
    options.candidateHome || baseEnv[candidateHomeEnvName(hostId)] || ''
  ).trim()
  const home = configuredCandidateHome
    ? path.resolve(configuredCandidateHome)
    : path.join(fixtureRoot, 'candidate-host-home')
  if (process.platform === 'win32'
    ? home.toLowerCase() === sourceHome.toLowerCase()
    : home === sourceHome) {
    failCandidateCredential(
      'S15_CANDIDATE_HOME_NOT_ISOLATED',
      'S15 candidate HOME must not be the real user HOME'
    )
  }
  const env = buildCandidateHostEnv(hostId, home, baseEnv)
  const sourceTarget = resolveTarget(hostId, {
    env: baseEnv,
    home: sourceHome,
    packageRoot,
    runtimeGeneration: false,
    fs: fsImpl
  })
  const candidateTarget = resolveTarget(hostId, {
    env,
    home,
    packageRoot,
    runtimeGeneration: false,
    fs: fsImpl
  })
  let credentialFiles
  if (configuredCandidateHome) {
    const existingCredentialFiles = (CANDIDATE_CREDENTIAL_FILES[hostId] || [])
      .filter(relative => fsImpl.existsSync(path.join(candidateTarget.root, relative)))
      .map(relative => `${relative}:existing`)
    const apiKeyAvailable = hostId === 'grok' && Boolean(String(baseEnv.XAI_API_KEY || '').trim())
    if (existingCredentialFiles.length === 0 && !apiKeyAvailable) {
      failCandidateCredential(
        'S15_CANDIDATE_AUTH_MISSING',
        `S15 dedicated ${hostId} candidate HOME is not authenticated`
      )
    }
    credentialFiles = existingCredentialFiles.length > 0
      ? existingCredentialFiles
      : ['env:XAI_API_KEY']
  } else if (hostId === 'grok' && Boolean(String(baseEnv.XAI_API_KEY || '').trim())) {
    credentialFiles = ['env:XAI_API_KEY']
  } else {
    credentialFiles = copyCandidateCredentials(
      hostId,
      sourceTarget,
      candidateTarget,
      fsImpl
    )
  }
  const installation = apply({
    packageRoot,
    env,
    home,
    hosts: [hostId],
    ignoreExistingReceipts: true,
    fs: fsImpl
  })
  assert.strictEqual(
    installation.transaction?.status,
    'committed',
    `S15 candidate ${hostId} runtime installation failed`
  )
  const installedTarget = installation.targets.find(target => target.host === hostId)
  assert(installedTarget, `S15 candidate ${hostId} target missing`)
  const generationFile = path.join(installedTarget.runtimeRoot, 'runtime-generation.json')
  assert(fsImpl.existsSync(generationFile), `S15 candidate ${hostId} generation missing`)
  const generation = JSON.parse(fsImpl.readFileSync(generationFile, 'utf8'))
  assert.match(
    String(generation.runtimeContractDigest || ''),
    /^[a-f0-9]{64}$/,
    `S15 candidate ${hostId} runtime digest missing`
  )
  const nativeRegistration = hostId === 'grok'
    ? syncGrok({
        pluginPath: installedTarget.files.plugin,
        backupDir: path.join(home, 'devcodex-probe-backups'),
        env
      })
    : null
  if (hostId === 'grok') {
    assert.ok(
      ['verified', 'already-current'].includes(nativeRegistration.status),
      `S15 candidate Grok plugin registration failed: ${nativeRegistration.status}`
    )
  }

  return {
    schemaVersion: 'SkillRouteS15CandidateHostRuntimeV1',
    source: configuredCandidateHome
      ? 'persistent-isolated-source-candidate'
      : 'isolated-source-candidate',
    hostId,
    home,
    env,
    target: installedTarget,
    generation,
    credentialFiles,
    nativeRegistration: nativeRegistration
      ? {
          schemaVersion: nativeRegistration.schemaVersion,
          status: nativeRegistration.status,
          refreshMode: nativeRegistration.refreshMode || null
        }
      : null
  }
}

module.exports = {
  CANDIDATE_CREDENTIAL_FILES,
  CANDIDATE_HOST_ROOTS,
  assertCredentialCopySafe,
  bindInstalledProductionRuntime,
  bindInstalledSourceCandidateRuntime,
  buildCandidateHostEnv,
  candidateHomeEnvName,
  copyCandidateCredentials,
  credentialJsonHasRefreshToken,
  prepareCandidateHostRuntime
}
