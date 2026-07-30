#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')
const {
  parseTenantOption,
  readTenantManifest,
  resolveTenantSelection,
  shouldIncludeInstructionFile
} = require('./lib/tenant-selection')
const { buildDeploymentDescriptors } = require('../index')
const { expandDescriptors } = require('./lib/deployment-manifest-utils')
const { shouldCheckBaseDeploymentSource } = require('./lib/validate-governance-package-deployment')

const ROOT = path.resolve(__dirname, '..')

assert.strictEqual(parseTenantOption([]), null)
assert.strictEqual(parseTenantOption(['--tenant', 'example-tenant']), 'example-tenant')
assert.strictEqual(parseTenantOption(['--tenant=example-tenant']), 'example-tenant')
assert.throws(() => parseTenantOption(['--tenant']), /missing value/)
assert.throws(() => parseTenantOption(['--tenant=a', '--tenant=b']), /only once/)

const manifest = readTenantManifest(ROOT)
assert.strictEqual(manifest.defaultSelection, null)
assert.strictEqual(resolveTenantSelection([], ROOT).tenantId, null)
assert.strictEqual(resolveTenantSelection(['--tenant', 'example-tenant'], ROOT).tenantId, 'example-tenant')
assert.throws(() => resolveTenantSelection(['--tenant', 'missing'], ROOT), /unknown or non-selectable/)

assert.strictEqual(shouldIncludeInstructionFile('10-dev.instructions.md', null), true)
assert.strictEqual(shouldIncludeInstructionFile('tenants/example-tenant/10-dev.instructions.md', null), false)
assert.strictEqual(shouldIncludeInstructionFile('tenants/example-tenant/10-dev.instructions.md', 'example-tenant'), true)
assert.strictEqual(shouldIncludeInstructionFile('tenants/other/10-dev.instructions.md', 'example-tenant'), false)

const defaultEntries = expandDescriptors(ROOT, ROOT, buildDeploymentDescriptors(['copilot']))
assert.ok(!defaultEntries.some(entry => entry.source.includes('/instructions/tenants/')), 'default deployment must exclude all tenant files')
const selectedEntries = expandDescriptors(ROOT, ROOT, buildDeploymentDescriptors(['copilot'], { tenantId: 'example-tenant' }))
assert.ok(selectedEntries.some(entry => entry.source === 'content/instructions/tenants/example-tenant/10-dev.instructions.md'))
assert.ok(!selectedEntries.some(entry => entry.source === 'content/instructions/tenants/README.md'))
assert.strictEqual(shouldCheckBaseDeploymentSource('instructions/10-dev.instructions.md'), true)
assert.strictEqual(shouldCheckBaseDeploymentSource('instructions/tenants/example-tenant/10-dev.instructions.md'), false)
assert.strictEqual(shouldCheckBaseDeploymentSource('content/instructions/10-dev.instructions.md'), true)
assert.strictEqual(shouldCheckBaseDeploymentSource('content/instructions/tenants/example-tenant/10-dev.instructions.md'), false)

console.log('✓ tenant selection is explicit, fail-closed and deployment-filtered')
