#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  resolveExecutableOnPath,
  resolveWindowsBatchInvocation
} = require('./checked-command')

const DEFAULT_TIMEOUT_MS = 900000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const RUN_SCHEMA = 'RealHostValidationRunIdentityV1'
const LEDGER_SCHEMA = 'RealHostAttemptLedgerV1'
const RESULT_SCHEMA = 'RealHostProbeResultV1'
const FORBIDDEN_CANDIDATE_SCHEMA = 'ForbiddenRootCandidateV1'
const FORBIDDEN_ELIGIBILITY_SCHEMA = 'ForbiddenRootEligibilityV1'
const WINDOWS_ACL_PROJECTION_SCHEMA = 'WindowsAclProjectionV1'
const WINDOWS_EVERYONE_SID = 'S-1-1-0'
const WINDOWS_AUTHENTICATED_USERS_SID = 'S-1-5-11'
const WINDOWS_BUILTIN_USERS_SID = 'S-1-5-32-545'
const WINDOWS_WRITE_CAPABILITY_MASK = 2 | 4 | 16 | 64 | 256 | 65536 | 262144 | 524288
const WINDOWS_SID_RE = /^S-\d+(?:-\d+)+$/u
const WINDOWS_ACL_TARGET_ENV = 'DEVCODEX_REAL_HOST_ACL_TARGET'
const STAGE_ORDER = {
  H0: ['H0-allowed', 'H0-forbidden'],
  installed: ['H1', 'H2', 'H3']
}
const CLI_ARGUMENT_NAMES = new Set([
  'mode',
  'evidence-root',
  'source-root',
  'source-candidate',
  'authorization-digest',
  'codex',
  'timeout-ms',
  'request-file',
  'result-file'
])

class RealCodexHostProbeError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'RealCodexHostProbeError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details) {
  throw new RealCodexHostProbeError(code, message, details)
}

function normalizeForStableJson(value) {
  if (Array.isArray(value)) return value.map(normalizeForStableJson)
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) result[key] = normalizeForStableJson(value[key])
        return result
      }, {})
  }
  return value
}

function stableStringify(value) {
  return JSON.stringify(normalizeForStableJson(value))
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function digestObject(value) {
  return sha256(Buffer.from(stableStringify(value), 'utf8'))
}

function samePath(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}

function assertHexDigest(label, value) {
  if (!/^[a-f0-9]{64}$/iu.test(String(value || ''))) {
    fail('REAL_HOST_IDENTITY_INVALID', label + ' must be a SHA-256 digest')
  }
}

function assertPlainToken(label, value) {
  if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(String(value || ''))) {
    fail('REAL_HOST_IDENTITY_INVALID', label + ' contains unsupported characters')
  }
}

function assertInstalledIdentityBinding(identity) {
  if (identity?.mode !== 'installed') return
  const tarball = identity.tarball
  const runtime = identity.installedRuntime
  const probeEffectRoots = Array.isArray(identity.topology?.probeEffectRoots)
    ? identity.topology.probeEffectRoots
    : []
  if (
    !tarball ||
    !path.isAbsolute(String(tarball.path || '')) ||
    !Number.isInteger(tarball.bytes) ||
    tarball.bytes <= 0
  ) {
    fail('REAL_HOST_IDENTITY_INVALID', 'installed identity requires an absolute non-empty tarball binding')
  }
  assertHexDigest('tarball.sha256', tarball.sha256)
  if (!runtime || !path.isAbsolute(String(runtime.root || ''))) {
    fail('REAL_HOST_IDENTITY_INVALID', 'installed identity requires an absolute runtime root binding')
  }
  assertHexDigest('installedRuntime.generationDigest', runtime.generationDigest)
  if (probeEffectRoots.some(entry => entry?.ownedMutable === true)) {
    fail('REAL_HOST_IDENTITY_INVALID', 'installed probe effect roots cannot be owned mutable scratch')
  }
}

function assertRealDirectory(label, target) {
  if (typeof target !== 'string' || !target.trim()) {
    fail('REAL_HOST_PATH_MISSING', label + ' is required')
  }
  const resolved = path.resolve(target)
  if (!fs.existsSync(resolved)) fail('REAL_HOST_PATH_MISSING', label + ' does not exist', { path: resolved })
  const stat = fs.lstatSync(resolved)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail('REAL_HOST_PATH_UNSAFE', label + ' must be a physical directory', { path: resolved })
  }
  const real = fs.realpathSync.native(resolved)
  if (!samePath(real, resolved)) {
    fail('REAL_HOST_PATH_UNSAFE', label + ' resolves through an alias or reparse point', {
      path: resolved,
      realPath: real
    })
  }
  return real
}

function validateProbeTopology(input) {
  const consumerRoot = assertRealDirectory('consumerRoot', input.consumerRoot)
  const addDir = assertRealDirectory('addDir', input.addDir)
  const forbiddenRoot = input.forbiddenRoot
    ? assertRealDirectory('forbiddenRoot', input.forbiddenRoot)
    : null
  if (samePath(consumerRoot, addDir) || isPathInside(consumerRoot, addDir) || isPathInside(addDir, consumerRoot)) {
    fail('REAL_HOST_TOPOLOGY_INVALID', 'consumerRoot and addDir must be separate sibling roots')
  }
  const workspaceRoot = path.dirname(consumerRoot)
  const activeNamespaceRoot = path.dirname(addDir)
  const namespaceName = path.basename(activeNamespaceRoot)
  const sameProjectName = process.platform === 'win32'
    ? path.basename(consumerRoot).toLowerCase() === path.basename(addDir).toLowerCase()
    : path.basename(consumerRoot) === path.basename(addDir)
  if (
    namespaceName.toLowerCase() !== '.devcodex' ||
    !samePath(path.dirname(activeNamespaceRoot), workspaceRoot) ||
    !sameProjectName
  ) {
    fail(
      'REAL_HOST_TOPOLOGY_INVALID',
      'addDir must be the matching .devcodex project root beside the explicit consumer'
    )
  }
  if (forbiddenRoot && (
    samePath(forbiddenRoot, consumerRoot) ||
    samePath(forbiddenRoot, addDir) ||
    isPathInside(consumerRoot, forbiddenRoot) ||
    isPathInside(addDir, forbiddenRoot) ||
    isPathInside(forbiddenRoot, consumerRoot) ||
    isPathInside(forbiddenRoot, addDir)
  )) {
    fail('REAL_HOST_TOPOLOGY_INVALID', 'forbiddenRoot must be outside consumerRoot and addDir')
  }
  return { consumerRoot, addDir, forbiddenRoot }
}

function samePathForPlatform(left, right, platform = process.platform) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function pathRelationForPlatform(root, candidate, platform = process.platform) {
  if (samePathForPlatform(root, candidate, platform)) return 'same'
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  const candidateInside = relative !== '' && relative !== '..' &&
    !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
  if (candidateInside) return 'candidate-descendant'
  const inverse = path.relative(path.resolve(candidate), path.resolve(root))
  const rootInside = inverse !== '' && inverse !== '..' &&
    !inverse.startsWith('..' + path.sep) && !path.isAbsolute(inverse)
  return rootInside ? 'candidate-ancestor' : null
}

function normalizeSid(value) {
  const sid = String(value || '').trim().toUpperCase()
  return WINDOWS_SID_RE.test(sid) ? sid : null
}

function windowsPowerShellExecutable(env = process.env) {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows'
  const builtIn = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (fs.existsSync(builtIn)) return builtIn
  return resolveExecutableOnPath('pwsh.exe', env) || resolveExecutableOnPath('powershell.exe', env)
}

/** Read a bounded Windows DACL projection using stable SIDs and numeric rights. */
function readWindowsAclProjection(target, env = process.env, services = {}) {
  const resolvedTarget = path.resolve(target)
  const executable = services.executable || windowsPowerShellExecutable(env)
  if (!executable) {
    fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'Windows ACL reader requires PowerShell')
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    `$rawTarget=[System.Environment]::GetEnvironmentVariable('${WINDOWS_ACL_TARGET_ENV}','Process')`,
    "if([System.String]::IsNullOrWhiteSpace($rawTarget)){throw 'ACL target environment binding is missing'}",
    '$target=[System.IO.Path]::GetFullPath($rawTarget)',
    '$acl=Get-Acl -LiteralPath $target',
    '$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent()',
    "$group=Get-LocalGroup -Name 'CodexSandboxUsers' -ErrorAction Stop",
    '$members=@(Get-LocalGroupMember -Group $group.Name -ErrorAction Stop | ForEach-Object { $_.SID.Value })',
    '$entries=@($acl.Access | ForEach-Object { $sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; [pscustomobject]@{sid=$sid;accessType=$_.AccessControlType.ToString();rights=[int64]$_.FileSystemRights;isInherited=[bool]$_.IsInherited;inheritanceFlags=$_.InheritanceFlags.ToString();propagationFlags=$_.PropagationFlags.ToString()} })',
    '$ownerSid=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value',
    '[pscustomobject]@{schemaVersion=\'WindowsAclProjectionV1\';targetPath=$target;ownerSid=$ownerSid;currentUserSid=$identity.User.Value;sandboxGroupSid=$group.SID.Value;sandboxMemberSids=$members;entries=$entries;sddl=$acl.Sddl;complete=$true} | ConvertTo-Json -Compress -Depth 8'
  ].join(';')
  const run = typeof services.spawnSync === 'function' ? services.spawnSync : spawnSync
  const childEnv = Object.fromEntries(Object.entries(env)
    .filter(([name]) => name.toUpperCase() !== 'PSMODULEPATH'))
  childEnv[WINDOWS_ACL_TARGET_ENV] = resolvedTarget
  const result = run(executable, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script
  ], {
    // PowerShell 7 injects its own PSModulePath into this Node process. Passing
    // that value to Windows PowerShell 5 prevents Get-Acl from autoloading its
    // inbox Security module, so let the selected host rebuild its native path.
    env: childEnv,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 1024 * 1024
  })
  if (result.error || result.status !== 0 || !String(result.stdout || '').trim()) {
    fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'Windows ACL projection could not be read', {
      path: path.resolve(target),
      exitCode: Number.isInteger(result.status) ? result.status : null,
      cause: result.error?.code || String(result.stderr || '').trim().slice(0, 1000) || null
    })
  }
  try {
    return JSON.parse(String(result.stdout).trim())
  } catch (error) {
    fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'Windows ACL projection was not valid JSON', {
      path: path.resolve(target),
      cause: error.message
    })
  }
}

function normalizeWindowsAclProjection(raw, target, platform = process.platform) {
  if (!raw || raw.complete !== true || raw.schemaVersion !== WINDOWS_ACL_PROJECTION_SCHEMA) {
    fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'Windows ACL projection is incomplete')
  }
  if (!samePathForPlatform(raw.targetPath, target, platform)) {
    fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'Windows ACL projection target drifted')
  }
  const ownerSid = normalizeSid(raw.ownerSid)
  const currentUserSid = normalizeSid(raw.currentUserSid)
  const sandboxGroupSid = normalizeSid(raw.sandboxGroupSid)
  const sddl = String(raw.sddl || '').trim()
  const sandboxMemberSids = [...new Set((Array.isArray(raw.sandboxMemberSids) ? raw.sandboxMemberSids : [])
    .map(normalizeSid)
    .filter(Boolean))].sort()
  if (!ownerSid || !currentUserSid || !sandboxGroupSid || !sddl ||
      sandboxMemberSids.length === 0 || sandboxMemberSids.length > 32) {
    fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'Windows sandbox principal projection is incomplete')
  }
  const entries = (Array.isArray(raw.entries) ? raw.entries : []).map(entry => {
    const sid = normalizeSid(entry?.sid)
    const rights = Number(entry?.rights)
    const accessType = String(entry?.accessType || '')
    if (!sid || !Number.isSafeInteger(rights) || rights < 0 || !['Allow', 'Deny'].includes(accessType)) {
      fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'Windows ACL entry is ambiguous or invalid')
    }
    return {
      sid,
      accessType,
      rights,
      isInherited: entry?.isInherited === true,
      inheritanceFlags: String(entry?.inheritanceFlags || ''),
      propagationFlags: String(entry?.propagationFlags || '')
    }
  })
  if (entries.length > 256) {
    fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'Windows ACL projection exceeds its bounded entry count')
  }
  entries.sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)))
  return {
    schemaVersion: WINDOWS_ACL_PROJECTION_SCHEMA,
    targetPath: path.resolve(target),
    ownerSid,
    currentUserSid,
    sandboxGroupSid,
    sandboxMemberSids,
    entries,
    sddlDigest: sha256(Buffer.from(sddl, 'utf8'))
  }
}

function collectAmbientWritableRoots(context, services = {}) {
  const hostEnv = context.hostEnv || process.env
  const candidates = [
    ['systemTemp', services.systemTempRoot || os.tmpdir()],
    ['hostTEMP', hostEnv.TEMP],
    ['hostTMP', hostEnv.TMP],
    ['hostTMPDIR', hostEnv.TMPDIR],
    ['consumerRoot', context.consumerRoot],
    ['addDir', context.addDir],
    ['isolatedHome', context.isolatedHome],
    ['sourceRoot', context.sourceRoot],
    ['evidenceRoot', context.evidenceRoot],
    ['workspaceRoot', context.workspaceRoot],
    ['processCwd', services.processCwd || process.cwd()]
  ]
  const seen = new Set()
  return candidates.flatMap(([label, value]) => {
    if (!String(value || '').trim() || !path.isAbsolute(String(value))) return []
    const root = path.resolve(String(value))
    const key = (services.platform || process.platform) === 'win32' ? root.toLowerCase() : root
    if (seen.has(key)) return []
    seen.add(key)
    return [{ label, root }]
  }).sort((left, right) => `${left.label}:${left.root}`.localeCompare(`${right.label}:${right.root}`))
}

function inspectForbiddenPathChain(candidate, services = {}) {
  if (typeof services.inspectPathChain === 'function') {
    const supplied = services.inspectPathChain(candidate)
    return {
      reparseFree: supplied?.reparseFree === true,
      paths: Array.isArray(supplied?.paths) ? supplied.paths.map(value => path.resolve(value)) : []
    }
  }
  const platform = services.platform || process.platform
  const start = path.resolve(candidate.localAppDataRoot)
  const leaf = path.resolve(candidate.leafRoot)
  const relation = pathRelationForPlatform(start, leaf, platform)
  if (!['candidate-descendant', 'same'].includes(relation)) return { reparseFree: false, paths: [] }
  const relative = path.relative(start, leaf)
  const parts = relative ? relative.split(path.sep).filter(Boolean) : []
  const paths = [start]
  let current = start
  for (const part of parts) {
    current = path.join(current, part)
    paths.push(current)
  }
  for (const currentPath of paths) {
    let stat
    let real
    try {
      stat = fs.lstatSync(currentPath)
      real = fs.realpathSync.native(currentPath)
    } catch {
      return { reparseFree: false, paths }
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePathForPlatform(real, currentPath, platform)) {
      return { reparseFree: false, paths }
    }
  }
  return { reparseFree: true, paths }
}

/** Resolve one host-local negative canary without falling back to an ambient writable root. */
function resolveForbiddenRootCandidate(hostEnv, nonce, services = {}) {
  const platform = services.platform || process.platform
  if (platform !== 'win32') {
    fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'qualified forbidden roots are currently implemented only for Windows')
  }
  if (!/^[a-f0-9]{48}$/u.test(String(nonce || ''))) {
    fail('REAL_HOST_ORACLE_INVALID', 'forbidden root nonce must be 24 random bytes encoded as lowercase hex')
  }
  const localAppData = String(hostEnv?.LOCALAPPDATA || '').trim()
  if (!localAppData || !path.isAbsolute(localAppData)) {
    fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'original host LOCALAPPDATA is unavailable')
  }
  const defaultBase = path.join(path.resolve(localAppData), 'DevCodex', '.tmp', 'real-host-negative')
  const baseRoot = services.testOnly === true && services.forbiddenBaseRoot
    ? path.resolve(services.forbiddenBaseRoot)
    : defaultBase
  if (!samePathForPlatform(baseRoot, defaultBase, platform) && services.testOnly !== true) {
    fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'forbidden root base must use the canonical host-local location')
  }
  let canonicalBase
  try {
    canonicalBase = assertRealDirectory('forbiddenBaseRoot', baseRoot)
  } catch (error) {
    fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'host-local forbidden root base is not ready', {
      path: baseRoot,
      cause: error?.code || error?.message || null
    })
  }
  return {
    schemaVersion: FORBIDDEN_CANDIDATE_SCHEMA,
    platform,
    placementMode: 'windows-localappdata-devcodex-negative-canary',
    localAppDataRoot: path.resolve(localAppData),
    baseRoot: canonicalBase,
    leafRoot: path.join(canonicalBase, nonce),
    nonce,
    ownedLeaf: true
  }
}

function createForbiddenCandidateLeaf(candidate) {
  if (candidate?.schemaVersion !== FORBIDDEN_CANDIDATE_SCHEMA || candidate.ownedLeaf !== true) {
    fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'forbidden root candidate identity is invalid')
  }
  if (!samePathForPlatform(path.dirname(candidate.leafRoot), candidate.baseRoot, candidate.platform)) {
    fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'forbidden root leaf escaped its exact base')
  }
  try {
    fs.mkdirSync(candidate.leafRoot)
  } catch (error) {
    fail('HOST_FORBIDDEN_ROOT_UNVERIFIED', 'forbidden root nonce leaf could not be created exclusively', {
      path: candidate.leafRoot,
      cause: error?.code || error?.message || null
    })
  }
  return candidate.leafRoot
}

function projectForbiddenEligibilityForIdentity(eligibility) {
  return {
    schemaVersion: FORBIDDEN_ELIGIBILITY_SCHEMA,
    status: eligibility.status,
    canonicalLeaf: eligibility.canonicalLeaf,
    canonicalParent: eligibility.canonicalParent,
    placementMode: eligibility.placementMode,
    effectiveAclDigest: eligibility.effectiveAclDigest,
    sddlDigest: eligibility.sddlDigest,
    ambientWritableRootsDigest: eligibility.ambientWritableRootsDigest,
    sandboxPrincipalWriteDigest: eligibility.sandboxPrincipalWriteDigest,
    eligibilityDigest: eligibility.eligibilityDigest
  }
}

/** Qualify one negative canary conservatively before any authorization is consumed. */
function qualifyForbiddenRoot(candidate, context, services = {}) {
  const checkedAt = new Date().toISOString()
  const platform = services.platform || candidate?.platform || process.platform
  const base = {
    schemaVersion: FORBIDDEN_ELIGIBILITY_SCHEMA,
    canonicalLeaf: path.resolve(candidate?.leafRoot || ''),
    canonicalParent: path.resolve(candidate?.baseRoot || ''),
    platform,
    placementMode: candidate?.placementMode || null,
    ownedLeaf: candidate?.ownedLeaf === true,
    reparseFree: false,
    currentUserManageable: false,
    ambientWritableRootMatches: [],
    effectiveAclDigest: null,
    sddlDigest: null,
    sandboxPrincipalWriteMatches: [],
    checkedAt,
    status: 'UNVERIFIED',
    code: 'HOST_FORBIDDEN_ROOT_UNVERIFIED',
    reasons: []
  }
  if (platform !== 'win32' || candidate?.schemaVersion !== FORBIDDEN_CANDIDATE_SCHEMA || !base.ownedLeaf) {
    base.reasons.push('candidate-invalid')
    return finalizeForbiddenEligibility(base, [])
  }
  let canonicalLeaf
  let canonicalParent
  let leafEntries
  try {
    canonicalLeaf = fs.realpathSync.native(candidate.leafRoot)
    canonicalParent = fs.realpathSync.native(candidate.baseRoot)
    const leafStat = fs.lstatSync(candidate.leafRoot)
    const parentStat = fs.lstatSync(candidate.baseRoot)
    leafEntries = fs.readdirSync(candidate.leafRoot)
    if (!leafStat.isDirectory() || leafStat.isSymbolicLink() ||
        !parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      base.reasons.push('path-type-unsafe')
    }
  } catch {
    base.reasons.push('path-unreadable')
    return finalizeForbiddenEligibility(base, [])
  }
  base.canonicalLeaf = canonicalLeaf
  base.canonicalParent = canonicalParent
  if (!samePathForPlatform(canonicalLeaf, candidate.leafRoot, platform) ||
      !samePathForPlatform(canonicalParent, candidate.baseRoot, platform) ||
      !samePathForPlatform(path.dirname(canonicalLeaf), canonicalParent, platform)) {
    base.reasons.push('canonical-path-drift')
  }
  if (leafEntries.length !== 0) base.reasons.push('leaf-not-empty')
  const chain = inspectForbiddenPathChain(candidate, services)
  base.reparseFree = chain.reparseFree
  if (!base.reparseFree) base.reasons.push('reparse-or-alias')
  const ambientRoots = collectAmbientWritableRoots(context, services)
  base.ambientWritableRootMatches = ambientRoots.flatMap(entry => {
    const relation = pathRelationForPlatform(entry.root, canonicalLeaf, platform)
    return relation ? [{ label: entry.label, root: entry.root, relation }] : []
  })
  if (base.ambientWritableRootMatches.length) {
    base.status = 'PREAUTHORIZED'
    base.code = 'HOST_FORBIDDEN_ROOT_PREAUTHORIZED'
    base.reasons.push('ambient-writable-root-match')
    return finalizeForbiddenEligibility(base, ambientRoots)
  }
  let acl
  try {
    const reader = typeof services.readWindowsAcl === 'function'
      ? services.readWindowsAcl
      : target => readWindowsAclProjection(target, context.hostEnv)
    acl = normalizeWindowsAclProjection(reader(canonicalLeaf), canonicalLeaf, platform)
  } catch (error) {
    base.reasons.push(error?.code || 'acl-unreadable')
    return finalizeForbiddenEligibility(base, ambientRoots)
  }
  base.effectiveAclDigest = digestObject(acl)
  base.sddlDigest = acl.sddlDigest
  base.currentUserManageable = acl.ownerSid === acl.currentUserSid
  if (!base.currentUserManageable) base.reasons.push('owner-mismatch')
  const relevantSids = new Set([
    acl.sandboxGroupSid,
    ...acl.sandboxMemberSids,
    WINDOWS_EVERYONE_SID,
    WINDOWS_AUTHENTICATED_USERS_SID,
    WINDOWS_BUILTIN_USERS_SID
  ])
  const writeEntries = acl.entries.filter(entry =>
    relevantSids.has(entry.sid) && (entry.rights & WINDOWS_WRITE_CAPABILITY_MASK) !== 0)
  const allowWrites = writeEntries.filter(entry => entry.accessType === 'Allow')
  const denyWrites = writeEntries.filter(entry => entry.accessType === 'Deny')
  base.sandboxPrincipalWriteMatches = allowWrites
  if (allowWrites.length && denyWrites.length) {
    base.reasons.push('acl-effective-write-ambiguous')
  } else if (allowWrites.length) {
    base.status = 'PREAUTHORIZED'
    base.code = 'HOST_FORBIDDEN_ROOT_PREAUTHORIZED'
    base.reasons.push('sandbox-principal-write-allowed')
  }
  if (!base.reasons.length) {
    base.status = 'PASS'
    base.code = null
  }
  return finalizeForbiddenEligibility(base, ambientRoots, denyWrites)
}

function finalizeForbiddenEligibility(base, ambientRoots, denyWrites = []) {
  const semantic = {
    schemaVersion: base.schemaVersion,
    canonicalLeaf: base.canonicalLeaf,
    canonicalParent: base.canonicalParent,
    platform: base.platform,
    placementMode: base.placementMode,
    ownedLeaf: base.ownedLeaf,
    reparseFree: base.reparseFree,
    currentUserManageable: base.currentUserManageable,
    ambientWritableRootMatches: base.ambientWritableRootMatches,
    ambientWritableRootsDigest: digestObject(ambientRoots),
    effectiveAclDigest: base.effectiveAclDigest,
    sddlDigest: base.sddlDigest,
    sandboxPrincipalWriteMatches: base.sandboxPrincipalWriteMatches,
    sandboxPrincipalDenyMatches: denyWrites,
    sandboxPrincipalWriteDigest: digestObject({ allow: base.sandboxPrincipalWriteMatches, deny: denyWrites }),
    status: base.status,
    code: base.code,
    reasons: [...new Set(base.reasons)].sort()
  }
  return {
    ...semantic,
    checkedAt: base.checkedAt,
    eligibilityDigest: digestObject(semantic)
  }
}

function cleanupForbiddenCandidateLeaf(lifecycle) {
  const result = {
    attempted: lifecycle?.ownedLeaf === true,
    complete: true,
    leafRoot: lifecycle?.leafRoot || null,
    baseRoot: lifecycle?.baseRoot || null,
    basePreserved: lifecycle?.baseRoot ? fs.existsSync(lifecycle.baseRoot) : true,
    errorCode: null
  }
  if (!result.attempted || !result.leafRoot) return result
  try {
    if (fs.existsSync(result.leafRoot)) {
      if (!/^[a-f0-9]{48}$/u.test(String(lifecycle.nonce || '')) ||
          path.basename(result.leafRoot) !== lifecycle.nonce ||
          !samePathForPlatform(path.dirname(result.leafRoot), result.baseRoot, lifecycle.platform)) {
        fail('HOST_CLEANUP_INCOMPLETE', 'forbidden nonce leaf no longer belongs to its exact base')
      }
      const stat = fs.lstatSync(result.leafRoot)
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(result.leafRoot)
      } else if (stat.isDirectory()) {
        const real = fs.realpathSync.native(result.leafRoot)
        if (samePathForPlatform(real, result.leafRoot, lifecycle.platform)) {
          fs.rmSync(result.leafRoot, { recursive: true, force: true })
        } else {
          fs.rmdirSync(result.leafRoot)
        }
      } else {
        fs.rmSync(result.leafRoot, { force: true })
      }
    }
    result.complete = !fs.existsSync(result.leafRoot) && fs.existsSync(result.baseRoot)
    result.basePreserved = fs.existsSync(result.baseRoot)
  } catch (error) {
    result.complete = false
    result.errorCode = error?.code || null
  }
  return result
}

function quoteShellArgument(value, platform = process.platform) {
  const text = String(value)
  if (platform === 'win32') return "'" + text.replace(/'/gu, "''") + "'"
  return "'" + text.replace(/'/gu, "'\\''") + "'"
}

function buildFixtureCommand(options) {
  return [
    'node',
    quoteShellArgument(options.fixturePath, options.platform),
    quoteShellArgument(options.targetPath, options.platform),
    quoteShellArgument(options.payloadBase64, options.platform)
  ].join(' ')
}

function buildCodexArgs(options) {
  const args = options.approveForMe === true
    ? ['exec', '--approve-for-me']
    : ['-a', 'never', 'exec']
  args.push('-C', path.resolve(options.consumerRoot))
  if (options.approveForMe !== true) args.push('-s', 'workspace-write')
  args.push('--add-dir', path.resolve(options.addDir))
  if (options.ignoreUserConfig) args.push('--ignore-user-config')
  if (options.ignoreRules) args.push('--ignore-rules')
  for (const override of options.configOverrides || []) args.push('-c', String(override))
  if (options.bypassHookTrust) args.push('--dangerously-bypass-hook-trust')
  args.push('--json', '--ephemeral', '--skip-git-repo-check')
  if (options.outputLastMessagePath) {
    args.push('--output-last-message', path.resolve(options.outputLastMessagePath))
  }
  args.push('--color', 'never', String(options.prompt || ''))
  return args
}

const H0_CONTRACT_PROMPT = '<deterministic-single-command>'

/** Project the approval/sandbox semantics that are cryptographically bound by one H0 argv contract. */
function deriveH0StagePolicy(argvContract) {
  const argv = Array.isArray(argvContract) ? argvContract.map(String) : []
  const approveIndexes = argv.reduce((indexes, value, index) => {
    if (value === '--approve-for-me') indexes.push(index)
    return indexes
  }, [])
  const neverIndexes = argv.reduce((indexes, value, index) => {
    if (value === '-a' && argv[index + 1] === 'never') indexes.push(index)
    return indexes
  }, [])
  const sandboxIndexes = argv.reduce((indexes, value, index) => {
    if (value === '-s' && argv[index + 1] === 'workspace-write') indexes.push(index)
    return indexes
  }, [])
  const hasOtherSandboxFlag = argv.includes('--sandbox') || argv.some((value, index) =>
    value === '-s' && argv[index + 1] !== 'workspace-write')
  if (
    argv[0] === 'exec' &&
    approveIndexes.length === 1 && approveIndexes[0] === 1 &&
    neverIndexes.length === 0 && sandboxIndexes.length === 0 &&
    !hasOtherSandboxFlag
  ) {
    return {
      schemaVersion: 'RealHostH0StagePolicyV1',
      approvalPolicy: 'approve-for-me',
      sandboxMode: 'workspace-write',
      escalationAllowed: true
    }
  }
  if (
    argv[0] === '-a' && argv[1] === 'never' && argv[2] === 'exec' &&
    approveIndexes.length === 0 && neverIndexes.length === 1 && neverIndexes[0] === 0 &&
    sandboxIndexes.length === 1 && !hasOtherSandboxFlag
  ) {
    return {
      schemaVersion: 'RealHostH0StagePolicyV1',
      approvalPolicy: 'never',
      sandboxMode: 'workspace-write',
      escalationAllowed: false
    }
  }
  return null
}

function assertH0StageIdentityBinding(identity) {
  if (identity?.mode !== 'H0') return
  const topology = identity.topology || {}
  const contracts = topology.stageArgvContracts
  const policies = topology.stageApprovalPolicies
  if (!contracts && !policies) return // Historical H0 identities remain readable without migration.
  const stages = STAGE_ORDER.H0
  if (!contracts || !policies ||
      stableStringify(Object.keys(contracts).sort()) !== stableStringify([...stages].sort()) ||
      stableStringify(Object.keys(policies).sort()) !== stableStringify([...stages].sort())) {
    fail('REAL_HOST_IDENTITY_INVALID', 'H0 stage argv contracts and approval policies must bind both stages exactly')
  }
  if (stableStringify(identity.argvContract) !== stableStringify(contracts['H0-allowed'])) {
    fail('REAL_HOST_IDENTITY_INVALID', 'legacy argvContract must project the bound H0-allowed contract')
  }
  for (const stage of stages) {
    if (!Array.isArray(contracts[stage]) || contracts[stage].length === 0) {
      fail('REAL_HOST_IDENTITY_INVALID', stage + ' argv contract must be a non-empty array')
    }
    const derived = deriveH0StagePolicy(contracts[stage])
    if (!derived || stableStringify(derived) !== stableStringify(policies[stage])) {
      fail('REAL_HOST_IDENTITY_INVALID', stage + ' approval policy does not match its argv contract')
    }
  }
  const forbidden = policies['H0-forbidden']
  if (
    forbidden.approvalPolicy !== 'never' ||
    forbidden.sandboxMode !== 'workspace-write' ||
    forbidden.escalationAllowed !== false
  ) {
    fail('REAL_HOST_IDENTITY_INVALID', 'H0-forbidden must bind a non-escalatable workspace-write policy')
  }
}

function boundH0StageExecution(identity, stage) {
  const topology = identity?.topology || {}
  if (!topology.stageArgvContracts && !topology.stageApprovalPolicies) {
    return {
      legacy: true,
      argvContract: identity.argvContract.map(String),
      policy: deriveH0StagePolicy(identity.argvContract)
    }
  }
  assertH0StageIdentityBinding(identity)
  const argvContract = topology.stageArgvContracts?.[stage]
  const policy = topology.stageApprovalPolicies?.[stage]
  if (!Array.isArray(argvContract) || !policy) {
    fail('REAL_HOST_RUNTIME_BINDING_DRIFT', stage + ' is not bound by the immutable H0 stage contract')
  }
  return { legacy: false, argvContract: argvContract.map(String), policy }
}

function isTrustedForbiddenPolicy(policy) {
  return policy?.schemaVersion === 'RealHostH0StagePolicyV1' &&
    policy.approvalPolicy === 'never' &&
    policy.sandboxMode === 'workspace-write' &&
    policy.escalationAllowed === false
}

function normalizeObservedCommand(command) {
  return String(command || '').replace(/\r\n/gu, '\n').trim()
}

/** Derive the exact backslash-doubled command representation emitted by Windows Codex JSONL. */
function deriveWindowsDisplayCommand(expectedCommand) {
  const normalized = normalizeObservedCommand(expectedCommand)
  return normalized ? normalized.replace(/\\/gu, '\\\\') : ''
}

/** Return only exact command identities represented by a known single-command shell wrapper. */
function normalizeObservedCommandVariants(command, platform = process.platform, expectedCommands = []) {
  const normalized = normalizeObservedCommand(command)
  const variants = normalized ? [normalized] : []
  if (platform !== 'win32' || !normalized) return variants
  const wrapper = /^"([^"\r\n]+)"[ \t]+-Command[ \t]+"([^"\r\n]*)"$/iu.exec(normalized)
  if (!wrapper) return variants
  const executable = path.win32.basename(wrapper[1]).toLowerCase()
  if (!['pwsh.exe', 'powershell.exe'].includes(executable)) return variants
  const payload = normalizeObservedCommand(wrapper[2])
  if (payload) variants.push(payload)
  for (const expectedCommand of expectedCommands) {
    const expected = normalizeObservedCommand(expectedCommand)
    if (expected && payload === deriveWindowsDisplayCommand(expected)) variants.push(expected)
  }
  return [...new Set(variants)]
}

function extractCommand(item) {
  if (!item || typeof item !== 'object') return ''
  if (typeof item.command === 'string') return item.command
  if (typeof item.command_line === 'string') return item.command_line
  if (typeof item.commandLine === 'string') return item.commandLine
  if (typeof item.input?.command === 'string') return item.input.command
  return ''
}

function extractExitCode(item) {
  const value = item?.exit_code ?? item?.exitCode ?? item?.result?.exit_code ?? item?.result?.exitCode
  return Number.isInteger(value) ? value : null
}

function extractCommandOutput(item) {
  const values = [
    item?.aggregated_output,
    item?.aggregatedOutput,
    item?.output,
    item?.stderr,
    item?.error?.message,
    item?.result?.output,
    item?.result?.stderr,
    item?.result?.error?.message
  ]
  return values.filter(value => typeof value === 'string' && value.trim()).join('\n').trim()
}

function hasAccessDeniedEvidence(value) {
  const text = String(value || '')
  return /\b(?:EACCES|EPERM)\b|access (?:is )?denied|permission denied|operation not permitted|denied by (?:the )?sandbox|sandbox[^\r\n]{0,80}\bden(?:y|ied)\b|拒绝访问|权限不足|不允许的操作/iu.test(text) ||
    /(?:^|[\s`])rejected:\s*blocked by policy(?=$|[\s`])/iu.test(text) ||
    /(?:^|\r?\n)\s*blocked by policy\s*(?:$|\r?\n)/iu.test(text)
}

function parseCodexJsonl(stdout, expectedCommands = [], options = {}) {
  const platform = options.platform || process.platform
  const accepted = new Set(expectedCommands.map(normalizeObservedCommand))
  const observed = new Map()
  let invalidLineCount = 0
  let eventCount = 0
  const diagnostics = []
  const lines = String(stdout || '').split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      invalidLineCount += 1
      diagnostics.push({ line: index + 1, code: 'INVALID_JSONL', digest: sha256(Buffer.from(line, 'utf8')) })
      continue
    }
    eventCount += 1
    const item = event?.item && typeof event.item === 'object' ? event.item : event
    const itemType = String(item?.type || '')
    if (itemType !== 'command_execution' && itemType !== 'command') continue
    const command = extractCommand(item)
    const normalized = normalizeObservedCommand(command)
    const variants = normalizeObservedCommandVariants(command, platform, accepted)
    const exactIdentity = variants.find(value => accepted.has(value)) || null
    const id = String(item?.id || event?.item_id || normalized || 'command-' + index)
    const record = observed.get(id) || {
      id,
      command,
      exact: accepted.size > 0 && exactIdentity !== null,
      started: false,
      completed: false,
      exitCode: null,
      status: null,
      output: ''
    }
    if (record.command && command && normalizeObservedCommand(record.command) !== normalized) {
      record.commandIdentityDrift = true
    }
    if (!record.command && command) record.command = command
    if (exactIdentity !== null) record.exact = true
    const eventType = String(event?.type || '')
    const status = String(item?.status || '')
    if (eventType === 'item.started' || status === 'in_progress' || status === 'running') record.started = true
    if (
      eventType === 'item.completed' ||
      status === 'completed' ||
      status === 'failed' ||
      extractExitCode(item) !== null
    ) record.completed = true
    record.exitCode = extractExitCode(item) ?? record.exitCode
    record.status = status || record.status
    const commandOutput = extractCommandOutput(item)
    if (commandOutput) record.output = commandOutput.slice(-8000)
    observed.set(id, record)
  }
  const commandEvents = Array.from(observed.values())
  const exactEvents = commandEvents.filter(item => item.exact)
  return {
    schemaVersion: 'CodexJsonlCommandObservationV1',
    eventCount,
    invalidLineCount,
    commandEventCount: commandEvents.length,
    exactCommandInvocationCount: exactEvents.length,
    commandObserved: exactEvents.length === 1,
    commandCompleted: exactEvents.length === 1 && exactEvents[0].completed,
    commandExitCode: exactEvents.length === 1 ? exactEvents[0].exitCode : null,
    commandStatus: exactEvents.length === 1 ? exactEvents[0].status : null,
    commandOutputSha256: exactEvents.length === 1
      ? sha256(Buffer.from(exactEvents[0].output || '', 'utf8'))
      : null,
    commandOutputPreview: exactEvents.length === 1 ? (exactEvents[0].output || '').slice(-2000) : '',
    commandFailureAccessDenied: exactEvents.length === 1 && hasAccessDeniedEvidence(exactEvents[0].output),
    commandIdentityDrift: commandEvents.some(item => item.commandIdentityDrift === true),
    observedCommandDigests: commandEvents.map(item => ({
      id: item.id,
      digest: sha256(Buffer.from(normalizeObservedCommand(item.command), 'utf8')),
      exact: item.exact,
      completed: item.completed,
      exitCode: item.exitCode
    })),
    diagnostics
  }
}

function snapshotTree(root) {
  const resolved = assertRealDirectory('effectRoot', root)
  const result = {}
  const stack = [{ absolute: resolved, relative: '' }]
  while (stack.length) {
    const current = stack.pop()
    const entries = fs.readdirSync(current.absolute, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolute = path.join(current.absolute, entry.name)
      const relative = path.posix.join(current.relative.replace(/\\/gu, '/'), entry.name)
      const stat = fs.lstatSync(absolute)
      if (stat.isSymbolicLink()) {
        result[relative] = { type: 'symlink', target: fs.readlinkSync(absolute) }
      } else if (stat.isDirectory()) {
        result[relative] = { type: 'directory' }
        stack.push({ absolute, relative })
      } else if (stat.isFile()) {
        result[relative] = {
          type: 'file',
          bytes: stat.size,
          sha256: sha256(fs.readFileSync(absolute))
        }
      } else {
        result[relative] = { type: 'other' }
      }
    }
  }
  return result
}

function snapshotControlledRoots(roots) {
  return roots.reduce((result, entry) => {
    assertPlainToken('effect root label', entry.label)
    result[entry.label] = snapshotTree(entry.root)
    return result
  }, {})
}

function compareSnapshots(before, after, allowedChanges = []) {
  const allowed = new Map(allowedChanges.map(change => [
    change.root + ':' + String(change.path).replace(/\\/gu, '/'),
    change
  ]))
  const changes = []
  const labels = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort()
  for (const label of labels) {
    const left = before[label] || {}
    const right = after[label] || {}
    const names = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort()
    for (const name of names) {
      const beforeValue = left[name] || null
      const afterValue = right[name] || null
      if (stableStringify(beforeValue) === stableStringify(afterValue)) continue
      const key = label + ':' + name
      const expected = allowed.get(key)
      if (expected && stableStringify(expected.after) === stableStringify(afterValue)) {
        allowed.delete(key)
        continue
      }
      changes.push({ root: label, path: name, before: beforeValue, after: afterValue })
    }
  }
  return {
    schemaVersion: 'RealHostEffectDiffV1',
    clean: changes.length === 0 && allowed.size === 0,
    unexpectedChanges: changes,
    missingExpectedChanges: Array.from(allowed.values())
  }
}

function partitionInstalledRuntimeEffects(effects, identity) {
  if (identity?.mode !== 'installed' || identity.oracle?.h1?.runtimeEffectPolicy !== 'installed-runtime-v1') return effects
  const home = identity.topology?.probeEffectRoots?.find(entry => entry.label === 'globalHome')?.root
  const runtime = identity.installedRuntime?.root
  const project = path.basename(identity.topology?.addDir || '')
  if (!home || !runtime || !isPathInside(home, runtime) || !/^[A-Za-z0-9_-]+$/u.test(project)) return effects
  const runtimeRelative = path.relative(home, runtime).replace(/\\/gu, '/')
  const generation = /^\.codex\/devcodex\/runtime-([A-Za-z0-9._-]+)$/u.exec(runtimeRelative)?.[1]
  if (!generation) return effects
  const hookRoot = '.memory/hooks/' + project
  const leaseRoot = '.codex/devcodex/.runtime-generation-leases/' + generation
  const ownedRuntimeChanges = []
  const unexpectedChanges = []
  for (const change of effects.unexpectedChanges || []) {
    const name = change.path
    const ordinaryFile = [change.before, change.after].every(value => !value || value.type === 'file')
    const createdDirectory = !change.before && change.after?.type === 'directory'
    let owned = false
    if (change.root === 'addDir') {
      const parents = ['.memory', '.memory/hooks', hookRoot, hookRoot + '/v5']
      owned = createdDirectory && parents.includes(name)
      if (ordinaryFile && name.startsWith(hookRoot + '/')) {
        const relative = name.slice(hookRoot.length + 1)
        owned = /^(?:lifecycle-state\.json|v5\/(?:ephemeral-[ab]\.json|telemetry-[0-9]+\.ndjson))$/u.test(relative)
      }
    } else if (change.root === 'globalHome') {
      owned = createdDirectory && ['.codex/devcodex/.runtime-generation-leases', leaseRoot].includes(name)
      if (ordinaryFile) {
        owned = name === '.codex/models_cache.json' ||
          /^\.codex\/(?:state|goals|logs|memories)_[0-9]+\.sqlite(?:-shm|-wal)?$/u.test(name) ||
          /^AppData\/Local\/Microsoft\/PowerShell\/(?:ModuleAnalysisCache-[A-Fa-f0-9]+|StartupProfileData-NonInteractive)$/u.test(name) ||
          (name.startsWith(leaseRoot + '/') && /^(?:memory|profile)-mcp-[a-f0-9]{8}-[0-9]+\.json$/u.test(name.slice(leaseRoot.length + 1)))
      }
    }
    ;(owned ? ownedRuntimeChanges : unexpectedChanges).push(change)
  }
  return { ...effects, clean: unexpectedChanges.length === 0 && effects.missingExpectedChanges.length === 0,
    unexpectedChanges, ownedRuntimeChanges, runtimeEffectPolicy: 'installed-runtime-v1' }
}

function canContinueIndependentInstalledTurn(receipt) {
  return receipt?.stage === 'H1' && receipt.status === 'UNVERIFIED' && receipt.code === 'HOST_ADD_DIR_WRITE_DENIED' &&
    receipt.expectation === 'allowed' && receipt.forbiddenRoot === null &&
    receipt.child?.spawned === true && receipt.child.exitCode === 0 && receipt.child.timedOut === false &&
    receipt.observation?.commandObserved === true && receipt.observation.commandCompleted === true &&
    receipt.observation.invalidLineCount === 0 && receipt.observation.commandIdentityDrift !== true &&
    receipt.observation.commandEventCount === 1 && receipt.observation.commandFailureAccessDenied === true &&
    Number.isInteger(receipt.observation.commandExitCode) && receipt.observation.commandExitCode !== 0 &&
    receipt.marker?.exists === false && Array.isArray(receipt.effects?.unexpectedChanges) &&
    receipt.effects.unexpectedChanges.length === 0 && receipt.effects.runtimeEffectPolicy === 'installed-runtime-v1' &&
    receipt.cleanup?.markerAbsent === true && receipt.cleanup.fixtureAbsent === true &&
    receipt.cleanup.childTreeReleased === true && receipt.cleanup.failures?.length === 0
}

/** Freeze the source, host, topology, authorization and oracle into one run identity. */
function createRunIdentity(input) {
  assertHexDigest('sourceCandidate', input.sourceCandidate)
  assertHexDigest('authorizationDigest', input.authorizationDigest)
  assertPlainToken('mode', input.mode)
  if (!['H0', 'installed', 'unit'].includes(input.mode)) {
    fail('REAL_HOST_IDENTITY_INVALID', 'mode must be H0, installed or unit')
  }
  if (!String(input.codexVersion || '').trim()) fail('REAL_HOST_IDENTITY_INVALID', 'codexVersion is required')
  if (!Array.isArray(input.argvContract) || input.argvContract.length === 0) {
    fail('REAL_HOST_IDENTITY_INVALID', 'argvContract must be a non-empty array')
  }
  const identity = {
    schemaVersion: RUN_SCHEMA,
    mode: input.mode,
    sourceCandidate: String(input.sourceCandidate).toLowerCase(),
    codexVersion: String(input.codexVersion).trim(),
    codexExecutable: path.resolve(input.codexExecutable),
    argvContract: input.argvContract.map(String),
    topology: normalizeForStableJson(input.topology || {}),
    oracle: normalizeForStableJson(input.oracle || null),
    authorizationDigest: String(input.authorizationDigest).toLowerCase(),
    tarball: input.tarball || null,
    installedRuntime: input.installedRuntime || null
  }
  if (identity.tarball?.sha256) assertHexDigest('tarball.sha256', identity.tarball.sha256)
  assertInstalledIdentityBinding(identity)
  assertForbiddenEligibilityIdentityBinding(identity)
  assertH0StageIdentityBinding(identity)
  const digest = digestObject(identity)
  return { ...identity, digest }
}

function assertForbiddenEligibilityIdentityBinding(identity) {
  const binding = identity?.topology?.forbiddenEligibility
  if (!binding) return
  if (
    identity.mode !== 'H0' ||
    binding.schemaVersion !== FORBIDDEN_ELIGIBILITY_SCHEMA ||
    binding.status !== 'PASS' ||
    !binding.canonicalLeaf ||
    !binding.canonicalParent ||
    !samePath(binding.canonicalLeaf, identity.topology.forbiddenRoot)
  ) {
    fail('REAL_HOST_IDENTITY_INVALID', 'H0 forbidden eligibility identity binding is invalid')
  }
  for (const field of [
    'effectiveAclDigest',
    'sddlDigest',
    'ambientWritableRootsDigest',
    'sandboxPrincipalWriteDigest',
    'eligibilityDigest'
  ]) {
    assertHexDigest('topology.forbiddenEligibility.' + field, binding[field])
  }
}

function validateEvidenceRoot(evidenceRoot, forbiddenRoots = []) {
  const root = assertRealDirectory('evidenceRoot', evidenceRoot)
  for (const forbidden of forbiddenRoots.filter(Boolean)) {
    const resolved = path.resolve(forbidden)
    if (samePath(root, resolved) || isPathInside(resolved, root) || isPathInside(root, resolved)) {
      fail('REAL_HOST_EVIDENCE_ROOT_INVALID', 'evidenceRoot must stay outside source, HOME and probe roots', {
        evidenceRoot: root,
        forbiddenRoot: resolved
      })
    }
  }
  return root
}

function collectHostHomeRoots(env = process.env) {
  const roots = []
  for (const candidate of [env.USERPROFILE, env.HOME, env.CODEX_HOME]) {
    if (!String(candidate || '').trim()) continue
    const resolved = path.resolve(candidate)
    if (!roots.some(existing => samePath(existing, resolved))) roots.push(resolved)
  }
  return roots
}

function detachCodexTaskEnvironment(env = process.env) {
  return {
    ...env,
    CODEX_THREAD_ID: '',
    CODEX_INTERNAL_ORIGINATOR_OVERRIDE: '',
    DEVCODEX_HOST_SESSION_ID: '',
    DEVCODEX_TASK_RECOVERY_KEY: ''
  }
}

function isNonterminalH3SafePartial(input) {
  const taskId = String(input?.taskId || '').trim()
  const expectedTaskId = String(input?.expectedTaskId || '').trim()
  const terminalStatus = String(input?.terminalStatus || '').trim()
  const admissionPhase = String(input?.admissionPhase || '').trim()
  const ownerStatus = String(input?.ownerStatus || '').trim()
  return Boolean(
    taskId &&
    expectedTaskId &&
    taskId === expectedTaskId &&
    input?.taskRoot &&
    input?.expectedTaskRoot &&
    samePath(input.taskRoot, input.expectedTaskRoot) &&
    Number.isInteger(input?.admissionGeneration) &&
    Number.isInteger(input?.baselineAdmissionGeneration) &&
    input.admissionGeneration > input.baselineAdmissionGeneration &&
    Number.isInteger(input?.canonicalRevision) &&
    Number.isInteger(input?.baselineCanonicalRevision) &&
    input.canonicalRevision >= input.baselineCanonicalRevision &&
    terminalStatus === '' &&
    admissionPhase === 'finalized' &&
    ownerStatus === 'released'
  )
}

function writeJsonExclusive(target, value) {
  const content = JSON.stringify(value, null, 2) + '\n'
  fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' })
  const readback = fs.readFileSync(target, 'utf8')
  if (readback !== content) fail('REAL_HOST_LEDGER_READBACK_FAILED', 'attempt ledger readback mismatch', { path: target })
  return sha256(Buffer.from(content, 'utf8'))
}

function readLedgerJson(target, label) {
  let stat
  let bytes
  try {
    stat = fs.lstatSync(target)
    bytes = fs.readFileSync(target)
  } catch (error) {
    fail('REAL_HOST_LEDGER_INTEGRITY_FAILED', label + ' is missing or unreadable', {
      path: target,
      cause: error?.code || error?.message || null
    })
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail('REAL_HOST_LEDGER_INTEGRITY_FAILED', label + ' must remain a physical file', { path: target })
  }
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    fail('REAL_HOST_LEDGER_INTEGRITY_FAILED', label + ' is not valid JSON', {
      path: target,
      cause: error?.message || null
    })
  }
  return { value, bytes, digest: sha256(bytes) }
}

function assertRunIdentity(identity) {
  const payload = {
    schemaVersion: identity?.schemaVersion,
    mode: identity?.mode,
    sourceCandidate: identity?.sourceCandidate,
    codexVersion: identity?.codexVersion,
    codexExecutable: identity?.codexExecutable,
    argvContract: identity?.argvContract,
    topology: identity?.topology,
    oracle: identity?.oracle,
    authorizationDigest: identity?.authorizationDigest,
    tarball: identity?.tarball,
    installedRuntime: identity?.installedRuntime
  }
  if (
    identity?.schemaVersion !== RUN_SCHEMA ||
    !['H0', 'installed', 'unit'].includes(identity?.mode) ||
    identity?.digest !== digestObject(payload)
  ) {
    fail('REAL_HOST_IDENTITY_INVALID', 'run identity digest mismatch')
  }
  assertHexDigest('sourceCandidate', identity.sourceCandidate)
  assertHexDigest('authorizationDigest', identity.authorizationDigest)
  assertInstalledIdentityBinding(identity)
  assertForbiddenEligibilityIdentityBinding(identity)
  assertH0StageIdentityBinding(identity)
  if (!Array.isArray(identity.argvContract) || identity.argvContract.length === 0) {
    fail('REAL_HOST_IDENTITY_INVALID', 'run identity argvContract is missing')
  }
  return identity
}

/** Consume one authorization and create its physical, cross-process attempt ledger. */
function initializeAttemptLedger(options) {
  const identity = options.identity
  assertRunIdentity(identity)
  const evidenceRoot = validateEvidenceRoot(options.evidenceRoot, options.forbiddenRoots)
  const authorizationClaim = path.join(evidenceRoot, 'authorization-' + identity.authorizationDigest + '.json')
  try {
    writeJsonExclusive(authorizationClaim, {
      schemaVersion: 'RealHostAuthorizationConsumptionV1',
      authorizationDigest: identity.authorizationDigest,
      runDigest: identity.digest,
      mode: identity.mode,
      consumedAt: new Date().toISOString()
    })
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail('REAL_HOST_ATTEMPT_ALREADY_CONSUMED', 'this real-host authorization was already consumed', {
        authorizationDigest: identity.authorizationDigest
      })
    }
    throw error
  }
  const runDir = path.join(evidenceRoot, identity.digest)
  try {
    fs.mkdirSync(runDir)
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail('REAL_HOST_ATTEMPT_ALREADY_CONSUMED', 'this real-host run identity already exists', {
        runDigest: identity.digest
      })
    }
    throw error
  }
  writeJsonExclusive(path.join(runDir, 'run.json'), {
    schemaVersion: LEDGER_SCHEMA,
    identity,
    createdAt: new Date().toISOString()
  })
  return { schemaVersion: LEDGER_SCHEMA, evidenceRoot, runDir, identity }
}

function openAttemptLedger(options) {
  assertRunIdentity(options.identity)
  const evidenceRoot = validateEvidenceRoot(options.evidenceRoot, options.forbiddenRoots)
  const expectedRunDir = path.join(evidenceRoot, options.identity.digest)
  if (!fs.existsSync(expectedRunDir)) fail('REAL_HOST_LEDGER_MISSING', 'real-host run ledger does not exist')
  const runDirStat = fs.lstatSync(expectedRunDir)
  if (!runDirStat.isDirectory() || runDirStat.isSymbolicLink()) {
    fail('REAL_HOST_LEDGER_INTEGRITY_FAILED', 'real-host run ledger must remain a physical directory')
  }
  const runDir = fs.realpathSync.native(expectedRunDir)
  if (!samePath(runDir, expectedRunDir) || !isPathInside(evidenceRoot, runDir)) {
    fail('REAL_HOST_LEDGER_INTEGRITY_FAILED', 'real-host run ledger escaped its evidence root')
  }
  const runPath = path.join(runDir, 'run.json')
  if (!fs.existsSync(runPath)) fail('REAL_HOST_LEDGER_MISSING', 'real-host run ledger does not exist')
  const stored = readLedgerJson(runPath, 'real-host run ledger').value
  if (stored.schemaVersion !== LEDGER_SCHEMA || stableStringify(stored.identity) !== stableStringify(options.identity)) {
    fail('REAL_HOST_LEDGER_IDENTITY_DRIFT', 'real-host run ledger identity changed')
  }
  assertRunIdentity(stored.identity)
  const authorizationClaimPath = path.join(
    evidenceRoot,
    'authorization-' + options.identity.authorizationDigest + '.json'
  )
  const authorizationClaim = readLedgerJson(
    authorizationClaimPath,
    'real-host authorization claim'
  ).value
  if (
    authorizationClaim.schemaVersion !== 'RealHostAuthorizationConsumptionV1' ||
    authorizationClaim.authorizationDigest !== options.identity.authorizationDigest ||
    authorizationClaim.runDigest !== options.identity.digest ||
    authorizationClaim.mode !== options.identity.mode
  ) {
    fail('REAL_HOST_LEDGER_INTEGRITY_FAILED', 'real-host authorization claim identity drifted', {
      path: authorizationClaimPath
    })
  }
  return { schemaVersion: LEDGER_SCHEMA, evidenceRoot, runDir, identity: stored.identity }
}

function attemptDirectory(ledger, stage, attempt) {
  assertPlainToken('stage', stage)
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 2) {
    fail('REAL_HOST_ATTEMPT_INVALID', 'attempt must be 1 or 2')
  }
  return path.join(ledger.runDir, stage, 'attempt-' + String(attempt).padStart(2, '0'))
}

function readAttemptTerminal(ledger, stage, attempt) {
  const target = path.join(attemptDirectory(ledger, stage, attempt), '03-terminal.json')
  if (!fs.existsSync(target)) return null
  const terminal = readLedgerJson(target, 'attempt terminal').value
  if (
    terminal.schemaVersion !== 'RealHostAttemptTerminalV1' ||
    terminal.runDigest !== ledger.identity.digest ||
    terminal.stage !== stage ||
    terminal.attempt !== attempt ||
    !['PASS', 'BLOCK', 'UNVERIFIED'].includes(terminal.status)
  ) {
    fail('REAL_HOST_LEDGER_INTEGRITY_FAILED', 'attempt terminal identity or status drifted', { path: target })
  }
  if (terminal.status === 'PASS' && ledger.identity.mode !== 'unit' && !terminal.receiptDigest) {
    fail('REAL_HOST_LEDGER_INTEGRITY_FAILED', 'a qualifying real-host terminal must bind one receipt', { path: target })
  }
  if (terminal.receiptDigest) {
    assertHexDigest('receiptDigest', terminal.receiptDigest)
    const receipts = ['probe-receipt.json', 'turn-receipt.json']
      .map(name => path.join(path.dirname(target), name))
      .filter(candidate => fs.existsSync(candidate))
    if (receipts.length !== 1 || readLedgerJson(receipts[0], 'attempt receipt').digest !== terminal.receiptDigest) {
      fail('REAL_HOST_LEDGER_INTEGRITY_FAILED', 'attempt receipt digest drifted', { path: target })
    }
  }
  return terminal
}

function assertStagePredecessor(ledger, stage) {
  const order = STAGE_ORDER[ledger.identity.mode] || []
  const index = order.indexOf(stage)
  if (ledger.identity.mode !== 'unit' && index < 0) {
    fail('REAL_HOST_STAGE_INVALID', stage + ' is not valid for ' + ledger.identity.mode)
  }
  if (index <= 0) return
  const previous = readAttemptTerminal(ledger, order[index - 1], 2) ||
    readAttemptTerminal(ledger, order[index - 1], 1)
  if (ledger.identity.mode === 'installed' && stage === 'H2' && previous?.status === 'UNVERIFIED' &&
      previous.code === 'HOST_ADD_DIR_WRITE_DENIED' && previous.receiptDigest &&
      ledger.identity.oracle?.h1?.runtimeEffectPolicy === 'installed-runtime-v1') {
    const receipt = readLedgerJson(path.join(attemptDirectory(ledger, 'H1', previous.attempt), 'probe-receipt.json'), 'H1 receipt').value
    if (canContinueIndependentInstalledTurn(receipt)) return
  }
  if (!previous || previous.status !== 'PASS') {
    fail('REAL_HOST_STAGE_PREDECESSOR_INCOMPLETE', stage + ' requires PASS from ' + order[index - 1])
  }
}

function assertRuntimeBinding(options, operation) {
  const identity = options.ledger.identity
  assertRunIdentity(identity)
  if (identity.mode === 'unit') return
  const topology = identity.topology || {}
  const bindings = [
    ['consumerRoot', options.consumerRoot, topology.processCwd],
    ['cliCwd', options.consumerRoot, topology.cliCwd],
    ['addDir', options.addDir, topology.addDir],
    ['codexExecutable', options.codexExecutable, identity.codexExecutable]
  ]
  if (identity.mode === 'H0') {
    bindings.push(['forbiddenRoot', options.forbiddenRoot, topology.forbiddenRoot])
  }
  for (const [label, actual, expected] of bindings) {
    if (!actual || !expected || !samePath(actual, expected)) {
      fail('REAL_HOST_RUNTIME_BINDING_DRIFT', label + ' differs from the immutable run identity')
    }
  }
  const observedCodexVersion = readCodexVersion(options.codexExecutable, options.env)
  if (observedCodexVersion !== identity.codexVersion) {
    fail('REAL_HOST_RUNTIME_BINDING_DRIFT', 'Codex CLI version differs from the immutable run identity')
  }
  const expectedOperation = identity.mode === 'H0' || options.stage === 'H1' ? 'probe' : 'turn'
  if (operation !== expectedOperation) {
    fail('REAL_HOST_RUNTIME_BINDING_DRIFT', options.stage + ' cannot execute as ' + operation)
  }
  if (identity.mode === 'H0') {
    const eligibility = topology.forbiddenEligibility
    if (eligibility && options.forbiddenEligibilityDigest !== eligibility.eligibilityDigest) {
      fail('REAL_HOST_RUNTIME_BINDING_DRIFT', 'H0 forbidden eligibility differs from the immutable run identity')
    }
    const stageExecution = boundH0StageExecution(identity, options.stage)
    const boundPolicy = stageExecution.policy
    const boundApproveForMe = boundPolicy?.approvalPolicy === 'approve-for-me'
    const boundNever = boundPolicy?.approvalPolicy === 'never'
    const runtimeApproveForMe = options.approveForMe === true
    if ((!boundApproveForMe && !boundNever) || runtimeApproveForMe !== boundApproveForMe) {
      fail('REAL_HOST_RUNTIME_BINDING_DRIFT', 'H0 approval strategy differs from the immutable run identity')
    }
    if (
      options.ignoreUserConfig !== true ||
      options.ignoreRules !== true ||
      options.bypassHookTrust === true ||
      (options.configOverrides || []).length > 0
    ) {
      fail('REAL_HOST_RUNTIME_BINDING_DRIFT', 'H0 isolation arguments differ from the run identity')
    }
    if (!stageExecution.legacy) {
      const runtimeArgvContract = buildCodexArgs({
        consumerRoot: options.consumerRoot,
        addDir: options.addDir,
        approveForMe: runtimeApproveForMe,
        ignoreUserConfig: options.ignoreUserConfig === true,
        ignoreRules: options.ignoreRules === true,
        configOverrides: options.configOverrides,
        bypassHookTrust: options.bypassHookTrust === true,
        prompt: H0_CONTRACT_PROMPT
      })
      if (stableStringify(runtimeArgvContract) !== stableStringify(stageExecution.argvContract) ||
          stableStringify(deriveH0StagePolicy(runtimeArgvContract)) !== stableStringify(boundPolicy)) {
        fail('REAL_HOST_RUNTIME_BINDING_DRIFT', 'H0 stage argv contract differs from the immutable run identity')
      }
    }
    const effectRoots = options.additionalEffectRoots || []
    const isolatedHome = effectRoots.find(entry => entry.label === 'isolatedHome')
    if (
      effectRoots.length !== 1 ||
      !isolatedHome?.root ||
      isolatedHome.ownedMutable !== true ||
      !topology.isolatedHome ||
      !samePath(isolatedHome.root, topology.isolatedHome)
    ) {
      fail('REAL_HOST_RUNTIME_BINDING_DRIFT', 'H0 isolated HOME effect root differs from the run identity')
    }
  } else if (
    options.ignoreUserConfig === true ||
    options.ignoreRules === true ||
    options.bypassHookTrust !== true
  ) {
    fail('REAL_HOST_RUNTIME_BINDING_DRIFT', 'installed host arguments differ from the run identity')
  }
  if (identity.mode === 'installed') {
    const boundOverrides = identity.argvContract
      .filter(value => String(value).startsWith('-c='))
      .map(value => String(value).slice(3))
    const actualOverrides = (options.configOverrides || []).map(String)
    if (stableStringify(boundOverrides) !== stableStringify(actualOverrides)) {
      fail('REAL_HOST_RUNTIME_BINDING_DRIFT', 'installed config overrides differ from the run identity')
    }
    if (operation === 'probe') {
      const expectedEffectRoots = Array.isArray(topology.probeEffectRoots)
        ? [...topology.probeEffectRoots].sort((left, right) => String(left.label).localeCompare(String(right.label)))
        : []
      const actualEffectRoots = [...(options.additionalEffectRoots || [])]
        .sort((left, right) => String(left.label).localeCompare(String(right.label)))
      const exactEffectRoots = expectedEffectRoots.length === actualEffectRoots.length &&
        expectedEffectRoots.every((expected, index) => {
          const actual = actualEffectRoots[index]
          return expected?.label === actual?.label && expected?.root && actual?.root &&
            samePath(expected.root, actual.root) &&
            (expected.ownedMutable === true) === (actual.ownedMutable === true)
        })
      if (!exactEffectRoots) {
        fail('REAL_HOST_RUNTIME_BINDING_DRIFT', 'installed H1 effect roots differ from the run identity')
      }
    }
  }
}

/** Claim one bounded stage attempt before any Codex child is started. */
function claimAttempt(ledger, stage, attempt = 1, retrySafety = null) {
  assertStagePredecessor(ledger, stage)
  const directory = attemptDirectory(ledger, stage, attempt)
  if (attempt === 2) {
    const previous = readAttemptTerminal(ledger, stage, 1)
    const safePartial = retrySafety?.safePartial === true
    if (!previous || previous.retryEligible !== true || (stage === 'H3' && !safePartial)) {
      fail('REAL_HOST_RETRY_NOT_ELIGIBLE', 'a second attempt requires a proven safe partial or pre-command zero-effect failure')
    }
    if (stage === 'H3') {
      const prior = previous.summary || {}
      const exactSuccessor = previous.status === 'UNVERIFIED' &&
        previous.state === 'needs-review' &&
        previous.code === 'FORMAL_G2_SAFE_PARTIAL' &&
        prior.safePartial === true &&
        String(prior.taskId || '').length > 0 &&
        String(prior.taskId || '') === String(retrySafety.taskId || '') &&
        prior.taskRoot && retrySafety.taskRoot && samePath(prior.taskRoot, retrySafety.taskRoot) &&
        Number.isInteger(prior.admissionGeneration) &&
        Number.isInteger(retrySafety.admissionGeneration) &&
        prior.admissionGeneration === retrySafety.admissionGeneration &&
        Number.isInteger(prior.canonicalRevision) &&
        Number.isInteger(retrySafety.canonicalRevision) &&
        prior.canonicalRevision === retrySafety.canonicalRevision &&
        prior.admissionPhase === 'finalized' &&
        retrySafety.admissionPhase === prior.admissionPhase &&
        prior.ownerStatus === 'released' &&
        retrySafety.ownerStatus === prior.ownerStatus
      if (!exactSuccessor) {
        fail('REAL_HOST_RETRY_NOT_ELIGIBLE', 'H3 retry must match the durable nonterminal safe-partial receipt')
      }
    }
  }
  if (fs.existsSync(path.dirname(directory)) && (
    fs.existsSync(path.join(path.dirname(directory), 'attempt-01', '03-terminal.json')) ||
    fs.existsSync(path.join(path.dirname(directory), 'attempt-02'))
  ) && attempt === 1) {
    fail('REAL_HOST_ATTEMPT_ALREADY_CONSUMED', stage + ' was already attempted')
  }
  try {
    fs.mkdirSync(path.dirname(directory), { recursive: true })
    fs.mkdirSync(directory)
  } catch (error) {
    if (error?.code === 'EEXIST') fail('REAL_HOST_ATTEMPT_ALREADY_CONSUMED', stage + ' attempt already exists')
    throw error
  }
  const planned = {
    schemaVersion: 'RealHostAttemptTransitionV1',
    runDigest: ledger.identity.digest,
    stage,
    attempt,
    state: 'planned',
    at: new Date().toISOString(),
    retrySafety: retrySafety || null
  }
  writeJsonExclusive(path.join(directory, '00-planned.json'), planned)
  return { ledger, stage, attempt, directory }
}

function writeAttemptTransition(attemptRef, ordinal, state, details = {}) {
  const target = path.join(attemptRef.directory, ordinal + '-' + state + '.json')
  return writeJsonExclusive(target, {
    schemaVersion: 'RealHostAttemptTransitionV1',
    runDigest: attemptRef.ledger.identity.digest,
    stage: attemptRef.stage,
    attempt: attemptRef.attempt,
    state,
    at: new Date().toISOString(),
    ...details
  })
}

function finalizeAttempt(attemptRef, details) {
  if (!['PASS', 'BLOCK', 'UNVERIFIED'].includes(details.status)) {
    fail('REAL_HOST_ATTEMPT_INVALID', 'terminal status must be PASS, BLOCK or UNVERIFIED')
  }
  if (details.receiptDigest) assertHexDigest('receiptDigest', details.receiptDigest)
  const target = path.join(attemptRef.directory, '03-terminal.json')
  if (fs.existsSync(target)) fail('REAL_HOST_ATTEMPT_ALREADY_CONSUMED', 'attempt is already terminal')
  writeJsonExclusive(target, {
    schemaVersion: 'RealHostAttemptTerminalV1',
    runDigest: attemptRef.ledger.identity.digest,
    stage: attemptRef.stage,
    attempt: attemptRef.attempt,
    state: details.state || 'terminal',
    status: details.status,
    code: details.code || null,
    retryEligible: details.retryEligible === true,
    summary: details.summary || null,
    receiptDigest: details.receiptDigest || null,
    at: new Date().toISOString()
  })
  return JSON.parse(fs.readFileSync(target, 'utf8'))
}

function isPidAlive(pid, options = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  const platform = options.platform || process.platform
  const fsImpl = options.fs || fs
  const kill = options.kill || process.kill.bind(process)
  if (platform === 'linux') {
    try {
      const stat = fsImpl.readFileSync(`/proc/${pid}/stat`, 'utf8')
      const nameEnd = stat.lastIndexOf(')')
      const state = nameEnd >= 0 ? stat.slice(nameEnd + 1).trimStart()[0] : ''
      if (state === 'Z' || state === 'X') return false
    } catch (error) {
      if (error?.code === 'ENOENT') return false
    }
  }
  try {
    kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

const PID_EXIT_WAIT_SIGNAL = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))

function waitForPidExit(pid, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (isPidAlive(pid)) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    Atomics.wait(PID_EXIT_WAIT_SIGNAL, 0, 0, Math.min(25, remaining))
  }
  return true
}

function isOwnedCleanupComplete(cleanup) {
  if (!cleanup || cleanup.stillRunning === true) return false
  if (cleanup.attempted !== true) return true
  return cleanup.exitCode === 0 && !cleanup.errorCode
}

function terminateOwnedProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { attempted: false, method: 'none', pid: null, exitCode: null, stillRunning: false }
  }
  let result
  if (process.platform === 'win32') {
    result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000
    })
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
      result = { status: 0, signal: null, error: null, stdout: '', stderr: '' }
    } catch (error) {
      result = { status: null, signal: null, error, stdout: '', stderr: '' }
    }
  }
  const stillRunning = process.platform === 'win32'
    ? isPidAlive(pid)
    : !waitForPidExit(pid)
  return {
    attempted: true,
    method: process.platform === 'win32' ? 'taskkill-exact-pid-tree' : 'kill-exact-process-group',
    pid,
    exitCode: result.status,
    signal: result.signal || null,
    errorCode: result.error?.code || null,
    stillRunning
  }
}

function appendBounded(chunks, chunk, state) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
  state.bytes += buffer.length
  if (state.bytes > MAX_OUTPUT_BYTES) {
    state.overflow = true
    const remaining = Math.max(0, MAX_OUTPUT_BYTES - (state.bytes - buffer.length))
    if (remaining > 0) chunks.push(buffer.subarray(0, remaining))
  } else {
    chunks.push(buffer)
  }
}

/** Run one owned child with bounded output, deadline and exact PID-tree cleanup evidence. */
function runOwnedChild(options) {
  return new Promise(resolve => {
    const startedAt = Date.now()
    const stdout = []
    const stderr = []
    const stdoutState = { bytes: 0, overflow: false }
    const stderrState = { bytes: 0, overflow: false }
    let child
    let timer
    let cleanupSettleTimer
    let settled = false
    let timedOut = false
    let spawnError = null
    let orchestrationError = null
    let interruptedSignal = null
    let cleanupTriggered = false
    let cleanup = { attempted: false, method: 'none', pid: null, exitCode: null, stillRunning: false }
    const signalHandlers = new Map()
    const removeSignalHandlers = () => {
      for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler)
      signalHandlers.clear()
    }
    const settle = (exitCode, signal, cleanupObservationTimedOut = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(cleanupSettleTimer)
      removeSignalHandlers()
      if (cleanup.attempted) {
        cleanup = {
          ...cleanup,
          stillRunning: isPidAlive(child?.pid),
          cleanupObservationTimedOut
        }
      }
      if (cleanupObservationTimedOut) {
        try { child?.stdout?.destroy() } catch {}
        try { child?.stderr?.destroy() } catch {}
        try { child?.unref() } catch {}
      }
      resolve({
        spawned: Boolean(child?.pid),
        pid: child?.pid || null,
        exitCode,
        signal: signal || null,
        timedOut,
        spawnError: spawnError ? { code: spawnError.code || null, message: spawnError.message } : null,
        orchestrationError: orchestrationError
          ? { code: orchestrationError.code || null, message: orchestrationError.message }
          : null,
        interruptedSignal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdoutOverflow: stdoutState.overflow,
        stderrOverflow: stderrState.overflow,
        durationMs: Date.now() - startedAt,
        cleanup
      })
    }
    const requestCleanup = () => {
      if (cleanupTriggered || !child?.pid) return
      cleanupTriggered = true
      const terminate = typeof options.terminateProcessTree === 'function'
        ? options.terminateProcessTree
        : terminateOwnedProcessTree
      try {
        cleanup = terminate(child.pid)
      } catch (error) {
        cleanup = {
          attempted: true,
          method: 'exact-pid-tree-cleanup-threw',
          pid: child.pid,
          exitCode: null,
          errorCode: error?.code || 'CLEANUP_EXCEPTION',
          stillRunning: isPidAlive(child.pid)
        }
      }
      const cleanupSettleTimeoutMs = Number.isInteger(options.cleanupSettleTimeoutMs)
        ? Math.max(50, Math.min(options.cleanupSettleTimeoutMs, 30000))
        : 5000
      cleanupSettleTimer = setTimeout(() => settle(null, null, true), cleanupSettleTimeoutMs)
    }
    try {
      child = spawn(options.command, options.args || [], {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      resolve({
        spawned: false,
        pid: null,
        exitCode: null,
        signal: null,
        timedOut: false,
        spawnError: { code: error.code || null, message: error.message },
        stdout: '',
        stderr: '',
        durationMs: Date.now() - startedAt,
        cleanup
      })
      return
    }
    child.stdout.on('data', chunk => {
      appendBounded(stdout, chunk, stdoutState)
      if (stdoutState.overflow) requestCleanup()
    })
    child.stderr.on('data', chunk => {
      appendBounded(stderr, chunk, stderrState)
      if (stderrState.overflow) requestCleanup()
    })
    child.once('spawn', () => {
      if (typeof options.onSpawn === 'function') {
        try {
          options.onSpawn(child.pid)
        } catch (error) {
          orchestrationError = error
          requestCleanup()
        }
      }
    })
    child.once('error', error => {
      spawnError = error
    })
    const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS
    timer = setTimeout(() => {
      timedOut = true
      requestCleanup()
    }, timeoutMs)
    for (const signal of ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? [] : ['SIGHUP'])]) {
      const handler = () => {
        interruptedSignal = signal
        requestCleanup()
      }
      signalHandlers.set(signal, handler)
      process.once(signal, handler)
    }
    child.once('close', (exitCode, signal) => {
      if ((timedOut || stdoutState.overflow || stderrState.overflow) && isPidAlive(child.pid)) {
        requestCleanup()
      }
      settle(exitCode, signal)
    })
  })
}

function resolveCodexExecutable(explicit, env = process.env) {
  if (explicit) {
    const resolved = path.resolve(explicit)
    if (!fs.existsSync(resolved) || !fs.lstatSync(resolved).isFile()) {
      fail('REAL_HOST_CODEX_NOT_FOUND', 'explicit Codex executable is not a regular file', { path: resolved })
    }
    return resolved
  }
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex']
  const executable = names.map(name => resolveExecutableOnPath(name, env)).find(Boolean)
  if (!executable) fail('REAL_HOST_CODEX_NOT_FOUND', 'Codex executable was not found on PATH')
  return executable
}

function resolveLaunch(executable, args, env) {
  return process.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(executable)
    ? resolveWindowsBatchInvocation(executable, args, env)
    : { command: executable, args }
}

function readCodexVersion(executable, env = process.env) {
  const invocation = resolveLaunch(executable, ['--version'], env)
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    env,
    windowsHide: true,
    timeout: 30000
  })
  if (result.status !== 0) {
    fail('REAL_HOST_CODEX_VERSION_FAILED', 'unable to read Codex CLI version', {
      status: result.status,
      signal: result.signal || null
    })
  }
  const version = String(result.stdout || result.stderr || '').trim()
  if (!version) fail('REAL_HOST_CODEX_VERSION_FAILED', 'Codex CLI returned an empty version')
  return version
}

/** Detect the exact composite exec capability without inferring it from a version string. */
function supportsCodexApproveForMe(executable, env = process.env, options = {}) {
  const invocation = resolveLaunch(executable, ['exec', '--help'], env)
  const run = options.spawnSyncImpl || spawnSync
  let result
  try {
    result = run(invocation.command, invocation.args, {
      encoding: 'utf8',
      env,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024
    })
  } catch {
    return false
  }
  if (!result || result.error || result.status !== 0) return false
  const help = [result.stdout, result.stderr]
    .filter(value => typeof value === 'string')
    .join('\n')
  return /(?:^|\s)--approve-for-me(?:\s|$)/u.test(help) &&
    /Route approval requests through automatic review using the workspace-write sandbox/iu.test(help)
}

function isCodexArgumentConflict(value) {
  const text = String(value || '')
  const exactConflict = /error:\s*the argument ['"`]--approve-for-me['"`] cannot be used with ['"`]--sandbox(?: <SANDBOX_MODE>)?['"`]/iu.test(text) ||
    /error:\s*the argument ['"`]--sandbox(?: <SANDBOX_MODE>)?['"`] cannot be used with ['"`]--approve-for-me['"`]/iu.test(text)
  return exactConflict && /(?:^|\r?\n)\s*Usage:\s+codex exec(?:\s|$)/iu.test(text)
}

function createProbeFixture(options) {
  const topology = validateProbeTopology(options)
  const nonce = options.nonce || crypto.randomBytes(24).toString('hex')
  if (!/^[a-f0-9]{48}$/u.test(nonce)) {
    fail('REAL_HOST_ORACLE_INVALID', 'probe nonce must be exactly 24 random bytes encoded as lowercase hex')
  }
  const payload = Buffer.from('DEVCODEX_REAL_HOST_PROBE_V1:' + nonce + '\n', 'utf8')
  const fixturePath = path.join(topology.consumerRoot, '.devcodex-real-host-probe-' + nonce + '.cjs')
  const targetRoot = options.expectation === 'allowed' ? topology.addDir : topology.forbiddenRoot
  if (!targetRoot) fail('REAL_HOST_TOPOLOGY_INVALID', 'forbidden expectation requires forbiddenRoot')
  const targetPath = path.join(targetRoot, '.devcodex-real-host-marker-' + nonce + '.txt')
  if (!isPathInside(targetRoot, targetPath) || fs.existsSync(targetPath)) {
    fail('REAL_HOST_PATH_UNSAFE', 'probe target must be an absent child of its exact root')
  }
  const source = [
    "'use strict'",
    "const fs = require('fs')",
    "const target = process.argv[2]",
    "const payload = Buffer.from(process.argv[3], 'base64')",
    "fs.writeFileSync(target, payload, { flag: 'wx' })",
    ''
  ].join('\n')
  fs.writeFileSync(fixturePath, source, { encoding: 'utf8', flag: 'wx' })
  const payloadBase64 = payload.toString('base64')
  const command = buildFixtureCommand({
    fixturePath,
    targetPath,
    payloadBase64,
    platform: options.platform
  })
  const acceptedCommands = process.platform === 'win32' ? [command, '& ' + command] : [command]
  return {
    topology,
    nonce,
    payload,
    payloadBase64,
    payloadSha256: sha256(payload),
    fixturePath,
    targetPath,
    targetRoot,
    command,
    acceptedCommands
  }
}

function readMarker(targetPath, expected) {
  if (!fs.existsSync(targetPath)) return { exists: false, exact: false, bytes: 0, sha256: null }
  const stat = fs.lstatSync(targetPath)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return { exists: true, exact: false, bytes: stat.size, sha256: null, unsafeType: true }
  }
  const content = fs.readFileSync(targetPath)
  return {
    exists: true,
    exact: content.equals(expected),
    bytes: content.length,
    sha256: sha256(content)
  }
}

function assertProbeOracleBinding(ledger, stage, nonce) {
  const oracle = ledger.identity.oracle
  let expectedNonce = null
  if (ledger.identity.mode === 'H0') {
    expectedNonce = stage === 'H0-allowed'
      ? oracle?.allowed?.nonce
      : (stage === 'H0-forbidden' ? oracle?.forbidden?.nonce : null)
  } else if (ledger.identity.mode === 'installed' && stage === 'H1') {
    expectedNonce = oracle?.h1?.nonce
  }
  if (expectedNonce && nonce !== expectedNonce) {
    fail('REAL_HOST_ORACLE_IDENTITY_DRIFT', 'probe nonce differs from the run identity oracle')
  }
  if (['H0', 'installed'].includes(ledger.identity.mode) && !expectedNonce) {
    fail('REAL_HOST_ORACLE_IDENTITY_DRIFT', 'run identity does not bind the requested probe oracle')
  }
}

function classifyProbeResult(options) {
  const observation = options.observation
  const child = options.child
  const marker = options.marker
  const effects = options.effects
  const unexpectedEffects = effects.unexpectedChanges?.length || 0
  if (unexpectedEffects > 0) {
    if (options.expectation === 'forbidden' &&
        options.requireTrustedForbiddenPolicy !== false &&
        !isTrustedForbiddenPolicy(options.stagePolicy)) {
      return { status: 'UNVERIFIED', code: 'HOST_FORBIDDEN_POLICY_UNTRUSTED', retryEligible: false }
    }
    return { status: 'BLOCK', code: 'HOST_ISOLATION_ESCAPE', retryEligible: false }
  }
  if (!child.spawned) {
    return {
      status: 'UNVERIFIED',
      code: 'HOST_PROCESS_NOT_STARTED',
      retryEligible: unexpectedEffects === 0
    }
  }
  if (child.timedOut) return { status: 'BLOCK', code: 'HOST_PROCESS_TIMEOUT', retryEligible: false }
  if (child.interruptedSignal) return { status: 'BLOCK', code: 'HOST_PROCESS_INTERRUPTED', retryEligible: false }
  if (child.orchestrationError) return { status: 'BLOCK', code: 'HOST_LEDGER_WRITE_FAILED', retryEligible: false }
  if (child.stdoutOverflow || child.stderrOverflow) return { status: 'BLOCK', code: 'HOST_OUTPUT_LIMIT_EXCEEDED', retryEligible: false }
  if (!isOwnedCleanupComplete(child.cleanup)) {
    return { status: 'BLOCK', code: 'HOST_CLEANUP_INCOMPLETE', retryEligible: false }
  }
  if (observation.invalidLineCount > 0) return { status: 'UNVERIFIED', code: 'HOST_EVENT_STREAM_INVALID', retryEligible: false }
  if (observation.commandIdentityDrift) {
    return { status: 'BLOCK', code: 'HOST_UNEXPECTED_COMMAND_OBSERVED', retryEligible: false }
  }
  if (!observation.commandObserved && child.exitCode !== 0 && isCodexArgumentConflict(child.stderr)) {
    return { status: 'UNVERIFIED', code: 'HOST_CODEX_ARGUMENT_CONFLICT', retryEligible: false }
  }
  if (!observation.commandObserved) return {
    status: 'UNVERIFIED',
    code: 'HOST_COMMAND_NOT_OBSERVED',
    retryEligible: false
  }
  if (observation.commandEventCount !== 1) {
    return { status: 'BLOCK', code: 'HOST_UNEXPECTED_COMMAND_OBSERVED', retryEligible: false }
  }
  if (!observation.commandCompleted || observation.commandExitCode === null) {
    return { status: 'UNVERIFIED', code: 'HOST_COMMAND_EVENT_INCOMPLETE', retryEligible: false }
  }
  if (child.exitCode !== 0) return { status: 'BLOCK', code: 'HOST_CODEX_EXIT_NONZERO', retryEligible: false }
  if (options.expectation === 'allowed') {
    if (observation.commandExitCode !== 0) {
      return {
        status: options.installedRuntimePolicy === true && !marker.exists && observation.commandFailureAccessDenied ? 'UNVERIFIED' : 'BLOCK',
        code: marker.exists
          ? 'HOST_PROBE_READBACK_MISMATCH'
          : (observation.commandFailureAccessDenied ? 'HOST_ADD_DIR_WRITE_DENIED' : 'HOST_PROBE_COMMAND_FAILED'),
        retryEligible: false
      }
    }
    if (!marker.exists || !marker.exact || effects.missingExpectedChanges?.length) {
      return { status: 'BLOCK', code: 'HOST_PROBE_READBACK_MISMATCH', retryEligible: false }
    }
  } else {
    if (options.requireTrustedForbiddenPolicy !== false && !isTrustedForbiddenPolicy(options.stagePolicy)) {
      return { status: 'UNVERIFIED', code: 'HOST_FORBIDDEN_POLICY_UNTRUSTED', retryEligible: false }
    }
    if (marker.exists) return { status: 'BLOCK', code: 'HOST_ISOLATION_ESCAPE', retryEligible: false }
    if (observation.commandExitCode === 0) return { status: 'BLOCK', code: 'HOST_FORBIDDEN_SIBLING_WRITABLE', retryEligible: false }
    if (!observation.commandFailureAccessDenied) {
      return { status: 'UNVERIFIED', code: 'HOST_FORBIDDEN_PROBE_INCONCLUSIVE', retryEligible: false }
    }
  }
  return { status: 'PASS', code: null, retryEligible: false }
}

function classifyTurnResult(child, lastMessageExists) {
  if (!child.spawned) return { status: 'BLOCK', code: 'HOST_PROCESS_NOT_STARTED' }
  if (!isOwnedCleanupComplete(child.cleanup)) {
    return { status: 'BLOCK', code: 'HOST_CLEANUP_INCOMPLETE' }
  }
  if (child.timedOut) return { status: 'BLOCK', code: 'HOST_PROCESS_TIMEOUT' }
  if (child.interruptedSignal) return { status: 'BLOCK', code: 'HOST_PROCESS_INTERRUPTED' }
  if (child.orchestrationError) return { status: 'BLOCK', code: 'HOST_LEDGER_WRITE_FAILED' }
  if (child.stdoutOverflow || child.stderrOverflow) {
    return { status: 'BLOCK', code: 'HOST_OUTPUT_LIMIT_EXCEEDED' }
  }
  if (child.exitCode !== 0) return { status: 'BLOCK', code: 'HOST_CODEX_EXIT_NONZERO' }
  if (!lastMessageExists) return { status: 'BLOCK', code: 'HOST_LAST_MESSAGE_MISSING' }
  return { status: 'PASS', code: null }
}

function persistChildEvidence(attemptRef, child) {
  const stdoutPath = path.join(attemptRef.directory, 'codex-events.jsonl')
  const stderrPath = path.join(attemptRef.directory, 'codex-stderr.txt')
  fs.writeFileSync(stdoutPath, child.stdout, { encoding: 'utf8', flag: 'wx' })
  fs.writeFileSync(stderrPath, child.stderr, { encoding: 'utf8', flag: 'wx' })
  return {
    stdoutPath,
    stdoutSha256: sha256(Buffer.from(child.stdout, 'utf8')),
    stderrPath,
    stderrSha256: sha256(Buffer.from(child.stderr, 'utf8'))
  }
}

/** Execute one deterministic command/effect probe and persist its terminal receipt. */
async function executeProbeStage(options) {
  validateProbeTopology(options)
  assertRuntimeBinding(options, 'probe')
  assertProbeOracleBinding(options.ledger, options.stage, options.nonce)
  const attemptRef = claimAttempt(options.ledger, options.stage, options.attempt || 1, options.retrySafety)
  let fixture = null
  try {
    return await executeClaimedProbeStage(options, attemptRef, value => {
      fixture = value
    })
  } catch (error) {
    for (const ownedPath of [fixture?.targetPath, fixture?.fixturePath].filter(Boolean)) {
      try {
        if (fs.existsSync(ownedPath)) fs.rmSync(ownedPath, { force: true })
      } catch {}
    }
    if (!fs.existsSync(path.join(attemptRef.directory, '03-terminal.json'))) {
      try {
        finalizeAttempt(attemptRef, {
          state: 'needs-review',
          status: 'BLOCK',
          code: error?.code || 'REAL_HOST_PROBE_EXCEPTION',
          retryEligible: false,
          summary: { error: String(error?.message || error).slice(0, 2000) }
        })
      } catch {}
    }
    throw error
  }
}

async function executeClaimedProbeStage(options, attemptRef, onFixture) {
  const fixture = createProbeFixture(options)
  onFixture(fixture)
  const roots = [
    { label: 'consumer', root: fixture.topology.consumerRoot },
    { label: 'addDir', root: fixture.topology.addDir }
  ]
  if (fixture.topology.forbiddenRoot) roots.push({ label: 'forbidden', root: fixture.topology.forbiddenRoot })
  const effectRootLabels = new Set(roots.map(entry => entry.label))
  for (const entry of options.additionalEffectRoots || []) {
    if (effectRootLabels.has(entry.label)) {
      fail('REAL_HOST_EFFECT_ROOT_INVALID', 'duplicate effect root label: ' + entry.label)
    }
    effectRootLabels.add(entry.label)
    if (entry.ownedMutable === true) {
      const topology = options.ledger.identity.topology || {}
      const isBoundH0Home = options.ledger.identity.mode === 'H0' &&
        entry.label === 'isolatedHome' &&
        topology.isolatedHome &&
        samePath(entry.root, topology.isolatedHome)
      if (!isBoundH0Home) {
        fail('REAL_HOST_EFFECT_ROOT_INVALID', 'owned mutable effect root is not the bound H0 isolated HOME')
      }
      continue
    }
    roots.push({ label: entry.label, root: entry.root })
  }
  const before = snapshotControlledRoots(roots)
  const prompt = [
    '这是确定性的宿主文件系统探针。',
    '只执行下面这一条命令，字符与参数保持不变；不要调用 MCP，不要读取其他文件，不要执行第二条命令。',
    fixture.command,
    '命令结束后只简短说明完成，不要尝试修复或重试。'
  ].join('\n')
  const args = buildCodexArgs({
    consumerRoot: fixture.topology.consumerRoot,
    addDir: fixture.topology.addDir,
    approveForMe: options.approveForMe === true,
    ignoreUserConfig: options.ignoreUserConfig === true,
    ignoreRules: options.ignoreRules === true,
    configOverrides: options.configOverrides,
    bypassHookTrust: options.bypassHookTrust === true,
    prompt
  })
  const launch = resolveLaunch(
    options.codexExecutable,
    [...(options.launchPrefixArgs || []), ...args],
    options.env
  )
  writeAttemptTransition(attemptRef, '01', 'running', {
    command: launch.command,
    args,
    cwd: fixture.topology.consumerRoot,
    deadlineMs: options.timeoutMs || DEFAULT_TIMEOUT_MS
  })
  const child = await runOwnedChild({
    command: launch.command,
    args: launch.args,
    cwd: fixture.topology.consumerRoot,
    env: options.env,
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    onSpawn: pid => writeAttemptTransition(attemptRef, '01a', 'spawned', { pid })
  })
  const after = snapshotControlledRoots(roots)
  const expectedRelative = path.relative(fixture.targetRoot, fixture.targetPath).replace(/\\/gu, '/')
  const allowedChanges = options.expectation === 'allowed'
    ? [{
        root: 'addDir',
        path: expectedRelative,
        after: { type: 'file', bytes: fixture.payload.length, sha256: fixture.payloadSha256 }
      }]
    : []
  const effects = partitionInstalledRuntimeEffects(compareSnapshots(before, after, allowedChanges), options.ledger.identity)
  const marker = readMarker(fixture.targetPath, fixture.payload)
  const observation = parseCodexJsonl(child.stdout, fixture.acceptedCommands)
  const evidence = persistChildEvidence(attemptRef, child)
  const stageExecution = options.ledger.identity.mode === 'H0'
    ? boundH0StageExecution(options.ledger.identity, options.stage)
    : null
  const classification = classifyProbeResult({
    expectation: options.expectation,
    child,
    marker,
    effects,
    observation,
    installedRuntimePolicy: effects.runtimeEffectPolicy === 'installed-runtime-v1',
    stagePolicy: stageExecution?.policy || null,
    requireTrustedForbiddenPolicy: options.ledger.identity.mode === 'H0'
  })
  const cleanupFailures = []
  for (const ownedPath of [fixture.targetPath, fixture.fixturePath]) {
    try {
      if (fs.existsSync(ownedPath)) fs.rmSync(ownedPath, { force: true })
    } catch (error) {
      cleanupFailures.push({ path: ownedPath, code: error.code || null })
    }
  }
  const cleanup = {
    markerAbsent: !fs.existsSync(fixture.targetPath),
    fixtureAbsent: !fs.existsSync(fixture.fixturePath),
    childTreeReleased: isOwnedCleanupComplete(child.cleanup),
    failures: cleanupFailures
  }
  if (!cleanup.markerAbsent || !cleanup.fixtureAbsent || !cleanup.childTreeReleased || cleanupFailures.length) {
    classification.status = 'BLOCK'
    classification.code = 'HOST_CLEANUP_INCOMPLETE'
    classification.retryEligible = false
  }
  const receipt = {
    schemaVersion: RESULT_SCHEMA,
    stage: options.stage,
    expectation: options.expectation,
    status: classification.status,
    code: classification.code,
    runDigest: options.ledger.identity.digest,
    attempt: attemptRef.attempt,
    commandDigest: sha256(Buffer.from(fixture.command, 'utf8')),
    argv: args,
    cwd: fixture.topology.consumerRoot,
    addDir: fixture.topology.addDir,
    forbiddenRoot: fixture.topology.forbiddenRoot,
    child: {
      spawned: child.spawned,
      pid: child.pid,
      exitCode: child.exitCode,
      signal: child.signal,
      timedOut: child.timedOut,
      durationMs: child.durationMs,
      cleanup: child.cleanup
    },
    observation,
    marker,
    effects,
    stagePolicy: stageExecution?.policy || null,
    cleanup,
    evidence
  }
  const receiptPath = path.join(attemptRef.directory, 'probe-receipt.json')
  const receiptDigest = writeJsonExclusive(receiptPath, receipt)
  finalizeAttempt(attemptRef, {
    status: receipt.status,
    code: receipt.code,
    retryEligible: classification.retryEligible,
    receiptDigest,
    summary: {
      commandObserved: observation.commandObserved,
      commandExitCode: observation.commandExitCode,
      effectClean: effects.clean,
      cleanupComplete: cleanup.markerAbsent && cleanup.fixtureAbsent && cleanup.childTreeReleased
    }
  })
  return { ...receipt, receiptPath, receiptDigest }
}

/** Execute one formal Codex turn; durable task readback is finalized by the caller. */
async function executeTurnStage(options) {
  const topology = validateProbeTopology({
    consumerRoot: options.consumerRoot,
    addDir: options.addDir
  })
  assertRuntimeBinding(options, 'turn')
  const attemptRef = claimAttempt(options.ledger, options.stage, options.attempt || 1, options.retrySafety)
  try {
    return await executeClaimedTurnStage(options, topology, attemptRef)
  } catch (error) {
    if (!fs.existsSync(path.join(attemptRef.directory, '03-terminal.json'))) {
      try {
        finalizeAttempt(attemptRef, {
          state: 'needs-review',
          status: 'BLOCK',
          code: error?.code || 'REAL_HOST_TURN_EXCEPTION',
          retryEligible: false,
          summary: { error: String(error?.message || error).slice(0, 2000) }
        })
      } catch {}
    }
    throw error
  }
}

async function executeClaimedTurnStage(options, topology, attemptRef) {
  const outputLastMessagePath = path.join(attemptRef.directory, 'last-message.txt')
  const args = buildCodexArgs({
    consumerRoot: topology.consumerRoot,
    addDir: topology.addDir,
    approveForMe: options.approveForMe === true,
    ignoreUserConfig: options.ignoreUserConfig === true,
    ignoreRules: options.ignoreRules === true,
    configOverrides: options.configOverrides,
    bypassHookTrust: options.bypassHookTrust === true,
    outputLastMessagePath,
    prompt: options.prompt
  })
  const launch = resolveLaunch(
    options.codexExecutable,
    [...(options.launchPrefixArgs || []), ...args],
    options.env
  )
  writeAttemptTransition(attemptRef, '01', 'running', {
    command: launch.command,
    args,
    cwd: topology.consumerRoot,
    deadlineMs: options.timeoutMs || DEFAULT_TIMEOUT_MS
  })
  const child = await runOwnedChild({
    command: launch.command,
    args: launch.args,
    cwd: topology.consumerRoot,
    env: options.env,
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    onSpawn: pid => writeAttemptTransition(attemptRef, '01a', 'spawned', { pid })
  })
  const evidence = persistChildEvidence(attemptRef, child)
  const lastMessageExists = fs.existsSync(outputLastMessagePath)
  const classification = classifyTurnResult(child, lastMessageExists)
  const receipt = {
    schemaVersion: RESULT_SCHEMA,
    stage: options.stage,
    status: classification.status,
    code: classification.code,
    runDigest: options.ledger.identity.digest,
    attempt: attemptRef.attempt,
    argv: args,
    cwd: topology.consumerRoot,
    addDir: topology.addDir,
    child: {
      spawned: child.spawned,
      pid: child.pid,
      exitCode: child.exitCode,
      signal: child.signal,
      timedOut: child.timedOut,
      durationMs: child.durationMs,
      cleanup: child.cleanup
    },
    lastMessage: lastMessageExists ? fs.readFileSync(outputLastMessagePath, 'utf8').trim() : '',
    stdoutSha256: evidence.stdoutSha256,
    stderrSha256: evidence.stderrSha256,
    evidence
  }
  const receiptPath = path.join(attemptRef.directory, 'turn-receipt.json')
  const receiptDigest = writeJsonExclusive(receiptPath, receipt)
  writeAttemptTransition(attemptRef, '02', 'executed', {
    status: receipt.status,
    code: receipt.code,
    receiptDigest
  })
  if (!options.deferFinalization || receipt.status !== 'PASS') {
    finalizeAttempt(attemptRef, {
      status: receipt.status,
      code: receipt.code,
      retryEligible: false,
      receiptDigest
    })
  }
  return { ...receipt, receiptPath, receiptDigest, deferred: options.deferFinalization === true && receipt.status === 'PASS' }
}

function finalizeDeferredAttempt(options) {
  const ledger = openAttemptLedger(options)
  const attemptRef = {
    ledger,
    stage: options.stage,
    attempt: options.attempt || 1,
    directory: attemptDirectory(ledger, options.stage, options.attempt || 1)
  }
  const terminalPath = path.join(attemptRef.directory, '03-terminal.json')
  if (fs.existsSync(terminalPath)) fail('REAL_HOST_ATTEMPT_ALREADY_CONSUMED', 'attempt is already terminal')
  const executedPath = path.join(attemptRef.directory, '02-executed.json')
  if (!fs.existsSync(executedPath)) fail('REAL_HOST_ATTEMPT_INVALID', 'deferred attempt has no executed transition')
  const receiptPath = path.join(attemptRef.directory, 'turn-receipt.json')
  const executed = readLedgerJson(executedPath, 'deferred executed transition').value
  const receiptEvidence = readLedgerJson(receiptPath, 'deferred turn receipt')
  const receipt = receiptEvidence.value
  const receiptDigest = receiptEvidence.digest
  if (
    executed.schemaVersion !== 'RealHostAttemptTransitionV1' ||
    executed.runDigest !== ledger.identity.digest ||
    executed.stage !== attemptRef.stage ||
    executed.attempt !== attemptRef.attempt ||
    executed.state !== 'executed' ||
    executed.status !== 'PASS' ||
    executed.receiptDigest !== receiptDigest ||
    receipt.schemaVersion !== RESULT_SCHEMA ||
    receipt.runDigest !== ledger.identity.digest ||
    receipt.stage !== attemptRef.stage ||
    receipt.attempt !== attemptRef.attempt ||
    receipt.status !== 'PASS' ||
    options.receiptDigest !== receiptDigest
  ) {
    fail('REAL_HOST_LEDGER_INTEGRITY_FAILED', 'deferred attempt receipt binding drifted')
  }
  return finalizeAttempt(attemptRef, {
    status: options.status,
    code: options.code || null,
    retryEligible: options.retryEligible === true,
    receiptDigest,
    summary: options.summary || null,
    state: options.state || 'terminal'
  })
}

function buildIsolatedCodexEnv(home, baseEnv = process.env) {
  const resolved = path.resolve(home)
  const parsed = path.parse(resolved)
  return {
    ...baseEnv,
    HOME: resolved,
    USERPROFILE: resolved,
    HOMEDRIVE: parsed.root.replace(/[\\/]$/u, ''),
    HOMEPATH: resolved.slice(parsed.root.length - 1),
    APPDATA: path.join(resolved, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(resolved, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(resolved, '.config'),
    XDG_CACHE_HOME: path.join(resolved, '.cache'),
    CODEX_HOME: path.join(resolved, '.codex')
  }
}

function findAuthFile(baseEnv = process.env) {
  const candidates = []
  if (baseEnv.CODEX_HOME) candidates.push(path.join(baseEnv.CODEX_HOME, 'auth.json'))
  if (baseEnv.USERPROFILE) candidates.push(path.join(baseEnv.USERPROFILE, '.codex', 'auth.json'))
  if (baseEnv.HOME) candidates.push(path.join(baseEnv.HOME, '.codex', 'auth.json'))
  const found = candidates.map(candidate => path.resolve(candidate)).find(candidate => fs.existsSync(candidate))
  if (!found || !fs.lstatSync(found).isFile()) {
    fail('REAL_HOST_AUTH_MISSING', 'H0 requires an existing Codex auth.json credential source')
  }
  return found
}

/** Run the pack-free H0 allowed/forbidden probes in an isolated Codex HOME. */
async function runH0(options) {
  const sourceRoot = assertRealDirectory('sourceRoot', options.sourceRoot)
  const hostEnv = { ...(options.env || process.env) }
  const evidenceRoot = validateEvidenceRoot(options.evidenceRoot, [
    sourceRoot,
    ...collectHostHomeRoots(hostEnv)
  ])
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-real-host-h0-'))
  const forbiddenLifecycle = {}
  let execution
  let executionError = null
  let cleanup
  try {
    execution = await executeH0InTemp(
      { ...options, sourceRoot, hostEnv },
      evidenceRoot,
      tempRoot,
      forbiddenLifecycle
    )
  } catch (error) {
    executionError = error
  } finally {
    const forbiddenRoot = cleanupForbiddenCandidateLeaf(forbiddenLifecycle)
    let fixtureRoot
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true })
      fixtureRoot = { complete: !fs.existsSync(tempRoot), tempRoot, errorCode: null }
    } catch (error) {
      fixtureRoot = { complete: false, tempRoot, errorCode: error.code || null }
    }
    cleanup = {
      complete: fixtureRoot.complete && forbiddenRoot.complete,
      tempRoot,
      fixtureRoot,
      forbiddenRoot
    }
  }
  if (executionError) {
    executionError.details = {
      ...(executionError.details || {}),
      cleanup
    }
    throw executionError
  }
  const { allowed, forbidden, identity, ledger, eligibility } = execution
  const status = allowed?.status === 'PASS' && forbidden?.status === 'PASS' && cleanup.complete
    ? 'PASS'
    : (!cleanup.complete || allowed?.status === 'BLOCK' || forbidden?.status === 'BLOCK' ? 'BLOCK' : 'UNVERIFIED')
  const result = {
    schemaVersion: 'RealHostH0ReceiptV1',
    status,
    code: status === 'PASS'
      ? null
      : (!cleanup.complete ? 'HOST_CLEANUP_INCOMPLETE' : (allowed?.code || forbidden?.code || 'HOST_H0_INCOMPLETE')),
    identity,
    stages: {
      allowed: allowed ? { status: allowed.status, code: allowed.code, receiptDigest: allowed.receiptDigest } : null,
      forbidden: forbidden ? { status: forbidden.status, code: forbidden.code, receiptDigest: forbidden.receiptDigest } : null
    },
    eligibility: eligibility ? projectForbiddenEligibilityForIdentity(eligibility) : null,
    cleanup,
    completedAt: new Date().toISOString()
  }
  result.digest = digestObject(result)
  writeJsonExclusive(path.join(ledger.runDir, 'h0-receipt.json'), result)
  return { ...result, evidenceRoot: ledger.runDir }
}

async function executeH0InTemp(options, evidenceRoot, tempRoot, forbiddenLifecycle) {
  const workspaceRoot = path.join(tempRoot, 'workspace')
  const consumerRoot = path.join(workspaceRoot, 'consumer')
  const addDir = path.join(workspaceRoot, '.devcodex', 'consumer')
  const isolatedHome = path.join(tempRoot, 'home')
  fs.mkdirSync(consumerRoot, { recursive: true })
  fs.mkdirSync(addDir, { recursive: true })
  fs.mkdirSync(path.join(isolatedHome, '.codex'), { recursive: true })
  fs.writeFileSync(path.join(consumerRoot, 'package.json'), JSON.stringify({
    name: 'devcodex-real-host-h0-consumer',
    private: true
  }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  const probeNonces = {
    allowed: crypto.randomBytes(24).toString('hex'),
    forbidden: crypto.randomBytes(24).toString('hex')
  }
  const testServices = options.h0TestServices?.testOnly === true ? options.h0TestServices : {}
  let candidate
  try {
    candidate = resolveForbiddenRootCandidate(
      options.hostEnv,
      crypto.randomBytes(24).toString('hex'),
      testServices
    )
    createForbiddenCandidateLeaf(candidate)
  } catch (error) {
    error.details = {
      ...(error.details || {}),
      authorizationConsumed: false,
      runCreated: false,
      attemptCreated: false,
      childStarted: false
    }
    throw error
  }
  Object.assign(forbiddenLifecycle, {
    baseRoot: candidate.baseRoot,
    leafRoot: candidate.leafRoot,
    nonce: candidate.nonce,
    ownedLeaf: true,
    platform: candidate.platform
  })
  testServices.beforeInitialQualification?.({ candidate })
  const eligibilityContext = {
    hostEnv: options.hostEnv,
    consumerRoot,
    addDir,
    isolatedHome,
    sourceRoot: options.sourceRoot,
    evidenceRoot,
    workspaceRoot
  }
  const eligibility = qualifyForbiddenRoot(candidate, eligibilityContext, testServices)
  if (eligibility.status !== 'PASS') {
    fail(eligibility.code || 'HOST_FORBIDDEN_ROOT_UNVERIFIED', 'forbidden root did not qualify before authorization consumption', {
      status: 'UNVERIFIED',
      eligibility,
      authorizationConsumed: false,
      runCreated: false,
      attemptCreated: false,
      childStarted: false
    })
  }
  // Qualification must precede every Codex subprocess, including capability
  // discovery. Otherwise a rejected canary would still have started the host.
  const authSource = findAuthFile(options.hostEnv)
  fs.copyFileSync(authSource, path.join(isolatedHome, '.codex', 'auth.json'), fs.constants.COPYFILE_EXCL)
  const env = detachCodexTaskEnvironment(
    buildIsolatedCodexEnv(isolatedHome, options.hostEnv)
  )
  const codexExecutable = resolveCodexExecutable(options.codexExecutable, env)
  const codexVersion = readCodexVersion(codexExecutable, env)
  const allowedApproveForMe = supportsCodexApproveForMe(codexExecutable, env)
  const forbiddenRoot = eligibility.canonicalLeaf
  const allowedArgvContract = buildCodexArgs({
    consumerRoot,
    addDir,
    approveForMe: allowedApproveForMe,
    ignoreUserConfig: true,
    ignoreRules: true,
    bypassHookTrust: false,
    prompt: H0_CONTRACT_PROMPT
  })
  const forbiddenArgvContract = buildCodexArgs({
    consumerRoot,
    addDir,
    approveForMe: false,
    ignoreUserConfig: true,
    ignoreRules: true,
    bypassHookTrust: false,
    prompt: H0_CONTRACT_PROMPT
  })
  const identity = createRunIdentity({
    mode: 'H0',
    sourceCandidate: options.sourceCandidate,
    authorizationDigest: options.authorizationDigest,
    codexVersion,
    codexExecutable,
    argvContract: allowedArgvContract,
    topology: {
      processCwd: consumerRoot,
      cliCwd: consumerRoot,
      addDir,
      forbiddenRoot,
      isolatedHome,
      sourceRoot: options.sourceRoot,
      forbiddenEligibility: projectForbiddenEligibilityForIdentity(eligibility),
      stageArgvContracts: {
        'H0-allowed': allowedArgvContract,
        'H0-forbidden': forbiddenArgvContract
      },
      stageApprovalPolicies: {
        'H0-allowed': deriveH0StagePolicy(allowedArgvContract),
        'H0-forbidden': deriveH0StagePolicy(forbiddenArgvContract)
      }
    },
    oracle: {
      schemaVersion: 'RealHostProbeOracleBindingV1',
      singleCommand: true,
      createExclusive: true,
      payloadPrefix: 'DEVCODEX_REAL_HOST_PROBE_V1:',
      allowed: {
        nonce: probeNonces.allowed,
        targetRoot: addDir,
        expectedCommandExitCode: 0
      },
      forbidden: {
        nonce: probeNonces.forbidden,
        targetRoot: forbiddenRoot,
        expectedTargetAbsent: true
      },
      unexpectedEffectCount: 0
    }
  })
  const ledger = initializeAttemptLedger({
    evidenceRoot,
    identity,
    forbiddenRoots: [options.sourceRoot, consumerRoot, addDir, forbiddenRoot, isolatedHome]
  })
  let allowed = null
  let forbidden = null
  try {
    allowed = await executeProbeStage({
      ledger,
      stage: 'H0-allowed',
      expectation: 'allowed',
      nonce: probeNonces.allowed,
      consumerRoot,
      addDir,
      forbiddenRoot,
      codexExecutable,
      launchPrefixArgs: options.launchPrefixArgs,
      env,
      approveForMe: allowedApproveForMe,
      ignoreUserConfig: true,
      ignoreRules: true,
      bypassHookTrust: false,
      forbiddenEligibilityDigest: eligibility.eligibilityDigest,
      additionalEffectRoots: [{ label: 'isolatedHome', root: isolatedHome, ownedMutable: true }],
      timeoutMs: options.timeoutMs
    })
    if (allowed.status === 'PASS') {
      testServices.beforeForbiddenRecheck?.({ candidate, eligibility })
      const recheckedEligibility = qualifyForbiddenRoot(candidate, eligibilityContext, testServices)
      if (recheckedEligibility.status !== 'PASS' ||
          recheckedEligibility.eligibilityDigest !== eligibility.eligibilityDigest) {
        const preflight = {
          schemaVersion: 'RealHostForbiddenEligibilityReceiptV1',
          stage: 'H0-forbidden',
          status: 'UNVERIFIED',
          code: 'HOST_FORBIDDEN_ROOT_DRIFT',
          runDigest: identity.digest,
          expectedEligibilityDigest: eligibility.eligibilityDigest,
          observedEligibility: recheckedEligibility,
          childStarted: false,
          attemptCreated: false,
          checkedAt: new Date().toISOString()
        }
        const receiptPath = path.join(ledger.runDir, 'h0-forbidden-eligibility.json')
        const receiptDigest = writeJsonExclusive(receiptPath, preflight)
        forbidden = { ...preflight, receiptPath, receiptDigest }
      } else {
        forbidden = await executeProbeStage({
          ledger,
          stage: 'H0-forbidden',
          expectation: 'forbidden',
          nonce: probeNonces.forbidden,
          consumerRoot,
          addDir,
          forbiddenRoot,
          codexExecutable,
          launchPrefixArgs: options.launchPrefixArgs,
          env,
          approveForMe: false,
          ignoreUserConfig: true,
          ignoreRules: true,
          bypassHookTrust: false,
          forbiddenEligibilityDigest: recheckedEligibility.eligibilityDigest,
          additionalEffectRoots: [{ label: 'isolatedHome', root: isolatedHome, ownedMutable: true }],
          timeoutMs: options.timeoutMs
        })
      }
    }
  } catch (error) {
    try {
      writeJsonExclusive(path.join(ledger.runDir, 'h0-error.json'), {
        schemaVersion: 'RealHostH0ErrorV1',
        status: 'BLOCK',
        code: error?.code || 'REAL_HOST_H0_EXCEPTION',
        message: String(error?.message || error).slice(0, 2000),
        at: new Date().toISOString()
      })
    } catch (persistenceError) {
      error.details = {
        ...(error.details || {}),
        h0ErrorPersistence: {
          code: persistenceError?.code || null,
          message: String(persistenceError?.message || persistenceError).slice(0, 1000)
        }
      }
    }
    throw error
  }
  return { allowed, forbidden, identity, ledger, eligibility }
}

function parseCliArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) fail('REAL_HOST_CLI_ARGUMENT_INVALID', 'unexpected argument: ' + key)
    const name = key.slice(2)
    if (!CLI_ARGUMENT_NAMES.has(name)) {
      fail('REAL_HOST_CLI_ARGUMENT_INVALID', 'unsupported argument: ' + key)
    }
    if (Object.prototype.hasOwnProperty.call(options, name)) {
      fail('REAL_HOST_CLI_ARGUMENT_INVALID', 'duplicate argument: ' + key)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail('REAL_HOST_CLI_ARGUMENT_INVALID', key + ' requires a value')
    options[name] = value
    index += 1
  }
  return options
}

async function runRequestFile(requestPath) {
  if (typeof requestPath !== 'string' || !requestPath.trim()) {
    fail('REAL_HOST_REQUEST_INVALID', '--request-file is required for request mode')
  }
  const request = JSON.parse(fs.readFileSync(path.resolve(requestPath), 'utf8'))
  if (request.schemaVersion !== 'RealCodexHostProbeRequestV1') {
    fail('REAL_HOST_REQUEST_INVALID', 'unsupported real-host request schema')
  }
  const ledger = openAttemptLedger({
    evidenceRoot: request.evidenceRoot,
    identity: request.identity,
    forbiddenRoots: request.forbiddenRoots || []
  })
  const codexExecutable = resolveCodexExecutable(request.codexExecutable, process.env)
  if (request.operation === 'probe') {
    return executeProbeStage({
      ...request,
      ledger,
      codexExecutable,
      env: process.env
    })
  }
  if (request.operation === 'turn') {
    return executeTurnStage({
      ...request,
      ledger,
      codexExecutable,
      env: process.env
    })
  }
  fail('REAL_HOST_REQUEST_INVALID', 'unsupported real-host request operation')
}

async function main(argv = process.argv.slice(2)) {
  const args = parseCliArguments(argv)
  let result
  if (args.mode === 'h0') {
    const timeoutMs = args['timeout-ms'] ? Number(args['timeout-ms']) : DEFAULT_TIMEOUT_MS
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > DEFAULT_TIMEOUT_MS) {
      fail('REAL_HOST_CLI_ARGUMENT_INVALID', '--timeout-ms must be an integer from 1000 to ' + DEFAULT_TIMEOUT_MS)
    }
    result = await runH0({
      evidenceRoot: args['evidence-root'],
      sourceRoot: args['source-root'],
      sourceCandidate: args['source-candidate'],
      authorizationDigest: args['authorization-digest'],
      codexExecutable: args.codex,
      timeoutMs
    })
  } else if (args.mode === 'request') {
    result = await runRequestFile(args['request-file'])
  } else {
    fail('REAL_HOST_CLI_ARGUMENT_INVALID', '--mode must be h0 or request')
  }
  if (args['result-file']) {
    fs.writeFileSync(path.resolve(args['result-file']), JSON.stringify(result, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx'
    })
  }
  const stage = result.schemaVersion === 'RealHostH0ReceiptV1' ? 'H0' : result.stage
  console.log('真实 Codex 宿主验证：阶段=' + stage + '，状态=' + result.status +
    (result.code ? '，原因=' + result.code : '') + '。')
  if (result.status !== 'PASS') process.exitCode = 1
  return result
}

if (require.main === module) {
  main().catch(error => {
    const code = error?.code || 'REAL_HOST_PROBE_FAILED'
    console.error('真实 Codex 宿主验证失败：' + code + '；' + error.message)
    process.exitCode = 1
  })
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  LEDGER_SCHEMA,
  RESULT_SCHEMA,
  RUN_SCHEMA,
  RealCodexHostProbeError,
  assertInstalledIdentityBinding,
  assertRuntimeBinding,
  buildCodexArgs,
  buildFixtureCommand,
  buildIsolatedCodexEnv,
  canContinueIndependentInstalledTurn,
  claimAttempt,
  classifyProbeResult,
  classifyTurnResult,
  collectHostHomeRoots,
  compareSnapshots,
  createProbeFixture,
  createRunIdentity,
  detachCodexTaskEnvironment,
  digestObject,
  executeProbeStage,
  executeTurnStage,
  extractCommandOutput,
  findAuthFile,
  finalizeAttempt,
  finalizeDeferredAttempt,
  initializeAttemptLedger,
  hasAccessDeniedEvidence,
  isNonterminalH3SafePartial,
  isOwnedCleanupComplete,
  isPathInside,
  isPidAlive,
  main,
  normalizeObservedCommand,
  normalizeObservedCommandVariants,
  openAttemptLedger,
  parseCliArguments,
  parseCodexJsonl,
  partitionInstalledRuntimeEffects,
  quoteShellArgument,
  readLedgerJson,
  readWindowsAclProjection,
  readCodexVersion,
  resolveCodexExecutable,
  runH0,
  runOwnedChild,
  samePath,
  sha256,
  snapshotControlledRoots,
  stableStringify,
  supportsCodexApproveForMe,
  terminateOwnedProcessTree,
  validateEvidenceRoot,
  validateProbeTopology
}
