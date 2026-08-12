'use strict'

const GROK_CURSOR_HOOKS_ENV = 'GROK_CURSOR_HOOKS_ENABLED'

function buildGrokCliEnv (baseEnv = process.env) {
  return {
    ...baseEnv,
    [GROK_CURSOR_HOOKS_ENV]: 'false'
  }
}

module.exports = {
  GROK_CURSOR_HOOKS_ENV,
  buildGrokCliEnv
}
