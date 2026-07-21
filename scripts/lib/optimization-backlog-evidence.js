'use strict'

/**
 * PF-168 / PF-169 / PF-170 — evidence honesty for optimization backlog,
 * analysis artifact delivery, and residual optimization lists.
 */

const EVIDENCE_GRADE = /证据等级|evidence\s*grade|证据档|A\s*\/\s*B\s*\/\s*C|[（(][ABC][）)]|\b[ABC]\s*级/i
const REPRO_CMD = /可复现|npm run|node scripts\/|exitCode|验证命令|command:/i
const UNVERIFIED = /待验证|UNVERIFIED|未验证|⚠️/i
const MUST_OPTIMIZE = /必须优化|必须改|完整优化清单|全部必须/i
const RESIDUAL = /残留|仍可优化|还可以优化|residual/i
const BENEFIT = /预期收益|收益|impact|影响风险|风险|前置条件/i
const REPORT_LINK = /reports\/|详细报告|\[.+\]\([^)]+\.md\)/i
const ANALYSIS_CLAIM = /审阅|分析完成|方案合理|技术方案分析|完成分析/i

/**
 * @param {string} sample
 * @returns {'ready'|'thin'|'not-optimization-backlog'}
 */
function classifyOptimizationBacklogEvidenceSample(sample) {
  const text = String(sample || '')
  const isBacklog = /优化清单|优化需求|优化问题|必须优化|问题清单|OptimizationBacklog|证据矩阵|EvidenceMatrix|证据等级/i.test(text) ||
    (MUST_OPTIMIZE.test(text) && /问题|finding|建议/i.test(text))
  if (!isBacklog) return 'not-optimization-backlog'

  const hasGrade = EVIDENCE_GRADE.test(text)
  const hasRepro = REPRO_CMD.test(text)
  const hasUnverified = UNVERIFIED.test(text)
  const claimsMustAll = MUST_OPTIMIZE.test(text) && !hasUnverified && !hasGrade

  if (claimsMustAll && (!hasGrade || !hasRepro)) return 'thin'
  if (hasGrade && hasRepro) return 'ready'
  if (hasGrade && hasUnverified) return 'ready'
  return 'thin'
}

/**
 * @param {string} sample
 * @returns {'ready'|'chat-only'|'not-analysis-delivery'}
 */
function classifyAnalysisArtifactDeliverySample(sample) {
  const text = String(sample || '')
  if (!ANALYSIS_CLAIM.test(text) && !/analyze|audit 结论|方案对比/i.test(text)) {
    return 'not-analysis-delivery'
  }
  if (REPORT_LINK.test(text) || /reports\/analysis|reports\/audit/i.test(text)) return 'ready'
  // Long analysis body without report path
  if (text.length > 400 && !REPORT_LINK.test(text)) return 'chat-only'
  if (ANALYSIS_CLAIM.test(text) && !REPORT_LINK.test(text)) return 'chat-only'
  return 'ready'
}

/**
 * @param {string} sample
 * @returns {'ready'|'thin'|'not-residual-list'}
 */
function classifyResidualOptimizationListSample(sample) {
  const text = String(sample || '')
  if (!RESIDUAL.test(text) && !/仍可优化|还可以优化/i.test(text)) return 'not-residual-list'
  const hasGrade = EVIDENCE_GRADE.test(text)
  const hasBenefit = BENEFIT.test(text)
  const hasUnverified = UNVERIFIED.test(text)
  if (hasGrade && hasBenefit) return 'ready'
  if (hasGrade && hasUnverified && hasBenefit) return 'ready'
  return 'thin'
}

function buildEvidenceFamilyReceipt(sample) {
  return {
    schemaVersion: 'OptimizationEvidenceFamilyReceiptV1',
    backlog: classifyOptimizationBacklogEvidenceSample(sample),
    analysisDelivery: classifyAnalysisArtifactDeliverySample(sample),
    residualList: classifyResidualOptimizationListSample(sample)
  }
}

module.exports = {
  classifyOptimizationBacklogEvidenceSample,
  classifyAnalysisArtifactDeliverySample,
  classifyResidualOptimizationListSample,
  buildEvidenceFamilyReceipt
}
