'use strict'

const fs = require('fs')
const path = require('path')

const PACKAGE_NAMES = Object.freeze(['@vextjs/devcodex', 'devcodex'])

function readPackageName(packageRoot, fsImpl = fs, pathImpl = path) {
  try {
    const pkg = JSON.parse(fsImpl.readFileSync(pathImpl.join(packageRoot, 'package.json'), 'utf8'))
    return pkg && typeof pkg.name === 'string' ? pkg.name : null
  } catch {
    return null
  }
}

function isDevCodexPackageRoot(packageRoot, fsImpl = fs, pathImpl = path) {
  const name = readPackageName(packageRoot, fsImpl, pathImpl)
  return PACKAGE_NAMES.includes(name)
}

function isDevCodexSourceCheckout(packageRoot, fsImpl = fs, pathImpl = path) {
  const root = pathImpl.resolve(packageRoot || '.')
  return fsImpl.existsSync(pathImpl.join(root, '.git')) && isDevCodexPackageRoot(root, fsImpl, pathImpl)
}

/**
 * User-facing guidance for refreshing user-global host adapters.
 * Source checkout prefers R1a CLI; installed packages prefer npm -g lifecycle.
 */
function describeGlobalAdapterRefresh(options = {}) {
  const sourceCheckout = options.sourceCheckout === true
  const version = options.packageVersion ? String(options.packageVersion) : null
  const tarballHint = version
    ? `npm pack && npm install -g ./vextjs-devcodex-${version}.tgz`
    : 'npm pack && npm install -g ./vextjs-devcodex-<version>.tgz'

  if (sourceCheckout) {
    return Object.freeze({
      sourceCheckout: true,
      primary: 'devcodex global-adapters apply',
      secondary: `npm install -g .  # or: ${tarballHint}`,
      installCommand: 'devcodex global-adapters apply',
      updateCommand: 'devcodex global-adapters apply',
      nextStepRefresh:
        'Run `devcodex global-adapters apply` to refresh user-level host adapters from this source checkout (or `npm install -g .` / pack+tarball).',
      nextStepInstall:
        'Run `devcodex global-adapters apply` from the DevCodex source package root, or `npm install -g .` / pack+tarball.',
      nextStepShort: 'devcodex global-adapters apply',
      recommendedEntry: 'devcodex global-adapters apply --dry-run && devcodex global-adapters apply',
      doctorHint:
        'Refresh from source with `devcodex global-adapters apply` (or `npm install -g .` / pack+tarball) before judging installed health against this candidate.',
      tarballHint
    })
  }

  return Object.freeze({
    sourceCheckout: false,
    primary: 'npm update -g devcodex',
    secondary: null,
    installCommand: 'npm install -g devcodex',
    updateCommand: 'npm update -g devcodex',
    nextStepRefresh: 'Run npm update -g devcodex to refresh the managed receipt.',
    nextStepInstall: 'Run npm install -g devcodex to create the user-global host receipt.',
    nextStepShort: 'npm update -g devcodex',
    recommendedEntry: 'npm update -g devcodex && devcodex doctor --json',
    doctorHint: 'Upgrade DevCodex and refresh adapters with `npm update -g devcodex`.',
    tarballHint
  })
}

function describeGlobalAdapterRefreshForPackageRoot(packageRoot, options = {}) {
  const fsImpl = options.fs || fs
  const pathImpl = options.path || path
  const root = pathImpl.resolve(packageRoot || pathImpl.join(__dirname, '..', '..'))
  return describeGlobalAdapterRefresh({
    sourceCheckout: isDevCodexSourceCheckout(root, fsImpl, pathImpl),
    packageVersion: options.packageVersion || null
  })
}

module.exports = {
  PACKAGE_NAMES,
  describeGlobalAdapterRefresh,
  describeGlobalAdapterRefreshForPackageRoot,
  isDevCodexPackageRoot,
  isDevCodexSourceCheckout,
  readPackageName
}
