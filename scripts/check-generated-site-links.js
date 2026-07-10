#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULT_ROOT = path.resolve(__dirname, '..', 'website', 'dist')
const DEFAULT_BASE = '/devcodex/'

function walkHtmlFiles(rootDir) {
  const files = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(target)
      else if (entry.isFile() && entry.name.endsWith('.html')) files.push(target)
    }
  }
  visit(rootDir)
  return files
}

function normalizeBase(base) {
  const withLeadingSlash = base.startsWith('/') ? base : `/${base}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

function targetCandidates(target) {
  return path.extname(target)
    ? [target]
    : [target, `${target}.html`, path.join(target, 'index.html')]
}

/**
 * Resolve only links owned by the generated site. External protocols, fragments and
 * absolute routes outside the configured base belong to another consumer.
 */
function resolveOwnedTarget(rawValue, sourceFile, rootDir, base) {
  if (!rawValue || /^(?:[a-z]+:|#|\/\/|data:|mailto:|tel:)/i.test(rawValue)) return null

  const value = rawValue.split(/[?#]/)[0]
  if (!value) return null

  const normalizedBase = normalizeBase(base)
  const baseWithoutTrailingSlash = normalizedBase.slice(0, -1)
  if (value === baseWithoutTrailingSlash || value === normalizedBase) {
    return path.join(rootDir, 'index.html')
  }
  if (value.startsWith(normalizedBase)) {
    return path.join(rootDir, value.slice(normalizedBase.length))
  }
  if (value.startsWith('/')) return null
  return path.resolve(path.dirname(sourceFile), value)
}

function scanGeneratedSite({ rootDir = DEFAULT_ROOT, base = DEFAULT_BASE } = {}) {
  const absoluteRoot = path.resolve(rootDir)
  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
    throw new Error(`Generated site root does not exist: ${absoluteRoot}`)
  }

  const htmlFiles = walkHtmlFiles(absoluteRoot)
  const missing = []
  for (const sourceFile of htmlFiles) {
    const html = fs.readFileSync(sourceFile, 'utf8')
    for (const tagMatch of html.matchAll(/<(?:a|link|script|img)\b[^>]*>/gi)) {
      const attributeMatch = tagMatch[0].match(/\b(?:href|src)=["']([^"']+)["']/i)
      if (!attributeMatch) continue

      const rawValue = attributeMatch[1]
      const target = resolveOwnedTarget(rawValue, sourceFile, absoluteRoot, base)
      if (!target || targetCandidates(target).some(candidate => fs.existsSync(candidate))) continue

      missing.push({
        source: path.relative(absoluteRoot, sourceFile).replaceAll('\\', '/'),
        href: rawValue,
        target: path.relative(absoluteRoot, target).replaceAll('\\', '/'),
      })
    }
  }

  const deduped = [...new Map(missing.map(item => [`${item.source}|${item.href}`, item])).values()]
  return {
    rootDir: absoluteRoot,
    base: normalizeBase(base),
    htmlCount: htmlFiles.length,
    missing: deduped,
    uniqueTargets: [...new Set(deduped.map(item => item.target))],
  }
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') options.rootDir = argv[++index]
    else if (argv[index] === '--base') options.base = argv[++index]
    else throw new Error(`Unknown argument: ${argv[index]}`)
  }
  return options
}

function main() {
  try {
    const result = scanGeneratedSite(parseArgs(process.argv.slice(2)))
    console.log(`Generated site links: html=${result.htmlCount} missing=${result.missing.length} uniqueTargets=${result.uniqueTargets.length}`)
    for (const item of result.missing) {
      console.error(`MISSING ${item.source} -> ${item.href} (${item.target})`)
    }
    process.exitCode = result.missing.length > 0 ? 2 : 0
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = { normalizeBase, resolveOwnedTarget, scanGeneratedSite, targetCandidates }
