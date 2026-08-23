'use strict'

const fs = require('fs')
const path = require('path')
const {
  DEFAULT_HARD_BYTES,
  DEFAULT_SOFT_BYTES
} = require('./task-recovery-store-v5.cjs')
const {
  findLayoutInfo,
  inferProjectFromCwd,
  namespaceRootPath,
  normalizeProjectNamespace
} = require('./workspace-layout.cjs')

const TASK_RECOVERY_CONFIG_SCHEMA = 'TaskRecoveryConfigV1'
const MIB = 1024 * 1024
const DEFAULT_SOFT_LIMIT_MIB = DEFAULT_SOFT_BYTES / MIB
const DEFAULT_HARD_LIMIT_MIB = DEFAULT_HARD_BYTES / MIB
const MAX_SAFE_LIMIT_MIB = Math.floor(Number.MAX_SAFE_INTEGER / MIB)
const SUPPORTED_KEYS = new Set(['hardLimitMiB'])

function defaultResult (overrides = {}) {
  return {
    schemaVersion: TASK_RECOVERY_CONFIG_SCHEMA,
    status: 'defaulted',
    errorCode: null,
    requestedHardLimitMiB: null,
    softLimitMiB: DEFAULT_SOFT_LIMIT_MIB,
    hardLimitMiB: DEFAULT_HARD_LIMIT_MIB,
    softBytes: DEFAULT_SOFT_BYTES,
    hardBytes: DEFAULT_HARD_BYTES,
    sourcePath: null,
    sourcePaths: [],
    details: null,
    ...overrides
  }
}

function readConfigRecord (filePath, fsImpl = fs) {
  if (!fsImpl.existsSync(filePath)) return { filePath, status: 'missing', value: null }
  try {
    const value = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Profile config root must be an object')
    }
    return { filePath, status: 'loaded', value }
  } catch (error) {
    return { filePath, status: 'invalid', value: null, error: error.message }
  }
}

function validateTaskRecoverySection (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'invalid', details: 'extensions.devcodex.taskRecovery must be an object' }
  }
  const unsupported = Object.keys(value).find(key => !SUPPORTED_KEYS.has(key))
  if (unsupported) {
    return {
      status: 'invalid',
      details: `extensions.devcodex.taskRecovery contains unsupported key: ${unsupported}`
    }
  }
  if (value.hardLimitMiB === undefined) return { status: 'empty', hardLimitMiB: null }
  if (!Number.isSafeInteger(value.hardLimitMiB) ||
      value.hardLimitMiB < DEFAULT_HARD_LIMIT_MIB ||
      value.hardLimitMiB > MAX_SAFE_LIMIT_MIB) {
    return {
      status: 'invalid',
      details: `extensions.devcodex.taskRecovery.hardLimitMiB must be a safe integer >= ${DEFAULT_HARD_LIMIT_MIB}`
    }
  }
  return { status: 'valid', hardLimitMiB: value.hardLimitMiB }
}

function resolveTaskRecoveryConfigForCwd (cwd, explicitProject = '', options = {}) {
  const fsImpl = options.fs || fs
  const absoluteCwd = path.resolve(cwd)
  const layout = findLayoutInfo(absoluteCwd)
  const records = []
  let project = ''

  if (!layout.enabled) {
    records.push(readConfigRecord(path.join(absoluteCwd, '.devcodex', 'profile', 'config.json'), fsImpl))
  } else {
    records.push(readConfigRecord(
      path.join(layout.workspaceRoot, '.devcodex', 'workspace', 'profile', 'config.json'),
      fsImpl
    ))
    const requestedProject = String(explicitProject || '').trim()
    if (requestedProject && requestedProject.toLowerCase() !== 'workspace') {
      try {
        project = normalizeProjectNamespace(requestedProject, {
          layout,
          contextProject: inferProjectFromCwd(absoluteCwd, layout) || ''
        })
      } catch (error) {
        return defaultResult({
          status: 'fail-closed',
          errorCode: error.code || 'TASK_RECOVERY_PROJECT_CONFIG_INVALID',
          sourcePaths: records.map(record => record.filePath),
          details: error.message
        })
      }
    } else if (!requestedProject) {
      project = inferProjectFromCwd(absoluteCwd, layout) || ''
    }
    if (project) {
      records.push(readConfigRecord(
        path.join(namespaceRootPath(layout.workspaceRoot, project), 'profile', 'config.json'),
        fsImpl
      ))
    }
  }

  const invalidRecord = records.find(record => record.status === 'invalid')
  if (invalidRecord) {
    return defaultResult({
      status: 'fail-closed',
      errorCode: 'TASK_RECOVERY_PROFILE_CONFIG_INVALID',
      sourcePaths: records.map(record => record.filePath),
      details: `${invalidRecord.filePath}: ${invalidRecord.error}`
    })
  }

  let requestedHardLimitMiB = null
  let sourcePath = null
  for (const record of records) {
    if (record.status !== 'loaded') continue
    const section = record.value?.extensions?.devcodex?.taskRecovery
    if (section === undefined) continue
    const validated = validateTaskRecoverySection(section)
    if (validated.status === 'invalid') {
      return defaultResult({
        status: 'fail-closed',
        errorCode: 'TASK_RECOVERY_CONFIG_INVALID',
        sourcePath: record.filePath,
        sourcePaths: records.map(item => item.filePath),
        details: validated.details
      })
    }
    if (validated.status === 'valid') {
      requestedHardLimitMiB = validated.hardLimitMiB
      sourcePath = record.filePath
    }
  }

  const hardLimitMiB = requestedHardLimitMiB || DEFAULT_HARD_LIMIT_MIB
  return defaultResult({
    status: requestedHardLimitMiB ? 'configured' : 'defaulted',
    requestedHardLimitMiB,
    hardLimitMiB,
    hardBytes: hardLimitMiB * MIB,
    sourcePath,
    sourcePaths: records.map(record => record.filePath)
  })
}

module.exports = {
  DEFAULT_HARD_LIMIT_MIB,
  DEFAULT_SOFT_LIMIT_MIB,
  MAX_SAFE_LIMIT_MIB,
  TASK_RECOVERY_CONFIG_SCHEMA,
  resolveTaskRecoveryConfigForCwd,
  validateTaskRecoverySection
}
