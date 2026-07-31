#!/usr/bin/env node
'use strict'
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { listControlDeliveryEntries } = require('./lib/control-content-delivery')

const ROOT = path.resolve(__dirname, '..')
const out = execSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf8' })
const pack = JSON.parse(out)[0] || {}
const files = (pack.files || []).map(file => file.path)

function resolveLocalDependency(fromFile, request) {
  const resolved = path.normalize(path.join(path.dirname(fromFile), request)).replace(/\\/g, '/')
  if (path.extname(resolved)) return resolved
  if (fs.existsSync(path.join(ROOT, `${resolved}.js`))) return `${resolved}.js`
  if (fs.existsSync(path.join(ROOT, resolved, 'index.js'))) return `${resolved}/index.js`
  return `${resolved}.js`
}

function collectRuntimeDependencies(file, seen = new Set()) {
  if (seen.has(file)) return []
  seen.add(file)

  const fullPath = path.join(ROOT, file)
  if (!fs.existsSync(fullPath)) return [file]

  // Strip comments so doc examples like require('../scripts/lib/...') are not treated as deps.
  const content = fs.readFileSync(fullPath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const deps = []

  for (const match of content.matchAll(/require\(['"](\.{1,2}\/[^'"]+)['"]\)/g)) {
    deps.push(resolveLocalDependency(file, match[1]))
  }

  for (const match of content.matchAll(/path\.join\(\s*ROOT\s*,\s*((?:['"][^'"]+['"]\s*,?\s*)+)\)/g)) {
    const parts = Array.from(match[1].matchAll(/['"]([^'"]+)['"]/g)).map(item => item[1])
    if (parts[0] === 'scripts' && /\.js$/.test(parts[parts.length - 1] || '')) {
      deps.push(parts.join('/'))
    }
  }

  return Array.from(new Set(
    deps.flatMap(dep => [dep].concat(collectRuntimeDependencies(dep, seen)))
  ))
}

const forbidden = [
  /data\/violations\.md/,
  /data\/pending-fixes\.md/,
  /data\/process-improvements\.md/,
  /data\/pending-issues\.md/,
  /data\/gap-registry\.md/,
  /skills\/portfolio-evidence\.json/,
  /content-source\//,
  /^content\//,
  /schema-dsl/i,
  /vext-test/i,
]

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'))
const npmignore = fs.readFileSync(path.join(ROOT, '.npmignore'), 'utf8')
// Exact file entries only — skip directory suffixes and globs (e.g. skills/*/**)
const packageFiles = (pkg.files || []).filter(item => (
  !item.endsWith('/') && !/[*?![\]]/.test(item)
))
const pluginFiles = (plugin.skills || []).map(item => item.file).filter(Boolean)
const packagedScripts = packageFiles.filter(file => file.startsWith('scripts/') && file.endsWith('.js'))
const packagedScriptDeps = packagedScripts.flatMap(file => collectRuntimeDependencies(file))
const promptFiles = listControlDeliveryEntries(ROOT, 'prompts')
  .filter(entry => entry.relative.endsWith('.prompt.md'))
  .map(entry => `prompts/${entry.relative}`)
const dataTemplateFiles = walk(path.join(ROOT, 'data', 'templates'))
  .filter(file => file.endsWith('.md'))
  .map(file => path.relative(ROOT, file).replace(/\\/g, '/'))
const indexRuntimeRequires = collectRuntimeDependencies('index.js')
const skillPackFiles = files.filter(file => file.startsWith('skills/') && file.endsWith('SKILL.md'))

const required = [
  'instructions.md',
  'plugin.json',
  '.mcp.json',
  'codex/hooks.json',
  'hooks/devcodex.lifecycle.json',
  'hooks/_runtime/lifecycle.cjs',
  'mcp/memory-server.js',
  'mcp/profile-server.js',
  'mcp/agent-identity.cjs',
  'host-projections/AGENTS.md',
  'host-projections/CLAUDE.md',
  'scripts/instruction-fallback-check.js',
  'scripts/migrate-layout.js',
  'assets/icon-512.png',
  'skills/portfolio.json',
].concat(packageFiles, pluginFiles, promptFiles, dataTemplateFiles, indexRuntimeRequires, packagedScriptDeps)
  .filter(Boolean)
  .filter(file => !file.endsWith('/'))

const combined = files.join('\n') + '\n' + (pack.name || '') + '\n' + (pack.filename || '')
const hits = forbidden.filter(re => re.test(combined))
if (hits.length) {
  console.error('\x1b[31m✗ Pack contains forbidden content:\x1b[0m')
  hits.forEach(re => console.error('  ' + re))
  console.error('--- pack files ---')
  console.error(files.join('\n'))
  process.exit(1)
}

const missing = required.filter(file => !files.includes(file))
if (missing.length) {
  console.error('\x1b[31m✗ Pack missing required content:\x1b[0m')
  missing.forEach(file => console.error('  ' + file))
  process.exit(1)
}
if (skillPackFiles.length < 10) {
  console.error('\x1b[31m✗ Pack missing skills (expected skills/*/** to include SKILL.md packages):\x1b[0m')
  console.error(`  found ${skillPackFiles.length} skills/*/SKILL.md`)
  process.exit(1)
}
if (files.some(file => file === 'skills/portfolio-evidence.json')) {
  console.error('\x1b[31m✗ Pack must exclude skills/portfolio-evidence.json\x1b[0m')
  process.exit(1)
}
if (npmignore.includes('tests/')) {
  console.error('\x1b[31m✗ .npmignore contains stale "tests/" exclusion; tests live under scripts/test-*.js\x1b[0m')
  process.exit(1)
}
console.log('\x1b[32m✓ Pack clean\x1b[0m')
