#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  CONTAINER_DIR_NAMES,
  UTILITY_ROOT_DIR_NAMES
} = require('../hooks/_runtime/workspace-layout.cjs')

const DEFAULT_LAYOUT = {
  version: 1,
  mode: 'workspace-namespace',
  workspaceDir: 'workspace'
}

const RESERVED_PROJECT_NAMES = new Set([
  'workspace',
  'profile',
  '.memory',
  'reports',
  'requirements',
  'bugs',
  'optimizations',
  'scenario-tests',
  'migrations',
  'layout.json',
  'task-index.md',
  'readme.md'
])

const LEGACY_WORKSPACE_NAMES = [
  'profile',
  '.memory',
  'reports',
  'requirements',
  'bugs',
  'optimizations',
  'scenario-tests',
  'migrations',
  'TASK-INDEX.md',
  'README.md'
]

function nowStamp() {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

function normalizeBatch(batch) {
  const value = String(batch || 'all').trim().toLowerCase()
  if (value === 'a' || value === 'batch-a') return 'A'
  if (value === 'b' || value === 'batch-b') return 'B'
  if (value === 'all') return 'all'
  throw new Error(`unsupported batch: ${batch}`)
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      args._.push(token)
      continue
    }
    const name = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      args[name] = true
      continue
    }
    args[name] = next
    index++
  }
  return args
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function countFiles(root) {
  if (!fs.existsSync(root)) return 0
  const stat = fs.statSync(root)
  if (!stat.isDirectory()) return 1
  let total = 0
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    total += countFiles(path.join(root, entry.name))
  }
  return total
}

function copyRecursive(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.cpSync(sourcePath, targetPath, { recursive: true, force: true, errorOnExist: false })
}

function moveToBackup(sourcePath, backupPath) {
  fs.mkdirSync(path.dirname(backupPath), { recursive: true })
  fs.renameSync(sourcePath, backupPath)
}

function workspaceDevcodexRoot(workspaceRoot) {
  return path.join(workspaceRoot, '.devcodex')
}

function layoutFilePath(workspaceRoot) {
  return path.join(workspaceDevcodexRoot(workspaceRoot), 'layout.json')
}

function workspaceNamespaceRoot(workspaceRoot) {
  return path.join(workspaceDevcodexRoot(workspaceRoot), DEFAULT_LAYOUT.workspaceDir)
}

function migrationRoot(workspaceRoot, migrationId) {
  return path.join(workspaceNamespaceRoot(workspaceRoot), 'migrations', migrationId)
}

function collectLegacyProjectDirs(workspaceRoot, { maxDepth = 3 } = {}) {
  const projects = []

  function scan(root, relativeSegments = [], depth = maxDepth) {
    if (depth < 0 || !fs.existsSync(root)) return
    let entries
    try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const name = String(entry.name || '').trim()
      if (!name || name.startsWith('.') || name === 'node_modules') continue
      const fullPath = path.join(root, name)
      const nextSegments = [...relativeSegments, name]
      const namespace = nextSegments.join('/')
      const lowerName = name.toLowerCase()
      const isUtilityRoot = relativeSegments.length === 0 && UTILITY_ROOT_DIR_NAMES.has(lowerName)
      const isContainer = CONTAINER_DIR_NAMES.has(lowerName)
      const legacyRoot = path.join(fullPath, '.devcodex')
      if (fs.existsSync(legacyRoot) && !isUtilityRoot) {
        projects.push({ name: namespace, legacyRoot })
      }
      if (depth > 0 && (isContainer || isUtilityRoot || relativeSegments.length === 0)) {
        scan(fullPath, nextSegments, depth - 1)
      }
    }
  }

  scan(workspaceRoot)
  return projects
}

function collectProjectCandidates(workspaceRoot) {
  const candidates = []
  for (const project of collectLegacyProjectDirs(workspaceRoot)) {
    const stats = {
      name: project.name,
      legacyRoot: project.legacyRoot,
      targetRoot: path.join(workspaceDevcodexRoot(workspaceRoot), ...project.name.split('/')),
      fileCount: countFiles(project.legacyRoot),
      hasProfile: fs.existsSync(path.join(project.legacyRoot, 'profile')),
      hasMemory: fs.existsSync(path.join(project.legacyRoot, '.memory')),
      hasRequirements: fs.existsSync(path.join(project.legacyRoot, 'requirements')),
      hasBugs: fs.existsSync(path.join(project.legacyRoot, 'bugs')),
      hasReports: fs.existsSync(path.join(project.legacyRoot, 'reports'))
    }
    stats.score = [
      stats.hasProfile,
      stats.hasMemory,
      stats.hasRequirements,
      stats.hasBugs,
      stats.hasReports
    ].filter(Boolean).length * 1000 + stats.fileCount
    candidates.push(stats)
  }
  candidates.sort((left, right) => left.score - right.score || left.name.localeCompare(right.name))
  const midpoint = Math.ceil(candidates.length / 2)
  return candidates.map((candidate, index) => ({
    ...candidate,
    batch: index < midpoint ? 'A' : 'B'
  }))
}

function collectWorkspaceEntries(workspaceRoot) {
  const root = workspaceDevcodexRoot(workspaceRoot)
  if (!fs.existsSync(root)) return []
  const entries = []
  for (const name of LEGACY_WORKSPACE_NAMES) {
    const sourcePath = path.join(root, name)
    if (!fs.existsSync(sourcePath)) continue
    const stat = fs.statSync(sourcePath)
    entries.push({
      name,
      sourcePath,
      targetPath: path.join(workspaceNamespaceRoot(workspaceRoot), name),
      kind: stat.isDirectory() ? 'directory' : 'file',
      fileCount: countFiles(sourcePath)
    })
  }
  return entries
}

function buildWarnings(workspaceRoot, projects) {
  const warnings = []
  if (fs.existsSync(layoutFilePath(workspaceRoot))) {
    warnings.push('layout.json already exists; apply should treat workspace as already cut over')
  }
  for (const project of projects) {
    if (RESERVED_PROJECT_NAMES.has(project.name.toLowerCase())) {
      warnings.push(`project name "${project.name}" conflicts with reserved .devcodex root entry`)
    }
  }
  return warnings
}

function createManifest(workspaceRoot) {
  const migrationId = nowStamp()
  const projects = collectProjectCandidates(workspaceRoot)
  const workspaceEntries = collectWorkspaceEntries(workspaceRoot)
  const root = migrationRoot(workspaceRoot, migrationId)
  const manifestPath = path.join(root, 'manifest.json')
  const manifest = {
    version: 1,
    migrationId,
    createdAt: new Date().toISOString(),
    workspaceRoot,
    layout: {
      ...DEFAULT_LAYOUT,
      layoutFile: layoutFilePath(workspaceRoot)
    },
    targetWorkspaceRoot: workspaceNamespaceRoot(workspaceRoot),
    manifestPath,
    backupsDir: path.join(root, 'backups'),
    rollbackTrashDir: path.join(root, 'rollback-trash'),
    workspaceEntries,
    projects,
    warnings: buildWarnings(workspaceRoot, projects),
    applyLog: []
  }
  writeJson(manifestPath, manifest)
  return manifest
}

function loadManifest(manifestPath) {
  const manifest = readJson(path.resolve(manifestPath))
  if (!manifest) throw new Error(`invalid manifest: ${manifestPath}`)
  return manifest
}

function saveManifest(manifest) {
  writeJson(manifest.manifestPath, manifest)
}

function ensureApplyReady(manifest) {
  if (manifest.warnings.some(item => /conflicts with reserved/.test(item))) {
    throw new Error(`apply blocked by reserved-name conflicts: ${manifest.warnings.join('; ')}`)
  }
}

function copyAndBackup(sourcePath, targetPath, backupPath) {
  copyRecursive(sourcePath, targetPath)
  const sourceFiles = countFiles(sourcePath)
  const targetFiles = countFiles(targetPath)
  if (sourceFiles !== targetFiles) {
    throw new Error(`copy verification failed for ${sourcePath}: sourceFiles=${sourceFiles}, targetFiles=${targetFiles}`)
  }
  moveToBackup(sourcePath, backupPath)
}

function applyManifest(manifest, batch = 'all') {
  ensureApplyReady(manifest)
  const normalizedBatch = normalizeBatch(batch)
  const appliedAt = new Date().toISOString()
  const selectedProjects = manifest.projects.filter(project => normalizedBatch === 'all' || project.batch === normalizedBatch)

  for (const entry of manifest.workspaceEntries) {
    if (!fs.existsSync(entry.sourcePath)) continue
    const backupPath = path.join(manifest.backupsDir, 'workspace', entry.name)
    copyAndBackup(entry.sourcePath, entry.targetPath, backupPath)
    manifest.applyLog.push({
      type: 'workspace',
      name: entry.name,
      sourcePath: entry.sourcePath,
      targetPath: entry.targetPath,
      backupPath,
      appliedAt
    })
  }

  for (const project of selectedProjects) {
    if (!fs.existsSync(project.legacyRoot)) continue
    const backupPath = path.join(manifest.backupsDir, 'projects', project.name, '.devcodex')
    copyAndBackup(project.legacyRoot, project.targetRoot, backupPath)
    manifest.applyLog.push({
      type: 'project',
      project: project.name,
      batch: project.batch,
      sourcePath: project.legacyRoot,
      targetPath: project.targetRoot,
      backupPath,
      appliedAt
    })
  }

  writeJson(
    manifest.layout.layoutFile,
    {
      version: DEFAULT_LAYOUT.version,
      mode: DEFAULT_LAYOUT.mode,
      createdAt: appliedAt,
      migrationId: manifest.migrationId
    }
  )

  manifest.lastAppliedAt = appliedAt
  manifest.lastAppliedBatch = normalizedBatch
  saveManifest(manifest)
  return manifest
}

function moveToRollbackTrash(sourcePath, rollbackTrashDir, label) {
  if (!fs.existsSync(sourcePath)) return null
  const target = path.join(rollbackTrashDir, label)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.renameSync(sourcePath, target)
  return target
}

function rollbackManifest(manifest) {
  const rollbackAt = new Date().toISOString()
  for (const item of [...manifest.applyLog].reverse()) {
    if (!fs.existsSync(item.backupPath)) continue
    if (item.type === 'project') {
      moveToRollbackTrash(item.targetPath, manifest.rollbackTrashDir, path.join('projects', item.project))
    } else {
      moveToRollbackTrash(item.targetPath, manifest.rollbackTrashDir, path.join('workspace', item.name))
    }
    fs.mkdirSync(path.dirname(item.sourcePath), { recursive: true })
    fs.renameSync(item.backupPath, item.sourcePath)
  }

  if (fs.existsSync(manifest.layout.layoutFile)) {
    fs.rmSync(manifest.layout.layoutFile, { force: true })
  }

  manifest.lastRolledBackAt = rollbackAt
  saveManifest(manifest)
  return manifest
}

function formatPlanSummary(manifest) {
  return [
    `workspaceRoot: ${manifest.workspaceRoot}`,
    `migrationId: ${manifest.migrationId}`,
    `projects: ${manifest.projects.length}`,
    `workspaceEntries: ${manifest.workspaceEntries.length}`,
    `manifest: ${manifest.manifestPath}`
  ].join('\n')
}

function formatApplySummary(manifest) {
  return [
    `appliedAt: ${manifest.lastAppliedAt || 'n/a'}`,
    `batch: ${manifest.lastAppliedBatch || 'n/a'}`,
    `layoutFile: ${manifest.layout.layoutFile}`,
    `operations: ${manifest.applyLog.length}`
  ].join('\n')
}

function formatRollbackSummary(manifest) {
  return [
    `rolledBackAt: ${manifest.lastRolledBackAt || 'n/a'}`,
    `layoutFileRemoved: ${!fs.existsSync(manifest.layout.layoutFile)}`,
    `operationsTracked: ${manifest.applyLog.length}`
  ].join('\n')
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const command = args._[0]
  const workspaceRoot = path.resolve(args.workspace || process.cwd())

  if (command === 'plan') {
    const manifest = createManifest(workspaceRoot)
    if (args.json) {
      process.stdout.write(JSON.stringify(manifest, null, 2) + '\n')
    } else {
      process.stdout.write(formatPlanSummary(manifest) + '\n')
    }
    return manifest
  }

  if (command === 'apply') {
    if (!args.manifest) throw new Error('apply requires --manifest <path>')
    const manifest = applyManifest(loadManifest(args.manifest), args.batch || 'all')
    if (args.json) {
      process.stdout.write(JSON.stringify(manifest, null, 2) + '\n')
    } else {
      process.stdout.write(formatApplySummary(manifest) + '\n')
    }
    return manifest
  }

  if (command === 'rollback') {
    if (!args.manifest) throw new Error('rollback requires --manifest <path>')
    const manifest = rollbackManifest(loadManifest(args.manifest))
    if (args.json) {
      process.stdout.write(JSON.stringify(manifest, null, 2) + '\n')
    } else {
      process.stdout.write(formatRollbackSummary(manifest) + '\n')
    }
    return manifest
  }

  throw new Error('usage: devcodex migrate-layout <plan|apply|rollback> [--manifest path] [--batch A|B|all] [--workspace path] [--json]')
}

if (require.main === module) {
  try {
    runCli()
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}

module.exports = {
  createManifest,
  applyManifest,
  rollbackManifest,
  runCli
}
