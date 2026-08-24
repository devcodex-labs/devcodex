'use strict'

const NARRATIVE_MARKDOWN_EXCLUSIONS = Object.freeze([
  'README.md',
  'public-site/**/*.md',
  'website/**/*.md'
])

function normalizeNarrativePath(value) {
  const normalized = String(value || '').normalize('NFKC').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  const segments = normalized.split('/')
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) ||
      segments.some(segment => !segment || segment === '.' || segment === '..')) {
    const error = new Error('narrative Markdown paths must stay relative to the repository root')
    error.code = 'NARRATIVE_MARKDOWN_PATH_INVALID'
    throw error
  }
  return normalized
}

function isNarrativeMarkdownPath(value) {
  const normalized = normalizeNarrativePath(value).toLowerCase()
  return normalized === 'readme.md' || /^(?:public-site|website)\/.+\.md$/.test(normalized)
}

function partitionNarrativeMarkdownPaths(values = []) {
  const recognizedNoJsInputs = []
  const executableInputs = []
  for (const value of values) {
    const normalized = normalizeNarrativePath(value)
    if (isNarrativeMarkdownPath(normalized)) recognizedNoJsInputs.push(normalized)
    else executableInputs.push(normalized)
  }
  return {
    recognizedNoJsInputs: [...new Set(recognizedNoJsInputs)].sort(),
    executableInputs: [...new Set(executableInputs)].sort()
  }
}

function filterExecutableValidationProbes(probes = []) {
  return probes.filter(probe => {
    const candidate = typeof probe === 'string'
      ? probe
      : (Array.isArray(probe) ? probe[0] : probe?.file)
    if (!candidate) return true
    try {
      return !isNarrativeMarkdownPath(candidate)
    } catch {
      return true
    }
  })
}

function assertNarrativeMarkdownPolicy(patterns) {
  const actual = Array.isArray(patterns) ? patterns.map(String) : []
  if (JSON.stringify(actual) !== JSON.stringify(NARRATIVE_MARKDOWN_EXCLUSIONS)) {
    const error = new Error('narrativeMarkdownExclusions must exactly match NarrativeMarkdownPolicyV1')
    error.code = 'NARRATIVE_MARKDOWN_POLICY_INVALID'
    error.details = {
      expected: [...NARRATIVE_MARKDOWN_EXCLUSIONS],
      actual
    }
    throw error
  }
  return true
}

module.exports = {
  NARRATIVE_MARKDOWN_EXCLUSIONS,
  assertNarrativeMarkdownPolicy,
  filterExecutableValidationProbes,
  isNarrativeMarkdownPath,
  normalizeNarrativePath,
  partitionNarrativeMarkdownPaths
}
