'use strict'

const fs = require('fs')
const path = require('path')

const CONTRACT_SCHEMA = 'PublishedPackageScriptsContractV1'
const VALIDATION_RECEIPT_SCHEMA = 'PublishedPackageScriptsValidationReceiptV1'

const PUBLISHED_SCRIPTS = Object.freeze({
  postinstall: 'node scripts/postinstall.js',
  prepack: 'node scripts/prepack-control-content.js',
  postpack: 'node scripts/postpack-control-content.js',
  validate: 'node scripts/validate-installed-package.js',
  'global-adapters:apply': 'node index.js global-adapters apply',
  'global-adapters:apply:dry-run': 'node index.js global-adapters apply --dry-run',
  'global-adapters:remove': 'node index.js global-adapters remove --apply',
  'global-adapters:remove:dry-run': 'node index.js global-adapters remove --dry-run'
})

function contractError (code, message, details = {}) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  Object.assign(error, details)
  return error
}

function portable (value) {
  return String(value || '').replace(/\\/g, '/')
}

function isPlainObject (value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneJson (value) {
  return JSON.parse(JSON.stringify(value))
}

function buildPublishedPackageManifest (sourceManifest) {
  if (!isPlainObject(sourceManifest)) {
    throw contractError('PUBLISHED_PACKAGE_MANIFEST_INVALID', 'source manifest must be an object')
  }
  const projected = cloneJson(sourceManifest)
  projected.scripts = { ...PUBLISHED_SCRIPTS }
  return projected
}

function parseScriptCommand (command) {
  const text = String(command || '')
  const nodeTargets = []
  const nestedScripts = []
  const nodePattern = /(?:^|(?:&&|\|\||;)\s*)node(?:\.exe)?\s+(?:"([^"]+)"|'([^']+)'|([^\s&|;]+))/g
  const nestedPattern = /(?:^|(?:&&|\|\||;)\s*)npm(?:\.cmd)?\s+run(?:-script)?\s+(?:"([^"]+)"|'([^']+)'|([^\s&|;]+))/g

  for (const match of text.matchAll(nodePattern)) {
    const target = match[1] || match[2] || match[3]
    if (target && !target.startsWith('-')) nodeTargets.push(portable(target.replace(/,$/, '')))
  }
  for (const match of text.matchAll(nestedPattern)) {
    const target = match[1] || match[2] || match[3]
    if (target) nestedScripts.push(target.replace(/,$/, ''))
  }
  return {
    nodeTargets: [...new Set(nodeTargets)],
    nestedScripts: [...new Set(nestedScripts)]
  }
}

function resolveContainedFile (root, fromFile, request) {
  const absoluteRoot = path.resolve(root)
  const base = fromFile ? path.dirname(path.join(absoluteRoot, fromFile)) : absoluteRoot
  const unresolved = path.resolve(base, request)
  const relative = path.relative(absoluteRoot, unresolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw contractError('PUBLISHED_PACKAGE_SCRIPT_PATH_ESCAPE', request, { fromFile })
  }
  if (path.extname(unresolved)) return portable(relative)
  if (fs.existsSync(`${unresolved}.js`)) return portable(`${relative}.js`)
  if (fs.existsSync(path.join(unresolved, 'index.js'))) return portable(path.join(relative, 'index.js'))
  return portable(`${relative}.js`)
}

function stripComments (content) {
  return String(content)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function collectLocalRuntimeClosure (root, entryFile, state = { seen: new Set(), missing: [] }) {
  const file = portable(entryFile)
  if (state.seen.has(file)) return state
  state.seen.add(file)
  const absolute = path.join(root, file)
  if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile()) {
    state.missing.push(file)
    return state
  }
  if (!/\.(?:c?js|mjs)$/i.test(file)) return state

  const content = stripComments(fs.readFileSync(absolute, 'utf8'))
  const dependencies = []
  for (const match of content.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    dependencies.push(resolveContainedFile(root, file, match[1]))
  }
  for (const match of content.matchAll(/(?:import\s*\(\s*|from\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    dependencies.push(resolveContainedFile(root, file, match[1]))
  }
  for (const match of content.matchAll(/path\.join\(\s*(ROOT|__dirname)\s*,\s*((?:['"][^'"]+['"]\s*,?\s*)+)\)/g)) {
    const parts = Array.from(match[2].matchAll(/['"]([^'"]+)['"]/g), item => item[1])
    if (!parts.length || !/\.(?:c?js|mjs)$/i.test(parts[parts.length - 1])) continue
    const base = match[1] === '__dirname' ? path.dirname(file) : ''
    dependencies.push(resolveContainedFile(root, '', path.join(base, ...parts)))
  }
  for (const match of content.matchAll(/\b(?:spawn|spawnSync|execFile|execFileSync|fork)\(\s*process\.execPath\s*,\s*\[\s*['"]([^'"]+\.(?:c?js|mjs))['"]/g)) {
    dependencies.push(resolveContainedFile(root, '', match[1]))
  }

  for (const dependency of new Set(dependencies)) {
    collectLocalRuntimeClosure(root, dependency, state)
  }
  return state
}

function validateScriptGraph (root, manifest) {
  if (!isPlainObject(manifest?.scripts)) {
    throw contractError('PUBLISHED_PACKAGE_SCRIPTS_INVALID', 'scripts must be an object')
  }
  const scripts = manifest.scripts
  const hasPrepack = Object.prototype.hasOwnProperty.call(scripts, 'prepack')
  const hasPostpack = Object.prototype.hasOwnProperty.call(scripts, 'postpack')
  if (hasPrepack !== hasPostpack) {
    throw contractError('PUBLISHED_PACKAGE_LIFECYCLE_PAIR_INCOMPLETE', 'prepack and postpack must be declared together')
  }

  const entryTargets = new Set()
  const nestedEdges = []
  for (const [name, command] of Object.entries(scripts)) {
    const parsed = parseScriptCommand(command)
    for (const target of parsed.nodeTargets) entryTargets.add(resolveContainedFile(root, '', target))
    for (const nested of parsed.nestedScripts) {
      if (!Object.prototype.hasOwnProperty.call(scripts, nested)) {
        throw contractError('PUBLISHED_PACKAGE_NESTED_SCRIPT_MISSING', `${name} -> ${nested}`, { scriptName: name, nested })
      }
      nestedEdges.push([name, nested])
    }
  }

  const closure = new Set()
  const missingEntries = []
  const missingDependencies = []
  for (const entry of entryTargets) {
    const state = collectLocalRuntimeClosure(root, entry)
    for (const file of state.seen) closure.add(file)
    if (state.missing.includes(entry)) missingEntries.push(entry)
    for (const missing of state.missing) {
      if (missing !== entry) missingDependencies.push(missing)
    }
  }
  if (missingEntries.length) {
    throw contractError('PUBLISHED_PACKAGE_SCRIPT_TARGET_MISSING', [...new Set(missingEntries)].join(', '), {
      missing: [...new Set(missingEntries)]
    })
  }
  if (missingDependencies.length) {
    throw contractError('PUBLISHED_PACKAGE_RUNTIME_DEPENDENCY_MISSING', [...new Set(missingDependencies)].join(', '), {
      missing: [...new Set(missingDependencies)]
    })
  }
  return {
    entryTargets: [...entryTargets].sort(),
    closureFiles: [...closure].sort(),
    nestedEdges
  }
}

function validatePublishedPackageManifest (root, manifest) {
  const scripts = manifest?.scripts
  if (!isPlainObject(scripts)) {
    throw contractError('PUBLISHED_PACKAGE_SCRIPTS_INVALID', 'scripts must be an object')
  }
  const expectedNames = Object.keys(PUBLISHED_SCRIPTS)
  const actualNames = Object.keys(scripts)
  const missingNames = expectedNames.filter(name => !Object.prototype.hasOwnProperty.call(scripts, name))
  const unexpectedNames = actualNames.filter(name => !Object.prototype.hasOwnProperty.call(PUBLISHED_SCRIPTS, name))
  if (missingNames.length) {
    throw contractError('PUBLISHED_PACKAGE_SCRIPTS_MISSING', missingNames.join(', '), { missing: missingNames })
  }
  if (unexpectedNames.length) {
    throw contractError('PUBLISHED_PACKAGE_SCRIPTS_UNEXPECTED', unexpectedNames.join(', '), { unexpected: unexpectedNames })
  }
  for (const [name, expected] of Object.entries(PUBLISHED_SCRIPTS)) {
    if (scripts[name] !== expected) {
      throw contractError('PUBLISHED_PACKAGE_SCRIPT_COMMAND_MISMATCH', name, {
        scriptName: name,
        expected,
        actual: scripts[name]
      })
    }
  }
  const graph = validateScriptGraph(root, manifest)
  return {
    schemaVersion: VALIDATION_RECEIPT_SCHEMA,
    contract: CONTRACT_SCHEMA,
    status: 'PASS',
    root: path.resolve(root),
    scriptCount: actualNames.length,
    scriptNames: actualNames,
    directTargetCount: graph.entryTargets.length,
    entryTargets: graph.entryTargets,
    closureFileCount: graph.closureFiles.length,
    closureFiles: graph.closureFiles,
    nestedEdges: graph.nestedEdges
  }
}

function validatePublishedPackageRoot (root) {
  const manifestPath = path.join(root, 'package.json')
  if (!fs.existsSync(manifestPath)) {
    throw contractError('PUBLISHED_PACKAGE_MANIFEST_MISSING', manifestPath)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  return validatePublishedPackageManifest(root, manifest)
}

function isSourcePackageRoot (root) {
  return fs.existsSync(path.join(root, 'content', 'manifest.json')) &&
    fs.existsSync(path.join(root, 'scripts', 'validate.js'))
}

module.exports = {
  CONTRACT_SCHEMA,
  PUBLISHED_SCRIPTS,
  VALIDATION_RECEIPT_SCHEMA,
  buildPublishedPackageManifest,
  collectLocalRuntimeClosure,
  isSourcePackageRoot,
  parseScriptCommand,
  validatePublishedPackageManifest,
  validatePublishedPackageRoot,
  validateScriptGraph
}
