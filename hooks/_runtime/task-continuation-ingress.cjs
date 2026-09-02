'use strict'

const { isStableTaskId } = require('./task-continuation-contract.cjs')

const TASK_CONTINUATION_TARGET_DECISION_SCHEMA = 'TaskContinuationTargetDecisionV1'

function text(value) {
  return String(value || '').trim()
}

function blocked(errorCode, message, nextStep, evidence = {}) {
  return Object.freeze({
    schemaVersion: TASK_CONTINUATION_TARGET_DECISION_SCHEMA,
    status: errorCode === 'TASK_ROUTE_REVISION_STALE' ? 'stale' : 'blocked',
    verified: false,
    selectionAuthority: false,
    mutationAuthority: false,
    errorCode,
    message,
    nextStep,
    evidence
  })
}

function verified(project, scope, source, evidence = {}, authorityCeiling = 'task-selection-only') {
  return Object.freeze({
    schemaVersion: TASK_CONTINUATION_TARGET_DECISION_SCHEMA,
    status: 'verified',
    verified: true,
    project: text(project),
    scope,
    source,
    selectionAuthority: true,
    mutationAuthority: false,
    authorityCeiling,
    evidence
  })
}

function workspaceLocator(source, evidence = {}) {
  return verified('', 'workspace', source, evidence, 'workspace-locator-only')
}

/**
 * Select a bounded project/workspace search boundary for task continuation.
 * A stale session route is discarded instead of blocking the user turn; every
 * route and locator result remains selection-only and grants no mutation right.
 */
function decideTaskContinuationTarget(input = {}) {
  const command = input.command && typeof input.command === 'object' ? input.command : null
  if (!command || (!text(command.displayQuery) && command.bare !== true)) {
    return blocked(
      'TASK_CONTINUATION_COMMAND_REQUIRED',
      'A parsed task continuation command is required.',
      'Use an exact continuation command before resolving a task target.'
    )
  }
  if (input.projectQualifierError) {
    return blocked(
      text(input.projectQualifierError.code) || 'TASK_PROJECT_QUALIFIER_INVALID',
      text(input.projectQualifierError.message) || 'The project qualifier is invalid.',
      'Use: 继续 <任务名>，项目=<项目>，并确保项目唯一存在。'
    )
  }

  const explicitProject = text(input.explicitProject)
  if (explicitProject) {
    return verified(
      explicitProject,
      'project',
      text(input.explicitProjectSource) || 'explicit-project',
      { actualInstructionBound: input.actualInstructionBound === true }
    )
  }

  const contextProject = text(input.contextProject)
  if (contextProject) {
    return verified(contextProject, 'project', 'context-root', { physicalContextBound: true })
  }

  if (input.layoutEnabled !== true) {
    return verified(text(input.legacyProject), 'project', 'legacy-physical-root', {
      physicalContextBound: true,
      legacyLayout: true
    }, 'legacy-task-selection-only')
  }

  const promptTarget = input.promptTarget && typeof input.promptTarget === 'object'
    ? input.promptTarget
    : {}
  if (text(promptTarget.source) === 'sticky' && text(promptTarget.activeProject)) {
    if (!text(input.sessionRef)) {
      return workspaceLocator('workspace-fallback-after-stale-hint', {
        discardedHintErrorCode: 'TASK_SESSION_REQUIRED',
        hintedProject: text(promptTarget.activeProject)
      })
    }
    const validation = input.projectLeaseValidation && typeof input.projectLeaseValidation === 'object'
      ? input.projectLeaseValidation
      : {}
    const lease = validation.lease && typeof validation.lease === 'object' ? validation.lease : {}
    if (validation.valid !== true || lease.schemaVersion !== 'ProjectTargetLeaseV2') {
      return workspaceLocator('workspace-fallback-after-stale-hint', {
        discardedHintErrorCode: 'TASK_PROJECT_LEASE_MISMATCH',
        leaseReason: text(validation.reason) || 'unavailable',
        hintedProject: text(promptTarget.activeProject)
      })
    }
    if (lease.authorityKind !== 'session' || text(lease.project) !== text(promptTarget.activeProject)) {
      return workspaceLocator('workspace-fallback-after-stale-hint', {
        discardedHintErrorCode: 'TASK_PROJECT_LEASE_MISMATCH',
        hintedProject: text(promptTarget.activeProject)
      })
    }
    const routeHint = input.routeHint && typeof input.routeHint === 'object' ? input.routeHint : {}
    const entry = routeHint.entry && typeof routeHint.entry === 'object' ? routeHint.entry : {}
    if (routeHint.status !== 'fresh' || entry.state !== 'live') {
      return workspaceLocator('workspace-fallback-after-stale-hint', {
        discardedHintErrorCode: 'TASK_SESSION_ROUTE_UNAVAILABLE',
        hintedProject: text(promptTarget.activeProject)
      })
    }
    if (text(routeHint.sessionDigest) !== text(lease.authorityDigest) ||
        text(entry.sessionDigest) !== text(lease.authorityDigest) ||
        text(entry.projectRootIdentityDigest) !== text(lease.rootIdentityDigest)) {
      return workspaceLocator('workspace-fallback-after-stale-hint', {
        discardedHintErrorCode: 'TASK_SESSION_ROUTE_PROJECT_MISMATCH',
        hintedProject: text(promptTarget.activeProject)
      })
    }
    if (text(entry.routeRevision) !== text(lease.routeRevision)) {
      return workspaceLocator('workspace-fallback-after-stale-hint', {
        discardedHintErrorCode: 'TASK_ROUTE_REVISION_STALE',
        hintedProject: text(promptTarget.activeProject)
      })
    }
    const currentRouteRevision = text(input.currentRouteRevision)
    if (!currentRouteRevision) {
      return workspaceLocator('workspace-fallback-after-stale-hint', {
        discardedHintErrorCode: 'TASK_ROUTE_REGISTRY_UNAVAILABLE',
        hintedProject: text(promptTarget.activeProject)
      })
    }
    if (text(entry.routeRevision) !== 'pending' && text(entry.routeRevision) !== currentRouteRevision) {
      return workspaceLocator('workspace-fallback-after-stale-hint', {
        discardedHintErrorCode: 'TASK_ROUTE_REVISION_STALE',
        hintedProject: text(promptTarget.activeProject),
        observedRouteRevision: text(entry.routeRevision),
        currentRouteRevision
      })
    }
    return verified(
      promptTarget.activeProject,
      'project',
      'session-project-lease',
      {
        sessionDigest: text(entry.sessionDigest),
        projectRootIdentityDigest: text(entry.projectRootIdentityDigest),
        routeRevision: text(entry.routeRevision),
        leaseDigest: text(lease.leaseDigest)
      },
      text(entry.routeRevision) === 'pending'
        ? 'task-selection-only-pending-route'
        : 'task-selection-only'
    )
  }

  if (isStableTaskId(command.displayQuery)) {
    return verified('', 'workspace', 'actual-stable-task-id', {
      actualInstructionBound: input.actualInstructionBound === true,
      stableTaskId: text(command.displayQuery).toLowerCase()
    }, 'stable-task-id-selection-only')
  }

  return workspaceLocator(command.bare === true ? 'bare-workspace-locator' : 'named-workspace-locator', {
    actualInstructionBound: input.actualInstructionBound === true,
    promptTargetSource: text(promptTarget.source) || 'unresolved',
    stableSession: Boolean(text(input.sessionRef))
  })
}

module.exports = {
  TASK_CONTINUATION_TARGET_DECISION_SCHEMA,
  decideTaskContinuationTarget
}
