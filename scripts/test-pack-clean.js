#!/usr/bin/env node
'use strict'
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

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

  const content = fs.readFileSync(fullPath, 'utf8')
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
const packageFiles = (pkg.files || []).filter(item => !item.endsWith('/'))
const pluginFiles = (plugin.skills || []).map(item => item.file).filter(Boolean)
const packagedScripts = packageFiles.filter(file => file.startsWith('scripts/') && file.endsWith('.js'))
const packagedScriptDeps = packagedScripts.flatMap(file => collectRuntimeDependencies(file))
const promptFiles = walk(path.join(ROOT, 'prompts'))
  .filter(file => file.endsWith('.prompt.md'))
  .map(file => path.relative(ROOT, file).replace(/\\/g, '/'))
const dataTemplateFiles = walk(path.join(ROOT, 'data', 'templates'))
  .filter(file => file.endsWith('.md'))
  .map(file => path.relative(ROOT, file).replace(/\\/g, '/'))
const indexRuntimeRequires = collectRuntimeDependencies('index.js')

const required = [
  'instructions.md',
  'plugin.json',
  '.mcp.json',
  'codex/hooks.json',
  'hooks/devcodex.lifecycle.json',
  'hooks/_runtime/lifecycle.cjs',
  'mcp/memory-server.js',
  'mcp/profile-server.js',
  'scripts/instruction-fallback-check.js',
  'scripts/migrate-layout.js',
  'assets/icon-512.png',
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
if (npmignore.includes('tests/')) {
  console.error('\x1b[31m✗ .npmignore contains stale "tests/" exclusion; tests live under scripts/test-*.js\x1b[0m')
  process.exit(1)
}
console.log('\x1b[32m✓ Pack clean\x1b[0m')
