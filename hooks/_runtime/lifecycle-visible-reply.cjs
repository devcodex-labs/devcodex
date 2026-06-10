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
    const lines = String(text || '').split(/\r?\n/)
    let inArtifactSection = false
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      if (/^\s*📂\s*本次会话产物[:：]?\s*$/.test(line)) {
        inArtifactSection = true
        continue
      }
      if (!inArtifactSection) continue
      if (!/^\s*-\s*\[[^\]]+\]\([^\)]+\)\s*$/.test(line)) continue
      const nextLine = String(lines[index + 1] || '').trim()
      if (/^`?[A-Za-z]:\\.+`?$/.test(nextLine)) return true
      if (/^(?:绝对路径|Absolute path)[:：]\s*`?[A-Za-z]:\\.+`?$/.test(nextLine)) return true
      return true
    }
    return false
  }

  function updateVisibleReplyState(state, payload, eventName) {
    if (eventName !== 'PreCompact' && eventName !== 'Stop') return
    const evidence = getVisibleReplyEvidence(payload)
    state.visible.replyEvidence = evidence.observed ? 'verified' : 'unverified'
    state.visible.replySource = evidence.source || ''
    if (!evidence.observed) return
    const text = evidence.text
    state.visible.payloadObserved = true
    if (/入口检查（|预检查（DEV 模式）|PC0 上下文/.test(text)) {
      state.visible.precheck = true
      state.visible.precheckStatus = 'verified-present'
    } else if (!state.visible.precheck) {
      state.visible.precheckStatus = 'verified-missing'
    }
    if (/🛡️ DEV 模式 \| 合规检查|FC:\s*FC1/.test(text)) state.visible.compliance = true
    if (hasArtifactPathOutput(text)) state.visible.artifactPaths = true
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
    if (eventName === 'Stop' && state.mode === 'dev' && state.reportTouched && state.visible && !state.visible.artifactPaths) {
      items.push('产物路径未输出（FC5/T9：回复末尾必须在 📂 本次会话产物 区块列出 Markdown 链接）')
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
    updateVisibleReplyState,
    captureFinalPayloadSample,
    getPrecheckEvidenceStatus,
    buildClosureReminder,
    buildDedupedClosureReminder
  }
}

module.exports = { buildLifecycleVisibleReplyUtils }
