'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function walk(root) {
  if (!fs.existsSync(root)) return []
  const out = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function portable(relative) {
  return relative.replace(/\\/g, '/')
}

function destinationKey(targetRoot, destination) {
  const resolved = path.normalize(path.resolve(targetRoot, String(destination || '')))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function findOwnershipConflicts(entries, targetRoot) {
  const owners = new Map()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = destinationKey(targetRoot, entry.destination)
    if (!owners.has(key)) owners.set(key, [])
    owners.get(key).push(entry)
  }
  return [...owners.values()]
    .filter(group => group.length > 1)
    .map(group => ({
      destination: portable(group[0].destination),
      owners: group
        .map(entry => `${entry.surface}:${entry.source}`)
        .sort()
    }))
    .sort((left, right) => left.destination.localeCompare(right.destination))
}

function expandDescriptors(packageRoot, targetRoot, descriptors) {
  const entries = []
  for (const descriptor of descriptors) {
    const sourcePath = path.join(packageRoot, descriptor.source)
    if (!fs.existsSync(sourcePath)) continue
    const stat = fs.statSync(sourcePath)
    const files = (stat.isDirectory() ? walk(sourcePath) : [sourcePath])
      .filter(file => !descriptor.fileFilter || descriptor.fileFilter(portable(path.relative(sourcePath, file))))
    for (const file of files) {
      const suffix = stat.isDirectory() ? path.relative(sourcePath, file) : ''
      const destination = suffix ? path.join(descriptor.destination, suffix) : descriptor.destination
      entries.push({
        source: portable(path.relative(packageRoot, file)),
        destination: portable(destination),
        surface: descriptor.surface,
        hash: fileHash(file)
      })
    }
  }
  return entries.sort((a, b) => a.destination.localeCompare(b.destination) || a.surface.localeCompare(b.surface))
}

function readManifest(manifestFile) {
  if (!fs.existsSync(manifestFile)) return null
  const value = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  if (value.schemaVersion !== 1 || !Array.isArray(value.entries) || !Array.isArray(value.staleEntries)) {
    throw new Error(`Unsupported deployment manifest schema: ${manifestFile}`)
  }
  return value
}

function scanUnowned(targetRoot, descriptors, knownDestinations) {
  const roots = Array.from(new Set(descriptors
    .filter(item => fs.existsSync(path.join(targetRoot, item.destination)) && fs.statSync(path.join(targetRoot, item.destination)).isDirectory())
    .map(item => item.destination)))
  return roots.flatMap(relativeRoot => walk(path.join(targetRoot, relativeRoot)))
    .map(file => portable(path.relative(targetRoot, file)))
    .filter(destination => !knownDestinations.has(destination))
    .sort()
}

function createDeploymentSession({ packageRoot, targetRoot, manifestFile, descriptors, packageName, packageVersion }) {
  const selectedSurfaces = new Set(descriptors.flatMap(item => [
    item.surface,
    ...(Array.isArray(item.replacesSurfaces) ? item.replacesSurfaces : [])
  ]))
  const previous = readManifest(manifestFile)
  const selectedEntries = expandDescriptors(packageRoot, targetRoot, descriptors)
  const selectedConflicts = findOwnershipConflicts(selectedEntries, targetRoot)
  if (selectedConflicts.length) {
    const detail = selectedConflicts.map(item => `${item.destination} <= ${item.owners.join(', ')}`).join('; ')
    throw new Error(`Deployment descriptor ownership conflict: ${detail}`)
  }
  const selectedDestinationKeys = new Set(selectedEntries.map(entry => destinationKey(targetRoot, entry.destination)))
  const preservedEntries = (previous && previous.entries || []).filter(entry =>
    !selectedSurfaces.has(entry.surface) &&
    !selectedDestinationKeys.has(destinationKey(targetRoot, entry.destination))
  )
  const entries = preservedEntries.concat(selectedEntries)
    .sort((a, b) => a.destination.localeCompare(b.destination) || a.surface.localeCompare(b.surface))
  const previousSelected = (previous && previous.entries || []).filter(entry =>
    selectedSurfaces.has(entry.surface) ||
    selectedDestinationKeys.has(destinationKey(targetRoot, entry.destination))
  )
  const currentDestinations = new Set(selectedEntries.map(entry => entry.destination))
  const previousDestinations = new Set(previousSelected.map(entry => entry.destination))

  const add = []
  const update = []
  const unchanged = []
  for (const entry of selectedEntries) {
    const destinationPath = path.join(targetRoot, entry.destination)
    if (!fs.existsSync(destinationPath)) add.push(entry)
    else if (fileHash(destinationPath) === entry.hash) unchanged.push(entry)
    else update.push(entry)
  }

  const stale = previousSelected
    .filter(entry =>
      !selectedDestinationKeys.has(destinationKey(targetRoot, entry.destination)) &&
      fs.existsSync(path.join(targetRoot, entry.destination))
    )
  const preservedStale = (previous && previous.staleEntries || [])
    .filter(entry =>
      !selectedSurfaces.has(entry.surface) &&
      !selectedDestinationKeys.has(destinationKey(targetRoot, entry.destination)) &&
      fs.existsSync(path.join(targetRoot, entry.destination))
    )
  const staleEntries = preservedStale.concat(stale)
    .sort((a, b) => a.destination.localeCompare(b.destination) || a.surface.localeCompare(b.surface))
  const knownDestinations = new Set([...currentDestinations, ...previousDestinations])
  const unowned = scanUnowned(targetRoot, descriptors, knownDestinations)

  return {
    manifestFile,
    preview: { add, update, unchanged, stale, unowned },
    manifest: {
      schemaVersion: 1,
      package: packageName,
      packageVersion,
      targetRoot: path.resolve(targetRoot),
      generatedAt: new Date().toISOString(),
      entries,
      staleEntries
    }
  }
}

function writeManifestAtomic(session) {
  const dir = path.dirname(session.manifestFile)
  const temp = `${session.manifestFile}.tmp-${process.pid}`
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(temp, JSON.stringify(session.manifest, null, 2) + '\n')
  fs.renameSync(temp, session.manifestFile)
  return session.manifestFile
}

function verifyManifest({ packageRoot, targetRoot, manifest }) {
  const missing = []
  const mismatched = []
  const staleExisting = []
  const ownershipConflicts = findOwnershipConflicts(manifest.entries, targetRoot)
  for (const entry of manifest.entries) {
    const source = path.join(packageRoot, entry.source)
    const destination = path.join(targetRoot, entry.destination)
    if (!fs.existsSync(source) || !fs.existsSync(destination)) missing.push(entry.destination)
    else if (fileHash(source) !== fileHash(destination) || fileHash(source) !== entry.hash) mismatched.push(entry.destination)
  }
  for (const entry of manifest.staleEntries) {
    if (fs.existsSync(path.join(targetRoot, entry.destination))) staleExisting.push(entry.destination)
  }
  return { missing, mismatched, staleExisting, ownershipConflicts }
}

module.exports = {
  createDeploymentSession,
  destinationKey,
  expandDescriptors,
  fileHash,
  findOwnershipConflicts,
  readManifest,
  verifyManifest,
  writeManifestAtomic
}
