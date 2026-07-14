#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'))
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')

const errors = []

function expect(condition, message) {
  if (!condition) errors.push(message)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function readUrl(field) {
  if (typeof field === 'string') return field
  if (field && typeof field === 'object' && typeof field.url === 'string') return field.url
  return ''
}

const keywords = Array.isArray(pkg.keywords)
  ? pkg.keywords.filter(item => nonEmptyString(item))
  : []
const files = Array.isArray(pkg.files)
  ? pkg.files.filter(item => nonEmptyString(item))
  : []
const pluginKeywords = Array.isArray(plugin.keywords)
  ? plugin.keywords.filter(item => nonEmptyString(item))
  : []
const pluginCategories = Array.isArray(plugin.categories)
  ? plugin.categories.filter(item => nonEmptyString(item))
  : []

expect(nonEmptyString(pkg.name), 'package.json name 不能为空')
expect(nonEmptyString(pkg.version), 'package.json version 不能为空')
expect(nonEmptyString(pkg.description), 'package.json description 不能为空')
expect(keywords.length >= 3, 'package.json keywords 至少需要 3 个非空条目')
expect(nonEmptyString(pkg.license), 'package.json license 不能为空')
expect(nonEmptyString(readUrl(pkg.repository)), 'package.json repository.url 不能为空')
expect(nonEmptyString(readUrl(pkg.bugs)), 'package.json bugs.url 不能为空')
expect(nonEmptyString(pkg.homepage), 'package.json homepage 不能为空')
expect(nonEmptyString(pkg.engines && pkg.engines.node), 'package.json engines.node 不能为空')
expect(nonEmptyString(pkg.publishConfig && pkg.publishConfig.registry), 'package.json publishConfig.registry 不能为空')
expect(nonEmptyString(pkg.publishConfig && pkg.publishConfig.access), 'package.json publishConfig.access 不能为空')
expect(files.length > 0, 'package.json files 不能为空')
expect(
  nonEmptyString(pkg.main) ||
  (pkg.exports && Object.keys(pkg.exports).length > 0) ||
  (pkg.bin && Object.keys(pkg.bin).length > 0),
  'package.json 至少需要 main / exports / bin 之一'
)

expect(nonEmptyString(plugin.version), 'plugin.json version 不能为空')
expect(plugin.version === pkg.version, 'plugin.json version 必须与 package.json version 一致')
expect(nonEmptyString(plugin.description), 'plugin.json description 不能为空')
expect(nonEmptyString(plugin.repository), 'plugin.json repository 不能为空')
expect(nonEmptyString(plugin.homepage), 'plugin.json homepage 不能为空')
expect(nonEmptyString(plugin.license), 'plugin.json license 不能为空')
expect(pluginKeywords.length >= 3, 'plugin.json keywords 至少需要 3 个非空条目')
expect(pluginCategories.length > 0, 'plugin.json categories 不能为空')

if ((pkg.publishConfig.registry || '').includes('npm.pkg.github.com') || pkg.publishConfig.access === 'restricted') {
  for (const needle of ['GitHub Packages', 'npm.pkg.github.com', 'NODE_AUTH_TOKEN', `v${pkg.version}`, '当前唯一发布通道']) {
    expect(readme.includes(needle), `README 必须显式说明 GitHub Packages 安装边界：${needle}`)
  }
  expect(!readme.includes(`npmjs public | ✅ v${pkg.version} 已发布`), 'README 不得把 GitHub-only 版本伪报为 npmjs 已发布')
}

if ((pkg.publishConfig.registry || '').includes('registry.npmjs.org') || pkg.publishConfig.access === 'public') {
  for (const needle of ['npmjs public', `v${pkg.version}`, '默认公开安装通道', 'GitHub Packages', '镜像通道']) {
    expect(readme.includes(needle), `README 必须说明 npmjs public 主通道与 GitHub Packages 镜像：${needle}`)
  }
  expect(!readme.includes('npmjs public 尚处于下一版本候选'), 'README 不得把已发布 npmjs public 通道继续描述为下一版本候选')
}

if (errors.length) {
  console.error('\x1b[31m✗ Release metadata checks failed:\x1b[0m')
  for (const message of errors) {
    console.error(`  - ${message}`)
  }
  process.exit(1)
}

console.log('\x1b[32m✓ Release metadata checks passed\x1b[0m')
