'use strict'

const fs = require('fs')
const path = require('path')

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
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
  return errors
}

function loadControlPlaneContracts(root) {
  const plugin = readJson(root, 'plugin.json')
  const workflow = readJson(root, 'skills/routing/workflow-capabilities.json')
  const gateRegistry = readJson(root, 'skills/spec-governance/gate-registry.json')
  const reportSchema = readJson(root, 'skills/report/report-schema.json')
  const testRouteSchema = readJson(root, 'skills/test-router/test-route-schema.json')
  const registeredSkills = new Set((plugin.skills || []).map(item => item.id))
  const workflowIds = new Set((workflow.workflows || []).map(item => item.id))
  const errors = [
    ...validateGateRegistry(gateRegistry, registeredSkills),
    ...validateReportSchema(reportSchema, workflowIds),
    ...validateTestRouteSchema(testRouteSchema)
  ]
  return { plugin, workflow, gateRegistry, reportSchema, testRouteSchema, errors }
}

module.exports = {
  loadControlPlaneContracts,
  validateGateRegistry,
  validateReportSchema,
  validateTestRouteSchema
}
