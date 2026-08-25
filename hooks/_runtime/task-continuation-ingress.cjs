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

/**
 * Select an exact project search boundary for a lifecycle task continuation.
 * Workspace scans are permitted only for a user-supplied stable taskId. A
 * session route remains hint-only and must agree with a sealed V2 project lease.
 */
function decideTaskContinuationTarget(input = {}) {
  const command = input.command && typeof input.command === 'object' ? input.command : null
  if (!command || !text(command.displayQuery)) {
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
      return blocked(
        'TASK_SESSION_REQUIRED',
        'A prior project cannot be inherited without a stable session.',
        'Specify the project explicitly or use the exact stable taskId.'
      )
    }
    const validation = input.projectLeaseValidation && typeof input.projectLeaseValidation === 'object'
      ? input.projectLeaseValidation
      : {}
    const lease = validation.lease && typeof validation.lease === 'object' ? validation.lease : {}
    if (validation.valid !== true || lease.schemaVersion !== 'ProjectTargetLeaseV2') {
      return blocked(
        'TASK_PROJECT_LEASE_MISMATCH',
        `The current ProjectTargetLeaseV2 is unavailable or stale${validation.reason ? `: ${validation.reason}` : ''}.`,
        'Rebind the exact project in this session before continuing the task.',
        { leaseReason: text(validation.reason) || 'unavailable' }
      )
    }
    if (lease.authorityKind !== 'session' || text(lease.project) !== text(promptTarget.activeProject)) {
      return blocked(
        'TASK_PROJECT_LEASE_MISMATCH',
        'The project lease is not bound to this stable session and exact project.',
        'Rebind the exact project in this session before continuing the task.'
      )
    }
    const routeHint = input.routeHint && typeof input.routeHint === 'object' ? input.routeHint : {}
    const entry = routeHint.entry && typeof routeHint.entry === 'object' ? routeHint.entry : {}
    if (routeHint.status !== 'fresh' || entry.state !== 'live') {
      return blocked(
        'TASK_SESSION_ROUTE_UNAVAILABLE',
        'No live WorkspaceSessionRouteIndexV1 entry exists for this session.',
        'Specify the project explicitly to establish a fresh session route.'
      )
    }
    if (text(routeHint.sessionDigest) !== text(lease.authorityDigest) ||
        text(entry.sessionDigest) !== text(lease.authorityDigest) ||
        text(entry.projectRootIdentityDigest) !== text(lease.rootIdentityDigest)) {
      return blocked(
        'TASK_SESSION_ROUTE_PROJECT_MISMATCH',
        'The session route and ProjectTargetLeaseV2 identify different session/project roots.',
        'Rebind the exact project; copied or cross-session leases cannot be reused.'
      )
    }
    if (text(entry.routeRevision) !== text(lease.routeRevision)) {
      return blocked(
        'TASK_ROUTE_REVISION_STALE',
        'The session route revision differs from the current project lease.',
        'Re-run context routing for this session and exact project before continuing.'
      )
    }
    const currentRouteRevision = text(input.currentRouteRevision)
    if (!currentRouteRevision) {
      return blocked(
        'TASK_ROUTE_REGISTRY_UNAVAILABLE',
        'The current workflow route registry revision is unavailable.',
        'Restore the current workflow registry before continuing a routed task.'
      )
    }
    if (text(entry.routeRevision) !== 'pending' && text(entry.routeRevision) !== currentRouteRevision) {
      return blocked(
        'TASK_ROUTE_REVISION_STALE',
        'The session route was issued against an obsolete workflow route revision.',
        'Re-run context routing for this session and exact project before continuing.',
        { observedRouteRevision: text(entry.routeRevision), currentRouteRevision }
      )
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

  return blocked(
    'TASK_PROJECT_REQUIRED',
    'A task name cannot select a project across a multi-project workspace.',
    'Use: 继续 <任务名>，项目=<项目>；或使用精确 taskId。',
    {
      promptTargetSource: text(promptTarget.source) || 'unresolved',
      stableSession: Boolean(text(input.sessionRef))
    }
  )
}

module.exports = {
  TASK_CONTINUATION_TARGET_DECISION_SCHEMA,
  decideTaskContinuationTarget
}
