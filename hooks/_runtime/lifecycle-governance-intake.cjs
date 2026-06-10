'use strict'

function buildLifecycleGovernanceIntakeUtils() {
  const CANDIDATE_PATTERNS = [
    /记录一下|记一下|登记|落账|写入台账/,
    /规范要优化|规范.*(?:缺失|不完整|过窄|冲突)|流程.*(?:缺失|不完整|有问题)/,
    /以后(?:应该|要)|后续(?:应该|要)|下次(?:应该|要)/,
    /你(?:刚才)?(?:漏了|错了|误判|违反流程)(?:.*(?:记录|登记|流程|规范|台账|回写))?/,
    /你(?:刚才)?(?:没有|没).*?(?:记录|登记|流程|规范|台账|回写|治理|合规)/,
    /用户(?:建议|纠偏|纠正)|合理建议|主动记录|不会主动记录/
  ]

  const RECORD_INTENT_RE = /record\.(?:violation|spec-defect|process-improvement|pending-issue|audit-gap|ambiguous)/
  const RECORD_NONE_RE = /record\.none/
  const LEDGER_TARGET_RE = /目标台账\s*[:：]|data\/(?:violations|pending-fixes|process-improvements|pending-issues|gap-registry)\.md|已记录\s*(?:PI|PF|VL|GR|ISSUE)-\d{3}/i
  const CONFIDENCE_RE = /置信度\s*[:：]\s*(?:高|中|低)/
  const BASIS_RE = /依据\s*[:：]/
  const SKIP_REASON_RE = /skipReason|跳过理由|不写台账|无需记录|无需写入台账/

  function emptyGovernanceIntakeState() {
    return {
      governanceIntakeCandidate: false,
      pending: false,
      handled: false,
      candidateType: '',
      reason: '',
      promptPreview: '',
      createdAt: '',
      handledAt: '',
      handledBy: ''
    }
  }

  function buildGovernanceIntakeCandidate(prompt) {
    const text = String(prompt || '').trim()
    const state = emptyGovernanceIntakeState()
    if (!text) return state
    const matched = CANDIDATE_PATTERNS.find(pattern => pattern.test(text))
    if (!matched) return state
    const questionLike = /[?？]\s*$|(?:怎么|如何|为什么|是否|是不是|能不能|可以吗|吗[？?]?)/.test(text)
    const explicitCorrectionLike = /漏了|错了|误判|违反流程|纠偏|纠正|不会主动记录/.test(text)
    const governanceTargetLike = /记录|登记|流程|规范|台账|回写|治理|合规|RecordRouter|Improvement Intake/i.test(text)
    if (questionLike && !(explicitCorrectionLike || governanceTargetLike)) return state
    const correctionLike = /漏了|错了|误判|违反流程|纠偏|纠正|不会主动记录|没有.*记录|没.*记录/.test(text)
    const recordLike = /记录一下|记一下|登记|落账|写入台账/.test(text)
    return {
      governanceIntakeCandidate: true,
      pending: true,
      handled: false,
      candidateType: correctionLike ? 'user-correction' : (recordLike ? 'record-request' : 'process-improvement'),
      reason: correctionLike
        ? 'user correction or process miss candidate'
        : (recordLike ? 'explicit record request candidate' : 'process improvement candidate'),
      promptPreview: text.replace(/\s+/g, ' ').slice(0, 160),
      createdAt: new Date().toISOString(),
      handledAt: '',
      handledBy: ''
    }
  }

  function visibleReplyResolvesGovernanceIntake(text) {
    const content = String(text || '')
    return requiresCoupledRecordRouterEvidence(content)
  }

  function requiresCoupledRecordRouterEvidence(content) {
    const text = String(content || '')
    const hasIntentLabel = /规范化意图\s*[:：]/.test(text)
    if (hasIntentLabel && RECORD_NONE_RE.test(text)) return SKIP_REASON_RE.test(text)
    if (hasIntentLabel && RECORD_INTENT_RE.test(text)) {
      return CONFIDENCE_RE.test(text) && BASIS_RE.test(text) && LEDGER_TARGET_RE.test(text)
    }
    return false
  }

  function updateGovernanceIntakeResolutionState(state, text, eventName) {
    if (!state?.governanceIntake?.pending || state.governanceIntake.handled) return
    if (!visibleReplyResolvesGovernanceIntake(text)) return
    state.governanceIntake.pending = false
    state.governanceIntake.handled = true
    state.governanceIntake.handledAt = new Date().toISOString()
    state.governanceIntake.handledBy = eventName || 'visible-reply'
  }

  function hasUnresolvedGovernanceIntakeCandidate(state) {
    return !!(state?.governanceIntake?.pending && !state.governanceIntake.handled)
  }

  function buildGovernanceIntakeReminderItem(state) {
    if (!hasUnresolvedGovernanceIntakeCandidate(state)) return ''
    return '治理 intake 候选尚未分流（C17/spec-governance：需输出规范化意图、置信度、依据、目标台账并写入台账，或说明 record.none + skipReason）'
  }

  return {
    emptyGovernanceIntakeState,
    buildGovernanceIntakeCandidate,
    requiresCoupledRecordRouterEvidence,
    visibleReplyResolvesGovernanceIntake,
    updateGovernanceIntakeResolutionState,
    hasUnresolvedGovernanceIntakeCandidate,
    buildGovernanceIntakeReminderItem
  }
}

module.exports = { buildLifecycleGovernanceIntakeUtils }
