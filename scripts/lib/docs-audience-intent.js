'use strict'

// Prose is interpreted by the model. This adapter checks only the identity and
// shape of its review; the presence of a word or a quoted example proves nothing.
const crypto = require('crypto')
function reviewConclusion(body, review, kind, allowed) {
  const digest = crypto.createHash('sha256').update(String(body || '')).digest('hex')
  if (!review || review.schemaVersion !== 'DocsContentReviewV1' || review.kind !== kind ||
      review.contentDigest !== digest || !allowed.includes(review.conclusion) ||
      typeof review.rationale !== 'string' || !review.rationale.trim() ||
      !Array.isArray(review.evidenceRefs) || !review.evidenceRefs.length ||
      review.evidenceRefs.some(ref => typeof ref !== 'string' || !ref.trim())) return 'unverified'
  return review.conclusion
}


/**
 * DocsAudienceIntentGate classifiers (CP1/CP2: 文档受众双 Skill 分流).
 * Portable pure functions — no I/O.
 */

/**
 * @typedef {'public-user'|'maintainer-dev'|'ambiguous'|'multi-audience'} DocsAudience
 * @typedef {'guide'|'readme'|'reference'|'migration'|'changelog'|'operations'|'maintainer'|'other'} DocsSurface
 */

/**
 * @param {{schemaVersion: 'DocsAudienceDecisionV1', docsAudience: DocsAudience,
 *   docsSurface: DocsSurface, basis: string, recommendedAudience?: string,
 *   recommendedLabel?: string}} input Model-owned audience decision.
 * @returns {{
 *   docsAudience: DocsAudience|null,
 *   docsSurface: DocsSurface|null,
 *   recommendedAudience: 'public-user'|'maintainer-dev'|null,
 *   recommendedLabel: string|null,
 *   signals: string[],
 *   status: 'ok'|'ambiguous'|'multi-audience'|'decision-pending',
 *   failClosed: boolean
 * }}
 */
function classifyDocsAudienceSample(input) {
  const allowedAudience = ['public-user', 'maintainer-dev', 'ambiguous', 'multi-audience']
  const allowedSurface = ['guide', 'readme', 'reference', 'maintainer', 'migration', 'changelog', 'operations', 'other']
  if (!input || typeof input !== 'object' || input.schemaVersion !== 'DocsAudienceDecisionV1' ||
      !allowedAudience.includes(input.docsAudience) || !allowedSurface.includes(input.docsSurface) ||
      typeof input.basis !== 'string' || !input.basis.trim()) {
    return { docsAudience: null, docsSurface: null, recommendedAudience: null, recommendedLabel: null,
      signals: [], status: 'decision-pending', failClosed: false, semanticOwner: 'model' }
  }
  return { docsAudience: input.docsAudience, docsSurface: input.docsSurface,
    recommendedAudience: input.recommendedAudience || null, recommendedLabel: input.recommendedLabel || null,
    signals: ['model-semantic-decision'],
    status: ['ambiguous', 'multi-audience'].includes(input.docsAudience) ? input.docsAudience : 'ok',
    failClosed: false, semanticOwner: 'model', basis: input.basis }
}

/**
 * Detect audience drift in drafted doc body for a locked audience.
 * @param {'public-user'|'maintainer-dev'} audience
 * @param {string} body
 * @param {object} review Content-bound DocsContentReviewV1 with matching audience.
 * @returns {'ok'|'drift-maintainer-on-user'|'drift-no-dev-path'|'not-applicable'|'unverified'}
 */
function classifyDocsAudienceDriftSample(audience, body, review) {
  if (review?.audience !== audience) return 'unverified'
  return reviewConclusion(body, review, 'audience-drift',
    ['ok', 'drift-maintainer-on-user', 'drift-no-dev-path', 'not-applicable'])
}

/**
 * @param {string} disambiguationText assistant text when status=ambiguous
 * @param {object} review Content-bound DocsContentReviewV1.
 * @returns {'ok'|'missing-recommendation'|'preference-menu'|'not-applicable'|'unverified'}
 */
function classifyDocsAudienceDisambiguationSample(disambiguationText, review) {
  return reviewConclusion(disambiguationText, review, 'audience-disambiguation',
    ['ok', 'missing-recommendation', 'preference-menu', 'not-applicable'])
}

/**
 * Cognitive altitude for public-user guide/readme bodies.
 * Projects a content-bound model review of guide readability.
 *
 * @param {string} body markdown or free text
 * @param {{review?: object}} [opts] Content-bound DocsContentReviewV1.
 * @returns {'ok'|'function-inventory-as-guide'|'concept-dump-no-task'|'ok-reference-dense'|'not-applicable'|'unverified'}
 */
function classifyUserDocsCognitiveAltitudeSample(body, opts = {}) {
  return reviewConclusion(body, opts.review, 'cognitive-altitude',
    ['ok', 'function-inventory-as-guide', 'concept-dump-no-task', 'ok-reference-dense', 'not-applicable'])
}

/**
 * Whether an assistant reply proactively extended scenarios after a user pain point.
 * @param {string} userMessage
 * @param {string} assistantReply
 * @param {object} review DocsContentReviewV1 bound to the request/reply pair.
 * @returns {'ok'|'missing-extension'|'not-applicable'|'unverified'}
 */
function classifyProactiveScenarioExtensionSample(userMessage, assistantReply, review) {
  return reviewConclusion(JSON.stringify([userMessage, assistantReply]), review, 'scenario-extension',
    ['ok', 'missing-extension', 'not-applicable'])
}

module.exports = {
  classifyDocsAudienceSample,
  classifyDocsAudienceDriftSample,
  classifyDocsAudienceDisambiguationSample,
  classifyUserDocsCognitiveAltitudeSample,
  classifyProactiveScenarioExtensionSample
}
