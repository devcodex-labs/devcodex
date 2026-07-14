'use strict'

const fs = require('fs')
const path = require('path')

function parseTenantOption(argv) {
  const values = []
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (value === '--tenant') {
      const next = argv[index + 1]
      if (!next || next.startsWith('--')) throw new Error('missing value for --tenant')
      values.push(next)
      index++
    } else if (value.startsWith('--tenant=')) {
      const next = value.slice('--tenant='.length)
      if (!next) throw new Error('missing value for --tenant')
      values.push(next)
    }
  }
  if (values.length > 1) throw new Error('--tenant may be specified only once')
  return values[0] || null
}

function readTenantManifest(packageRoot) {
  const file = path.join(packageRoot, 'instructions', 'tenants', 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.tenants)) {
    throw new Error(`unsupported tenant manifest schema: ${file}`)
  }
  const ids = new Set()
  for (const tenant of manifest.tenants) {
    if (!tenant || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenant.id || '')) {
      throw new Error(`invalid tenant id in manifest: ${tenant && tenant.id || '(missing)'}`)
    }
    if (ids.has(tenant.id)) throw new Error(`duplicate tenant id in manifest: ${tenant.id}`)
    ids.add(tenant.id)
    if (tenant.directory !== tenant.id) throw new Error(`tenant directory must match id: ${tenant.id}`)
  }
  return manifest
}

function resolveTenantSelection(argv, packageRoot) {
  const tenantId = parseTenantOption(argv)
  const manifest = readTenantManifest(packageRoot)
  if (tenantId === null) return { tenantId: null, manifest }
  const tenant = manifest.tenants.find(item => item.id === tenantId)
  if (!tenant || tenant.selectable === false) throw new Error(`unknown or non-selectable tenant: ${tenantId}`)
  const directory = path.join(packageRoot, 'instructions', 'tenants', tenant.directory)
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`tenant directory missing: ${tenant.directory}`)
  }
  return { tenantId, manifest, tenant }
}

function shouldIncludeInstructionFile(relativePath, tenantId) {
  const portable = relativePath.replace(/\\/g, '/')
  if (!portable.startsWith('tenants/')) return true
  if (!tenantId) return false
  return portable.startsWith(`tenants/${tenantId}/`)
}

module.exports = {
  parseTenantOption,
  readTenantManifest,
  resolveTenantSelection,
  shouldIncludeInstructionFile
}
