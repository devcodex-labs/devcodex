'use strict'

/**
 * PF-087: free-text entry-check completeness for PC0~PC7 (extends Envelope rules to markdown paths).
 * Does not invent a parallel gate owner — used by lifecycle-visible-reply + UV contract.
 *
 * @param {string} text assistant-visible reply
 * @param {{ mode?: string }} [options] state.mode (dev|prod|…) for PC4 N/A rules
 * @returns {{
 *   claimed: boolean,
 *   complete: boolean,
 *   status: 'not-claimed'|'complete'|'incomplete',
 *   missingPcs: string[],
 *   missingItems: string[],
 *   foldedRanges: string[],
 *   presentPcs: string[]
 * }}
 */
function analyzeEntryCheckCompleteness(text, options = {}) {
  const body = String(text || '')
  const mode = String(options.mode || options.envMode || '').toLowerCase()
  const claimed = /入口检查|预检查（\s*DEV|###\s*DevCodex\s*·\s*入口检查|DevCodexVisibleEnvelopeV1\s*·\s*entry-check|PC0\s*(?:上下文|\[|（)|PC0\s*[：:]/i.test(body)
  if (!claimed) {
    return {
      claimed: false,
      complete: false,
      status: 'not-claimed',
      missingPcs: [],
      missingItems: [],
      foldedRanges: [],
      presentPcs: []
    }
  }

  const missingItems = []
  const foldedRanges = []
  // Folded / merged PC ranges (e.g. PC2–PC7, PC2-7, PC2~PC7)
  const foldedRe = /PC\s*([0-7])\s*(?:[-–—~～至到]|到)\s*(?:PC\s*)?([0-7])/gi
  let fm
  while ((fm = foldedRe.exec(body)) !== null) {
    const a = Number(fm[1])
    const b = Number(fm[2])
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
      foldedRanges.push(`PC${Math.min(a, b)}-PC${Math.max(a, b)}`)
      missingItems.push('pc-folded-range')
    }
  }
  // "PC2–PC7 PASS" style without individual lines
  if (/PC\s*[2-6]\s*[-–—~～]\s*PC\s*7|PC2\s*[-–—~～]\s*7/i.test(body)) {
    if (!missingItems.includes('pc-folded-range')) missingItems.push('pc-folded-range')
  }

  const presentPcs = []
  for (let i = 0; i <= 7; i++) {
    // Separate line/bullet/table cell for this PC (not only inside a folded range token)
    const lineRe = new RegExp(
      `(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\|\\s*)?PC${i}\\b(?!\\s*[-–—~～至到])`,
      'i'
    )
    if (lineRe.test(body)) presentPcs.push(`PC${i}`)
  }
  const missingPcs = []
  for (let i = 0; i <= 7; i++) {
    const id = `PC${i}`
    if (!presentPcs.includes(id)) missingPcs.push(id)
  }
  if (missingPcs.length) missingItems.push('pc-columns-incomplete')

  // PC0 must carry context-ish content (not empty status-only)
  const pc0Line = body.match(/(?:^|\n)\s*(?:[-*]\s*)?(?:\|\s*)?PC0\b[^\n]{0,200}/i)
  if (pc0Line) {
    const content = pc0Line[0]
    const hasContext = /上下文|Context|plan|active-root|项目|PASS|WARN|BLOCK|UNVERIFIED|N\/A|回执|receipt/i.test(content) &&
      content.replace(/PC0|\[[^\]]*\]|[|`*_#\-]/gi, '').trim().length >= 2
    if (!hasContext) missingItems.push('pc0-context-thin')
  } else {
    missingItems.push('pc0-context-thin')
  }

  // PC4: in dev, N/A without skip/reason is invalid; bare "PC4 N/A" alone is thin
  const pc4Line = body.match(/(?:^|\n)\s*(?:[-*]\s*)?(?:\|\s*)?PC4\b[^\n]{0,220}/i)
  if (pc4Line) {
    const line = pc4Line[0]
    const isNa = /\bN\/A\b|不适用/i.test(line)
    const hasSkip = /skipReason|跳过理由|非\s*dev|prod\s*模式|不展开|N\/A\s*[：:].+/i.test(line)
    const hasDevRadar = /规范雷达|Skills?|Profile|Owner|TestRoute|完整/i.test(line)
    if (mode === 'dev') {
      if (isNa && !hasSkip) missingItems.push('pc4-dev-na-without-skip')
      if (!isNa && !hasDevRadar && line.replace(/PC4|\[[^\]]*\]|[|`*_#\-]/gi, '').trim().length < 4) {
        missingItems.push('pc4-dev-radar-thin')
      }
    } else if (isNa && !hasSkip && mode !== 'prod') {
      // unknown mode: soft warn item still recorded
      missingItems.push('pc4-na-without-skipReason')
    }
  }

  // Unique missingItems
  const uniqueMissing = []
  for (const item of missingItems) {
    if (!uniqueMissing.includes(item)) uniqueMissing.push(item)
  }

  const complete = uniqueMissing.length === 0 && missingPcs.length === 0 && foldedRanges.length === 0
  return {
    claimed: true,
    complete,
    status: complete ? 'complete' : 'incomplete',
    missingPcs,
    missingItems: uniqueMissing,
    foldedRanges: [...new Set(foldedRanges)],
    presentPcs
  }
}

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
   * PF-163: also detect bare path lists / filename-only delivery outside allowed semantic headings.
   * @param {string} text visible assistant reply
   * @returns {{status: string, missingItems: string[], linkCount: number}}
   */
  function analyzeArtifactDelivery(text) {
    const lines = String(text || '').split(/\r?\n/)
    let inArtifactSection = false
    let sectionFound = false
    let envelopeMarker = false
    let legacyLabel = false
    let barePathListHeading = false
    let barePathBulletCount = 0
    let bareAbsoluteInSection = 0
    let linkCount = 0
    let semanticItemCount = 0
    let semanticDigest = ''
    const barePathHeadingRe = /^\s*(?:#{1,6}\s*)?(?:核心文件|主要文件|关键文件|路径列表|交付路径|相关路径|相关文件)[:：]?\s*$/i
    const barePathBulletRe = /^\s*[-*]\s*(?:`?[\w./\\-]+\.(?:md|json|js|cjs|mjs|ts)`?|[A-Za-z]:\\[^\s]+)\s*$/
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      const marker = line.match(/DevCodexVisibleEnvelopeV1\s*·\s*(?:entry-check|completion-check|confirmation|progress|final-result|error-block)\s*·\s*(?:PASS|WARN|BLOCK|UNVERIFIED|N\/A)\s*·\s*([a-f0-9]{64})/)
      if (marker) {
        envelopeMarker = true
        semanticDigest = marker[1]
      }
      if (/^\s*(?:#{1,6}\s*)?(?:需要你确认的文件|本批交付文件|完成交付文件|阻断证据)[:：]?\s*$/.test(line)) {
        inArtifactSection = true
        sectionFound = true
        continue
      }
      if (/📂\s*本次会话产物|主要产物|primary artifacts?/i.test(line)) legacyLabel = true
      if (barePathHeadingRe.test(line)) {
        barePathListHeading = true
        legacyLabel = true
      }
      if (!inArtifactSection) {
        if (barePathBulletRe.test(line)) barePathBulletCount += 1
        continue
      }
      if (/^#{1,6}\s+/.test(line)) break
      if (/^\s*-\s*\[[^\]]+\]\((?:<)?[^\)]+(?:>)?\)/.test(line)) linkCount += 1
      if (/^\s*-\s*(?:\[[^\]]+\]\([^\)]+\)|[^—\[]+)\s*—\s*.+(?:操作|action)[:：]/i.test(line)) {
        semanticItemCount += 1
      } else if (/^\s*[-*]\s*(?:[A-Za-z]:\\|`?[A-Za-z]:\\)/.test(line) || barePathBulletRe.test(line)) {
        // Absolute path or bare filename bullet inside delivery section without action clause
        bareAbsoluteInSection += 1
      }
    }
    const missingItems = []
    if (!sectionFound) missingItems.push('artifact-section')
    if (!envelopeMarker) missingItems.push(legacyLabel ? 'legacy-artifact-format' : 'visible-envelope-marker')
    if (sectionFound && !semanticItemCount) missingItems.push('semantic-artifact-items')
    if (barePathListHeading && !sectionFound) missingItems.push('bare-path-list')
    if (barePathBulletCount > 0 && !sectionFound) missingItems.push('bare-path-items')
    if (sectionFound && bareAbsoluteInSection > 0 && semanticItemCount === 0) {
      missingItems.push('bare-absolute-paths')
    }
    // Unique missing items while preserving order
    const uniqueMissing = []
    for (const item of missingItems) {
      if (!uniqueMissing.includes(item)) uniqueMissing.push(item)
    }
    const status = (legacyLabel || barePathListHeading || barePathBulletCount > 0) && !envelopeMarker
      ? 'unverified'
      : uniqueMissing.length ? 'verified-missing' : 'verified-present'
    return {
      status,
      missingItems: uniqueMissing,
      linkCount,
      semanticItemCount,
      semanticDigest,
      barePathListHeading,
      barePathBulletCount
    }
  }

  function updateVisibleReplyState(state, payload, eventName) {
    if (eventName !== 'PreCompact' && eventName !== 'Stop') return
    const evidence = getVisibleReplyEvidence(payload)
    state.visible.replyEvidence = evidence.observed ? 'verified-present' : 'unverified'
    state.visible.replySource = evidence.source || ''
    state.visible.artifactEvidenceSource = evidence.source || ''
    if (!evidence.observed) {
      // PF-163: unobserved payload cannot invent delivery; still surface semantic-artifact gap for completion evidence
      state.visible.artifactStatus = 'unverified'
      state.visible.artifactMissingItems = ['visible-payload-unobserved', 'semantic-artifact-items']
      state.visible.stopProbe = {
        schemaVersion: 'StopPayloadProbeV1',
        observed: false,
        source: '',
        precheckStatus: 'unverified',
        textBytes: 0,
        note: 'Grok/Codex Stop often omits assistant body; cannot verified-missing PC0 without payload'
      }
      return
    }
    const text = evidence.text
    state.visible.payloadObserved = true
    // Accept both legacy and portable envelope precheck markers (W8).
    // PF-087: presence alone is not enough — require free-text PC0~PC7 column completeness.
    const entryCompleteness = analyzeEntryCheckCompleteness(text, { mode: state.mode })
    state.visible.entryCheckCompleteness = entryCompleteness
    if (/入口检查（|预检查（DEV 模式）|PC0 上下文|###\s*DevCodex\s*·\s*入口检查|DevCodexVisibleEnvelopeV1\s*·\s*entry-check|PC0\s*[\[（]/.test(text)) {
      if (entryCompleteness.complete) {
        state.visible.precheck = true
        state.visible.precheckStatus = 'verified-present'
      } else {
        // Claimed entry check but folded/incomplete → verified-missing (not green)
        state.visible.precheck = false
        state.visible.precheckStatus = 'verified-missing'
        state.visible.precheckMissingItems = entryCompleteness.missingItems.concat(
          entryCompleteness.missingPcs.map((id) => `missing-${id}`)
        )
      }
    } else if (!state.visible.precheck) {
      state.visible.precheckStatus = 'verified-missing'
    }
    // Record probe quality for doctor/debug: whether host exposed assistant text at all.
    state.visible.stopProbe = {
      schemaVersion: 'StopPayloadProbeV1',
      observed: true,
      source: evidence.source || 'unknown',
      precheckStatus: state.visible.precheckStatus,
      entryCheckCompleteness: entryCompleteness.status,
      textBytes: Buffer.byteLength(String(text || ''), 'utf8')
    }
    if (/🛡️ DEV 模式 \| 合规检查|FC:\s*FC1|DevCodexVisibleEnvelopeV1\s*·\s*completion-check/.test(text)) state.visible.compliance = true
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

  /**
   * Settle S07 order relative to product mutations (reports/memory/ledgers).
   * Mid-turn tool-loops almost never have verified-present precheck until Stop;
   * productMutationBeforePrecheck + final PC => late (VL-004 class).
   */
  function settleS07OrderStatus(state, eventName) {
    if (eventName !== 'Stop' && eventName !== 'PreCompact') return
    if (!state.visible) state.visible = {}
    const precheckStatus = getPrecheckEvidenceStatus(state)
    if (precheckStatus === 'unverified') {
      state.visible.s07OrderStatus = 'unverified'
      return
    }
    if (precheckStatus === 'verified-missing') {
      state.visible.s07OrderStatus = 'missing'
      return
    }
    if (state.productMutationBeforePrecheck) {
      state.visible.s07OrderStatus = 'late'
      return
    }
    state.visible.s07OrderStatus = 'ok'
  }

  function buildClosureReminder(state, eventName) {
    const items = []
    const precheckStatus = getPrecheckEvidenceStatus(state)
    if (eventName === 'Stop' && precheckStatus === 'verified-missing') {
      const completeness = state.visible?.entryCheckCompleteness
      if (completeness && completeness.claimed && !completeness.complete) {
        const detail = [
          ...(completeness.foldedRanges || []),
          ...(completeness.missingItems || []),
          ...(completeness.missingPcs || [])
        ].slice(0, 8).join(', ')
        items.push(`entry check incomplete（PF-087：PC0~PC7 须分列完整；不得折叠合并；missing=${detail || 'pc-columns-incomplete'}）`)
      } else {
        items.push('entry check block 未输出（S07/C18：首条用户可见回复必须含 PC0~PC7 入口检查块）')
      }
    } else if (eventName === 'Stop' && precheckStatus === 'unverified') {
      items.push(`无法验证最终用户可见回复是否包含入口检查块（Stop/PreCompact 未提供可解析 assistant 内容；如需取证请创建 ${getStatePaths(state).finalPayloadFlag} 后重试）`)
    }
    settleS07OrderStatus(state, eventName)
    if (eventName === 'Stop' && state.visible?.s07OrderStatus === 'late') {
      items.push('S07 order: product mutation before entry-check evidence（VL-004：文首补 PC 不算先输出；reports/.memory/台账写入须在首次可见 PC0~PC7 之后）')
    }
    if (eventName === 'Stop' && state.mode === 'dev' && state.reportTouched && state.visible && !state.visible.compliance) {
      items.push('合规检查状态块未输出（17-compliance：dev 模式非 chat 回复末尾必须含 🛡️ DEV 模式 | 合规检查 状态块）')
    }
    const artifactStatus = state.visible?.artifactStatus || (state.visible?.artifactPaths ? 'verified-present' : 'unverified')
    if (eventName === 'Stop' && state.mode === 'dev' && state.reportTouched && artifactStatus === 'verified-missing') {
      const missing = (state.visible.artifactMissingItems || []).join(', ') || 'artifact-delivery-manifest'
      items.push(`用户可见交付不完整（VisibleOutputHostEvidenceGate：missingItems=${missing}；evidenceSource=${state.visible.artifactEvidenceSource || 'unknown'}）`)
    } else if (eventName === 'Stop' && state.mode === 'dev' && state.reportTouched && artifactStatus === 'unverified') {
      const missing = (state.visible.artifactMissingItems || []).join(', ') || 'semantic-artifact-items, visible-payload-unobserved'
      items.push(`无法验证最终用户可见回复的产物交付（Stop/PreCompact 未提供可解析 assistant 内容；状态只能为 unverified；missingItems=${missing}）`)
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
    analyzeEntryCheckCompleteness,
    updateVisibleReplyState,
    captureFinalPayloadSample,
    getPrecheckEvidenceStatus,
    settleS07OrderStatus,
    buildClosureReminder,
    buildDedupedClosureReminder
  }
}

module.exports = { buildLifecycleVisibleReplyUtils, analyzeEntryCheckCompleteness }
