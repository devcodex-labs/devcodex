'use strict'

function buildLifecycleVisibleReplyUtils(ctx) {
  const {
    fs,
    getStatePaths,
    getVisibleReplyEvidence,
    collectInterestingStrings,
    buildGovernanceIntakeReminderItem
  } = ctx

  function hasVisibleReplyPayload(payload) {
    return getVisibleReplyEvidence(payload).observed
  }

  function hasArtifactPathOutput(text) {
    return analyzeArtifactDelivery(text).status === 'verified-present'
  }

  /**
   * Classify final-surface artifact evidence without inferring content that the host did not expose.
   * @param {string} text visible assistant reply
   * @returns {{status: string, missingItems: string[], linkCount: number}}
   */
  function analyzeArtifactDelivery(text) {
    const lines = String(text || '').split(/\r?\n/)
    let inArtifactSection = false
    let sectionFound = false
    let primaryLabel = false
    let linkCount = 0
    let absolutePathEvidence = false
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      if (/^\s*📂\s*本次会话产物[:：]?\s*$/.test(line)) {
        inArtifactSection = true
        sectionFound = true
        continue
      }
      if (!inArtifactSection) continue
      if (/^#{1,6}\s+/.test(line)) break
      if (/主要产物|primary artifacts?/i.test(line)) primaryLabel = true
      if (!/^\s*-\s*\[[^\]]+\]\([^\)]+\)\s*$/.test(line)) continue
      linkCount += 1
      const target = line.match(/\]\((?:<)?([^\)>]+)(?:>)?\)/)?.[1] || ''
      if (/^(?:\/[A-Za-z]:\/|[A-Za-z]:\\)/.test(target)) absolutePathEvidence = true
      const nextLine = String(lines[index + 1] || '').trim()
      if (/^`?[A-Za-z]:\\.+`?$/.test(nextLine)) absolutePathEvidence = true
      if (/^(?:绝对路径|Absolute path)[:：]\s*`?[A-Za-z]:\\.+`?$/.test(nextLine)) absolutePathEvidence = true
    }
    const missingItems = []
    if (!sectionFound) missingItems.push('artifact-section')
    if (!primaryLabel) missingItems.push('primary-artifacts-label')
    if (!linkCount) missingItems.push('artifact-links')
    if (linkCount && !absolutePathEvidence) missingItems.push('absolute-path-evidence')
    return {
      status: missingItems.length ? 'verified-missing' : 'verified-present',
      missingItems,
      linkCount
    }
  }

  function updateVisibleReplyState(state, payload, eventName) {
    if (eventName !== 'PreCompact' && eventName !== 'Stop') return
    const evidence = getVisibleReplyEvidence(payload)
    state.visible.replyEvidence = evidence.observed ? 'verified-present' : 'unverified'
    state.visible.replySource = evidence.source || ''
    state.visible.artifactEvidenceSource = evidence.source || ''
    if (!evidence.observed) {
      state.visible.artifactStatus = 'unverified'
      state.visible.artifactMissingItems = []
      return
    }
    const text = evidence.text
    state.visible.payloadObserved = true
    if (/入口检查（|预检查（DEV 模式）|PC0 上下文/.test(text)) {
      state.visible.precheck = true
      state.visible.precheckStatus = 'verified-present'
    } else if (!state.visible.precheck) {
      state.visible.precheckStatus = 'verified-missing'
    }
    if (/🛡️ DEV 模式 \| 合规检查|FC:\s*FC1/.test(text)) state.visible.compliance = true
    const artifactEvidence = analyzeArtifactDelivery(text)
    state.visible.artifactStatus = artifactEvidence.status
    state.visible.artifactMissingItems = artifactEvidence.missingItems
    state.visible.artifactPaths = artifactEvidence.status === 'verified-present'
  }

  function captureFinalPayloadSample(payload, eventName, state) {
    const statePaths = getStatePaths(state)
    if ((eventName !== 'PreCompact' && eventName !== 'Stop') || !fs.existsSync(statePaths.finalPayloadFlag)) return
    fs.mkdirSync(statePaths.dir, { recursive: true })
    const snap = {
      capturedAt: new Date().toISOString(),
      eventName,
      payloadKeys: Object.keys(payload).sort(),
      visiblePayloadDetected: hasVisibleReplyPayload(payload),
      interestingStrings: collectInterestingStrings(payload),
      state: { mode: state.mode, executionMode: state.executionMode, phase: state.phase, mutated: state.mutated }
    }
    fs.appendFileSync(statePaths.finalPayloadLog, `${JSON.stringify(snap)}\n`)
    if (eventName === 'Stop') fs.unlinkSync(statePaths.finalPayloadFlag)
  }

  function getPrecheckEvidenceStatus(state) {
    if (state.visible?.precheck) return 'verified-present'
    if (state.visible?.precheckStatus === 'verified-missing') return 'verified-missing'
    if (state.visible?.payloadObserved) return 'verified-missing'
    return 'unverified'
  }

  function buildClosureReminder(state, eventName) {
    const items = []
    const precheckStatus = getPrecheckEvidenceStatus(state)
    if (eventName === 'Stop' && precheckStatus === 'verified-missing') {
      items.push('entry check block 未输出（S07/C18：首条用户可见回复必须含 PC0~PC7 入口检查块）')
    } else if (eventName === 'Stop' && precheckStatus === 'unverified') {
      items.push(`无法验证最终用户可见回复是否包含入口检查块（Stop/PreCompact 未提供可解析 assistant 内容；如需取证请创建 ${getStatePaths(state).finalPayloadFlag} 后重试）`)
    }
    if (eventName === 'Stop' && state.mode === 'dev' && state.reportTouched && state.visible && !state.visible.compliance) {
      items.push('合规检查状态块未输出（17-compliance：dev 模式非 chat 回复末尾必须含 🛡️ DEV 模式 | 合规检查 状态块）')
    }
    const artifactStatus = state.visible?.artifactStatus || (state.visible?.artifactPaths ? 'verified-present' : 'unverified')
    if (eventName === 'Stop' && state.mode === 'dev' && state.reportTouched && artifactStatus === 'verified-missing') {
      const missing = (state.visible.artifactMissingItems || []).join(', ') || 'artifact-delivery-manifest'
      items.push(`产物交付不完整（ArtifactDeliveryCompletenessGate：missingItems=${missing}；evidenceSource=${state.visible.artifactEvidenceSource || 'unknown'}）`)
    } else if (eventName === 'Stop' && state.mode === 'dev' && state.reportTouched && artifactStatus === 'unverified') {
      items.push('无法验证最终用户可见回复的产物交付（Stop/PreCompact 未提供可解析 assistant 内容；状态只能为 unverified）')
    }
    if (state.mutated && !state.memoryTouched) items.push('记忆文件尚未写入（S05：会话结束前必须写入）')
    if (state.mutated && !state.reportTouched) items.push('报告文件尚未写入（chat 工作流豁免）')
    const governanceIntakeReminder = buildGovernanceIntakeReminderItem(state)
    if (governanceIntakeReminder) items.push(governanceIntakeReminder)
    if (!items.length) return ''
    return `DevCodex closure reminder: ${items.join('; ')}.`
  }

  function buildDedupedClosureReminder(state, eventName) {
    const reminder = buildClosureReminder(state, eventName)
    if (!reminder) return ''
    const key = [eventName, state.promptCount || 0, reminder].join('|')
    if (state.lastClosureReminderKey === key) return ''
    state.lastClosureReminderKey = key
    return reminder
  }

  return {
    hasVisibleReplyPayload,
    analyzeArtifactDelivery,
    updateVisibleReplyState,
    captureFinalPayloadSample,
    getPrecheckEvidenceStatus,
    buildClosureReminder,
    buildDedupedClosureReminder
  }
}

module.exports = { buildLifecycleVisibleReplyUtils }
