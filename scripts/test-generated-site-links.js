#!/usr/bin/env node

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { scanGeneratedSite } = require('./check-generated-site-links')
const { main: checkGeneratedSiteLinksIfPresent } = require('./check-generated-site-links-if-present')
const {
  WEBSITE_COMMAND_TIMEOUT_MS,
  assertSiteInstallIsolation,
  main: runWebsiteBuildIfPresent
} = require('./run-website-build-if-present')

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-generated-links-'))
const cleanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-generated-links-clean-'))
const unsafeSiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-generated-links-unsafe-'))

try {
  assert.strictEqual(WEBSITE_COMMAND_TIMEOUT_MS, 600000)
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

  assert.strictEqual(runWebsiteBuildIfPresent({ root: cleanRoot }), 0)
  assert.strictEqual(checkGeneratedSiteLinksIfPresent({ root: cleanRoot }), 0)

  fs.mkdirSync(path.join(unsafeSiteRoot, 'public-site'), { recursive: true })
  fs.writeFileSync(path.join(unsafeSiteRoot, 'public-site', 'package.json'), JSON.stringify({
    name: 'unsafe-site',
    private: true,
    dependencies: { devcodex: 'file:..' }
  }))
  assert.throws(
    () => assertSiteInstallIsolation(unsafeSiteRoot, { id: 'public-site' }),
    error => error?.code === 'WEBSITE_EXTERNAL_LOCAL_LINK_FORBIDDEN'
  )
  assert.doesNotThrow(() => assertSiteInstallIsolation(path.resolve(__dirname, '..'), { id: 'public-site' }))

  console.log('Generated site link checker tests passed')
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true })
  fs.rmSync(cleanRoot, { recursive: true, force: true })
  fs.rmSync(unsafeSiteRoot, { recursive: true, force: true })
}
