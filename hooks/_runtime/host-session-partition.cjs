'use strict'

// Per-session lifecycle partition for driver-synthesized hosts (Grok Bot).
//
// Native hosts own one lifecycle state per project namespace. Grok Bot runs many
// conversations against the same workspace through one pair of long-lived
// connectors, so its lifecycle/recovery/admission/route state is keyed by the
// conversation's host session id: .memory/hooks/<partition>/.sessions/<id>/.
// Every other host keeps the unchanged per-project partition.

const DRIVER_SESSION_HOST_VARIANT = 'grok-bot/driver-synthesized-local-stdio'
const DRIVER_SESSION_AGENT = 'grok-bot'
const SESSION_SEGMENT = '.sessions'
const DEFAULT_DRIVER_SESSION_ID = 'grok-bot-session'
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function isDriverSessionHost(env = process.env) {
  return env.DEVCODEX_HOST_VARIANT === DRIVER_SESSION_HOST_VARIANT ||
    String(env.DEVCODEX_AGENT || '').trim().toLowerCase() === DRIVER_SESSION_AGENT
}

function isValidHostSessionId(value) {
  return typeof value === 'string' && SESSION_ID_RE.test(value) && !/^\.+$/.test(value)
}

// Path segments appended below .memory/hooks/<partition> for the current process session.
function hostSessionPartitionSegments(env = process.env) {
  if (!isDriverSessionHost(env)) return []
  const sessionId = String(env.DEVCODEX_HOST_SESSION_ID || '').trim() || DEFAULT_DRIVER_SESSION_ID
  if (!isValidHostSessionId(sessionId)) {
    const error = new Error('driver-synthesized hosts require a valid DEVCODEX_HOST_SESSION_ID ([A-Za-z0-9._-], max 64)')
    error.code = 'HOST_SESSION_ID_INVALID'
    throw error
  }
  return [SESSION_SEGMENT, sessionId]
}

function hostSessionError(message) {
  return {
    content: [{ type: 'text', text: `Error: HOST_SESSION_INVALID: ${message}` }],
    structuredContent: { schemaVersion: 'MemoryWriterErrorV1', errorCode: 'HOST_SESSION_INVALID', message, nextStep: 'Pass the same hostSession that devcodex grok-bot turn-begin returned as sessionId.' },
    isError: true
  }
}

// A ContextReadBinding is minted for one session's context epoch. Reject a call whose
// binding belongs to another session (its epoch is not this session's current epoch).
function bindingSessionMismatch(args, sessionId) {
  const binding = args && args.contextBinding
  if (!binding || typeof binding !== 'object' || !binding.contextEpoch || !binding.activeRoot || !binding.project) return null
  const fs = require('fs')
  const path = require('path')
  const statePath = path.join(String(binding.activeRoot), '.memory', 'hooks', String(binding.project), SESSION_SEGMENT, sessionId, 'lifecycle-state.json')
  let epoch = null
  try {
    epoch = JSON.parse(fs.readFileSync(statePath, 'utf8'))?.contextAcquisition?.contextEpoch || null
  } catch {
    return `session ${sessionId} has no lifecycle state for this contextBinding`
  }
  return epoch === binding.contextEpoch ? null : `contextBinding epoch ${binding.contextEpoch} does not belong to session ${sessionId}`
}

const HOST_SESSION_PROPERTY = Object.freeze({ type: 'string', description: 'Grok Bot conversation session id (from turn-begin sessionId)' })

// Per-call session identity for driver-host connectors. Requests are served one at a
// time by the JSON-line transport queue, so the session id is scoped to exactly one
// call: tools/call may carry `hostSession`, which selects that session's partition for
// the call and is restored afterwards. tools/list advertises the optional field.
function wrapDispatchWithHostSession(dispatch, env = process.env) {
  if (!isDriverSessionHost(env)) return dispatch
  return function hostSessionDispatch(method, params) {
    if (method === 'tools/list') {
      const listed = dispatch(method, params)
      const decorate = page => page && Array.isArray(page.tools)
        ? { ...page, tools: page.tools.map(tool => ({ ...tool, inputSchema: { ...tool.inputSchema, properties: { ...(tool.inputSchema?.properties || {}), hostSession: HOST_SESSION_PROPERTY } } })) }
        : page
      return listed && typeof listed.then === 'function' ? listed.then(decorate) : decorate(listed)
    }
    const args = params?.arguments
    if (method !== 'tools/call' || !args || typeof args !== 'object' || !Object.prototype.hasOwnProperty.call(args, 'hostSession')) {
      return dispatch(method, params)
    }
    const sessionId = args.hostSession
    if (!isValidHostSessionId(sessionId)) return hostSessionError('hostSession must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}')
    const mismatch = bindingSessionMismatch(args, sessionId)
    if (mismatch) return hostSessionError(mismatch)
    const rest = { ...args }
    delete rest.hostSession
    const previous = env.DEVCODEX_HOST_SESSION_ID
    env.DEVCODEX_HOST_SESSION_ID = sessionId
    const restore = () => {
      if (previous === undefined) delete env.DEVCODEX_HOST_SESSION_ID
      else env.DEVCODEX_HOST_SESSION_ID = previous
    }
    let result
    try {
      result = dispatch(method, { ...params, arguments: rest })
    } catch (error) {
      restore()
      throw error
    }
    if (result && typeof result.then === 'function') return result.finally(restore)
    restore()
    return result
  }
}

module.exports = {
  DRIVER_SESSION_HOST_VARIANT,
  SESSION_SEGMENT,
  isDriverSessionHost,
  isValidHostSessionId,
  hostSessionPartitionSegments,
  wrapDispatchWithHostSession
}
