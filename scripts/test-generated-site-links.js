#!/usr/bin/env node

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { scanGeneratedSite } = require('./check-generated-site-links')

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-generated-links-'))

try {
  fs.mkdirSync(path.join(rootDir, 'guide'), { recursive: true })
  fs.mkdirSync(path.join(rootDir, 'static'), { recursive: true })
  fs.writeFileSync(path.join(rootDir, 'guide', 'index.html'), '<p>guide</p>')
  fs.writeFileSync(path.join(rootDir, 'static', 'app.js'), 'void 0')
  fs.writeFileSync(
    path.join(rootDir, 'index.html'),
    '<a href="/devcodex/guide/">guide</a><script src="/devcodex/static/app.js"></script><a href="https://example.com">external</a>',
  )

  const healthy = scanGeneratedSite({ rootDir, base: '/devcodex/' })
  assert.strictEqual(healthy.htmlCount, 2)
  assert.deepStrictEqual(healthy.missing, [])

  fs.writeFileSync(path.join(rootDir, 'index.html'), '<a href="/devcodex/missing/">broken</a>')
  const broken = scanGeneratedSite({ rootDir, base: '/devcodex/' })
  assert.strictEqual(broken.missing.length, 1)
  assert.strictEqual(broken.missing[0].target, 'missing')
  assert.deepStrictEqual(broken.uniqueTargets, ['missing'])

  console.log('Generated site link checker tests passed')
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true })
}
