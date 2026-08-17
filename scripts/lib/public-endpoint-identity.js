'use strict'

function normalizeText (value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function htmlTitle (html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return normalizeText(match?.[1])
}

function htmlVisibleText (html) {
  return normalizeText(String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'"))
}

function forbiddenMarkerPresent (marker, input) {
  const normalized = normalizeText(marker).toLowerCase()
  if (!normalized) return false
  if (normalized === '404') {
    return Number(input.status) === 404 || /\b404\s*(?:·|-|:|not found|page)/i.test(`${input.title} ${input.visibleText}`)
  }
  return `${input.title} ${input.visibleText}`.toLowerCase().includes(normalized)
}

function expectedUrlMatches (finalUrl, expectedIdentity) {
  let parsed
  try {
    parsed = new URL(finalUrl)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/'
  if (expectedIdentity === 'repository-fallback') {
    return host === 'github.com' && pathname.toLowerCase() === '/devcodex-labs/devcodex'
  }
  if (expectedIdentity === 'product-pages') {
    return host === 'devcodex-labs.github.io' && pathname.toLowerCase() === '/devcodex'
  }
  if (expectedIdentity === 'custom-domain') return host === 'devcodex.dev'
  return false
}

/**
 * Classifies an already observed HTTP response. Status 200 is necessary but never
 * sufficient: redirect target, product identity, and known error markers are checked.
 */
function classifyEndpointIdentity (input = {}) {
  const observedAt = input.observedAt || new Date().toISOString()
  if (input.error || input.status == null) {
    return {
      schemaVersion: 'EndpointIdentityEvidenceV1',
      requestedUrl: input.requestedUrl || null,
      finalUrl: input.finalUrl || null,
      status: input.status ?? null,
      title: normalizeText(input.title),
      expectedIdentity: input.expectedIdentity || null,
      observedAt,
      result: 'UNVERIFIED',
      violations: ['endpoint-observation-unavailable'],
      error: input.error ? String(input.error) : null
    }
  }

  const body = normalizeText(input.body)
  const title = normalizeText(input.title) || htmlTitle(input.body)
  const visibleText = htmlVisibleText(body)
  const haystack = `${title} ${visibleText}`.toLowerCase()
  const violations = []
  if (Number(input.status) !== 200) violations.push('endpoint-status-not-200')
  if (!expectedUrlMatches(input.finalUrl || input.requestedUrl, input.expectedIdentity)) {
    violations.push('endpoint-final-url-identity-mismatch')
  }
  const required = input.requiredBrandMarkers || []
  if (required.some(marker => !haystack.includes(String(marker).toLowerCase()))) {
    violations.push('endpoint-required-brand-missing')
  }
  const forbidden = input.forbiddenMarkers || []
  for (const marker of forbidden) {
    if (forbiddenMarkerPresent(marker, { status: input.status, title, visibleText })) {
      violations.push(`endpoint-forbidden-marker:${marker}`)
    }
  }
  if (!title) violations.push('endpoint-title-missing')
  return {
    schemaVersion: 'EndpointIdentityEvidenceV1',
    requestedUrl: input.requestedUrl || null,
    finalUrl: input.finalUrl || input.requestedUrl || null,
    status: Number(input.status),
    title,
    expectedIdentity: input.expectedIdentity || null,
    observedAt,
    result: violations.length ? 'BLOCK' : 'PASS',
    violations,
    error: null
  }
}

/**
 * Performs the explicit online part of endpoint verification. Callers own policy,
 * retries, and release gating; ordinary product projection never invokes the network.
 */
async function fetchEndpointIdentity (requestedUrl, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10000)
  try {
    const response = await (options.fetchImpl || fetch)(requestedUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'devcodex-endpoint-identity/1' }
    })
    const body = await response.text()
    return classifyEndpointIdentity({
      requestedUrl,
      finalUrl: response.url,
      status: response.status,
      body,
      expectedIdentity: options.expectedIdentity,
      requiredBrandMarkers: options.requiredBrandMarkers,
      forbiddenMarkers: options.forbiddenMarkers,
      observedAt: new Date().toISOString()
    })
  } catch (error) {
    return classifyEndpointIdentity({
      requestedUrl,
      expectedIdentity: options.expectedIdentity,
      observedAt: new Date().toISOString(),
      error: error?.message || String(error)
    })
  } finally {
    clearTimeout(timeout)
  }
}

module.exports = {
  classifyEndpointIdentity,
  expectedUrlMatches,
  fetchEndpointIdentity,
  htmlTitle,
  htmlVisibleText,
  forbiddenMarkerPresent,
  normalizeText
}
