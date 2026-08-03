'use strict'

function parseWorkspaceInitArgs(argv = []) {
  const result = { tenantArgs: [], profileTarget: null, errors: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '')
    if (arg === '--profile') {
      const target = argv[index + 1]
      if (!target || String(target).startsWith('-')) result.errors.push('missing value for --profile')
      else if (result.profileTarget) result.errors.push('--profile may be provided only once')
      else {
        result.profileTarget = String(target)
        index += 1
      }
      continue
    }
    if (arg.startsWith('--profile=')) {
      const target = arg.slice('--profile='.length)
      if (!target) result.errors.push('missing value for --profile')
      else if (result.profileTarget) result.errors.push('--profile may be provided only once')
      else result.profileTarget = target
      continue
    }
    result.tenantArgs.push(arg)
  }
  return result
}

function operationFromArgs(argv) {
  const marker = (argv || []).find(arg => String(arg).startsWith('--operation='))
  return marker ? marker.slice('--operation='.length) : 'host-config'
}

module.exports = { operationFromArgs, parseWorkspaceInitArgs }
