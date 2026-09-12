#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const REGISTRY = path.join(ROOT, 'hooks', '_runtime', 'artifact-slot-registry.v2.json')
const CONTRACT_KINDS = new Set([
  'schema', 'raw-source', 'schema-or-template', 'schema-or-receipt', 'source-code', 'append-only-ledger',
  'runtime-state', 'profile-contract', 'package-config', 'host-governance', 'public-docs', 'asset',
  'audit-evidence', 'release-artifact'
])

function isDynamicTemplate(value) {
  return /\{[A-Za-z0-9._-]+\}/.test(String(value || ''))
}

function promptPath(ref) {
  return path.join(ROOT, ...String(ref || '').split('/'))
}

function validateSlot(slot) {
  const errors = []
  const hasTemplate = Boolean(slot.templateRef || slot.templateResolver)
  const contract = slot.contentContract
  if (!hasTemplate && !contract) errors.push('slot-template-or-content-contract-required')
  if (hasTemplate) {
    if (!slot.templateRef) errors.push('templateRef-required')
    if (!slot.templateProducer) errors.push('templateProducer-required')
    if (slot.templateValidator !== 'artifact-template-contract') errors.push('templateValidator-invalid')
    if (slot.templateRef && !isDynamicTemplate(slot.templateRef) && !fs.existsSync(promptPath(slot.templateRef))) {
      errors.push('templateRef-missing')
    }
    for (const alias of slot.templateAliases || []) {
      const full = path.join(ROOT, 'content', ...String(alias).split('/'))
      if (!fs.existsSync(full)) errors.push(`templateAlias-missing:${alias}`)
    }
  }
  if (contract) {
    if (!CONTRACT_KINDS.has(contract.kind)) errors.push('contentContract.kind-invalid')
    if (!contract.ref || typeof contract.ref !== 'string') errors.push('contentContract.ref-required')
    if (!contract.reason || typeof contract.reason !== 'string') errors.push('contentContract.reason-required')
  }
  return errors
}

function main() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'))
  const failures = []
  for (const slot of registry.slots || []) {
    const errors = validateSlot(slot)
    if (errors.length) failures.push({ slotId: slot.slotId || 'missing-slot-id', errors })
  }
  const result = {
    schemaVersion: 'ArtifactSlotTemplateCoverageV1',
    registry: path.relative(ROOT, REGISTRY).replace(/\\/g, '/'),
    slotCount: Array.isArray(registry.slots) ? registry.slots.length : 0,
    failures,
    ok: failures.length === 0
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  else if (result.ok) console.log(`Artifact slot template/schema coverage PASS (${result.slotCount} slots)`)
  else console.error(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}

main()
