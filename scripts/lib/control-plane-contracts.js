'use strict'

const fs = require('fs')
const path = require('path')
const { resolveControlAsset } = require('./control-content-delivery')

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(resolveControlAsset(root, relativePath), 'utf8'))
}

function unique(values, label, errors) {
  const seen = new Set()
  for (const value of values) {
    if (seen.has(value)) errors.push(`duplicate ${label}: ${value}`)
    seen.add(value)
  }
}

function validateGateRegistry(registry, registeredSkills) {
  const errors = []
  if (registry.schemaVersion !== 1 || registry.ownerSkill !== 'spec-governance') errors.push('invalid gate registry header')
  if (!Array.isArray(registry.groups) || registry.groups.length === 0) errors.push('gate registry groups missing')
  unique((registry.groups || []).map(group => group.id), 'gate group', errors)
  for (const group of registry.groups || []) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group.id || '')) errors.push(`invalid gate group id: ${group.id}`)
    for (const field of ['ownerSkills', 'requiredEvidence', 'validationRoute', 'legacyAnchors']) {
      if (!Array.isArray(group[field]) || group[field].length === 0) errors.push(`${group.id} missing ${field}`)
    }
    for (const owner of group.ownerSkills || []) {
      if (!registeredSkills.has(owner)) errors.push(`${group.id} has unknown owner: ${owner}`)
    }
    if (!group.trigger) errors.push(`${group.id} missing trigger`)
  }
  return errors
}

function validateReportSchema(schema, workflowIds) {
  const errors = []
  if (schema.schemaVersion !== 1 || schema.ownerSkill !== 'report') errors.push('invalid report schema header')
  if (schema.gateRegistryRef !== 'skills/spec-governance/gate-registry.json') errors.push('report schema gate registry ref mismatch')
  unique(schema.baseFields || [], 'report base field', errors)
  for (const workflow of Object.keys(schema.overlays || {})) {
    const normalized = workflow === 'scenario-test' || workflow === 'optimization' ? 'dev' : workflow
    if (!workflowIds.has(normalized)) errors.push(`report overlay has unknown workflow: ${workflow}`)
    if (!Array.isArray(schema.overlays[workflow]) || schema.overlays[workflow].length === 0) errors.push(`empty report overlay: ${workflow}`)
  }
  return errors
}

function validateTestRouteSchema(schema) {
  const errors = []
  if (schema.schemaVersion !== 1 || schema.ownerSkill !== 'test-router') errors.push('invalid TestRoute schema header')
  if (schema.gateRegistryRef !== 'skills/spec-governance/gate-registry.json') errors.push('TestRoute gate registry ref mismatch')
  for (const field of ['stableInputs', 'selectors', 'outputs', 'skipRequiredFields']) {
    if (!Array.isArray(schema[field]) || schema[field].length === 0) errors.push(`TestRoute missing ${field}`)
  }
  unique(schema.stableInputs || [], 'TestRoute input', errors)
  unique((schema.selectors || []).map(item => item.id), 'TestRoute selector', errors)
  unique(schema.outputs || [], 'TestRoute output', errors)
  if (!schema.stableInputs?.includes('verificationIntent')) errors.push('TestRoute missing verificationIntent input')
  if (schema.verificationIntent?.schemaVersion !== 'VerificationIntentV1') errors.push('TestRoute verification intent schema mismatch')
  for (const level of ['V0', 'V1', 'V2', 'V3']) {
    if (!schema.verificationIntent?.levels?.includes(level)) errors.push(`TestRoute verification level missing: ${level}`)
  }
  for (const edgeType of ['runtimeConsumer', 'qualificationConsumer', 'releaseConsumer']) {
    if (!schema.consumerEdgeTypes?.includes(edgeType)) errors.push(`TestRoute consumer edge type missing: ${edgeType}`)
  }
  if (schema.scopedRouteBoundaries?.['profile-deploy'] !== 'profile' ||
      schema.scopedRouteBoundaries?.['package-release'] !== 'package') {
    errors.push('TestRoute scoped route boundary mismatch')
  }
  for (const field of ['manifestIdentity', 'candidateId', 'candidateStable', 'planDigest']) {
    if (!schema.executionBinding?.requiredFields?.includes(field)) {
      errors.push(`TestRoute execution binding missing: ${field}`)
    }
  }
  if (schema.executionBinding?.cacheSchema !== 'ValidationEvidenceV2' ||
      schema.executionBinding?.cacheNamespace !== 'validation-evidence/v2' ||
      schema.executionBinding?.downstreamBinding !== 'nodeReceiptDigest' ||
      schema.executionBinding?.v3CacheReuse !== false) {
    errors.push('TestRoute execution/cache binding mismatch')
  }
  if (schema.budgetPolicy?.nonReleaseThresholdMs !== 600000 ||
      schema.budgetPolicy?.unknownImpactAction !== 'block' ||
      schema.budgetPolicy?.staleCacheAction !== 'rerun-precise-node') {
    errors.push('TestRoute budget/fallback policy mismatch')
  }
  return errors
}

function validateCapabilitySurfaceDecisionSchema(schema) {
  const errors = []
  const properties = schema.properties || {}
  if (
    schema.title !== 'CapabilitySurfaceDecisionV1' ||
    schema.$id !== 'https://devcodex.dev/schemas/capability-surface-decision.v1.schema.json'
  ) {
    errors.push('invalid CapabilitySurfaceDecision schema header')
  }
  const required = new Set(schema.required || [])
  for (const field of [
    'schemaVersion',
    'decisionRef',
    'capabilityId',
    'preferredSurface',
    'decisionOwner',
    'runtimeOwner',
    'stateOwner',
    'canonicalRecordPath',
    'writer',
    'readers',
    'identity',
    'invalidationTriggers',
    'truthBoundary',
    'status'
  ]) {
    if (!required.has(field)) errors.push(`CapabilitySurfaceDecision missing required field: ${field}`)
  }
  if (properties.schemaVersion?.const !== 'CapabilitySurfaceDecisionV1') {
    errors.push('CapabilitySurfaceDecision schema version mismatch')
  }
  if (properties.decisionOwner?.const !== 'spec-governance') {
    errors.push('CapabilitySurfaceDecision decision owner mismatch')
  }
  if (properties.writer?.const !== 'workflow-single-writer') {
    errors.push('CapabilitySurfaceDecision writer mismatch')
  }
  if (
    properties.truthBoundary?.properties?.canonicalOwner?.const !== 'spec-governance' ||
    properties.truthBoundary?.properties?.localMetadataOnly?.const !== true ||
    properties.truthBoundary?.properties?.copiedCentralFields?.maxItems !== 0
  ) {
    errors.push('CapabilitySurfaceDecision truth boundary mismatch')
  }
  const surfaces = properties.preferredSurface?.enum || []
  unique(surfaces, 'CapabilitySurfaceDecision surface', errors)
  for (const surface of [
    'rule-skill',
    'prompt',
    'resource',
    'resource-template',
    'tool',
    'task-augmented-tool',
    'cli',
    'hook'
  ]) {
    if (!surfaces.includes(surface)) errors.push(`CapabilitySurfaceDecision missing surface: ${surface}`)
  }
  const conditionalContract = JSON.stringify(schema.allOf || [])
  for (const field of ['authority', 'mcpContract', 'taskContract', 'resourceContract']) {
    if (!conditionalContract.includes(`"${field}"`)) {
      errors.push(`CapabilitySurfaceDecision missing conditional contract: ${field}`)
    }
  }
  return errors
}

function loadControlPlaneContracts(root) {
  const plugin = readJson(root, 'plugin.json')
  const workflow = readJson(root, 'skills/routing/workflow-capabilities.json')
  const gateRegistry = readJson(root, 'skills/spec-governance/gate-registry.json')
  const reportSchema = readJson(root, 'skills/report/report-schema.json')
  const testRouteSchema = readJson(root, 'skills/test-router/test-route-schema.json')
  const capabilitySurfaceDecisionSchema = readJson(root, 'skills/spec-governance/capability-surface-decision.v1.schema.json')
  const registeredSkills = new Set((plugin.skills || []).map(item => item.id))
  const workflowIds = new Set((workflow.workflows || []).map(item => item.id))
  const errors = [
    ...validateGateRegistry(gateRegistry, registeredSkills),
    ...validateReportSchema(reportSchema, workflowIds),
    ...validateTestRouteSchema(testRouteSchema),
    ...validateCapabilitySurfaceDecisionSchema(capabilitySurfaceDecisionSchema)
  ]
  return {
    plugin,
    workflow,
    gateRegistry,
    reportSchema,
    testRouteSchema,
    capabilitySurfaceDecisionSchema,
    errors
  }
}

module.exports = {
  loadControlPlaneContracts,
  validateGateRegistry,
  validateReportSchema,
  validateTestRouteSchema,
  validateCapabilitySurfaceDecisionSchema
}
