'use strict'

/**
 * Executable absorption probes for R1–R4 + T2 (PI-20260725 / PF-183 / PF-191 / PI-20260724-02 / PI-VEXT-024).
 * Test-only / conditional-path classifiers — no always-on host path.
 */

/**
 * R1 ProgressReportFastPath — progress/status queries must not inventory-first.
 * @returns {'progress-pass'|'progress-fail'|'progress-na'}
 */
function classifyProgressReportFastPathSample(sample, options = {}) {
  const text = String(sample || '')
  const isProgressQuery = options.isProgressQuery === true ||
    /进度|发版.*哪|验证到哪|fixed-awaiting|status report|报告进度|查.*状态/i.test(text) ||
    options.queryType === 'progress'
  if (!isProgressQuery && options.forceProgress !== true) {
    if (/进度查询|ProgressReportFastPath/i.test(text)) {
      // sample describes the gate itself
    } else {
      return 'progress-na'
    }
  }
  if (options.isProgressQuery === false) return 'progress-na'

  const boundProject = /绑定|\.devcodex\/[a-z0-9_-]+|vext-test|verification\/issues|直达|Test-Path/i.test(text)
  const progressCard = /总进度|问题台账|当前阻断|可否发版|数字表|open\s*\/|fixed-awaiting|进度卡/i.test(text)
  const inventoryFirst = /list_dir.*workspace|workspace 根|Get-ChildItem.*-Recurse|全库 (grep|摸底)|memory_task_resolve.*发版|scheduled-tasks|定位项目中|请稍候/i.test(text)
  const truthSourceOrder = /verification\/issues\/README|fixed-awaiting-rerun|05-发布规范|SUMMARY/i.test(text)

  if ((inventoryFirst || /正在扫描|先全库/i.test(text)) && !progressCard) return 'progress-fail'
  if (isProgressQuery || options.forceProgress) {
    if (progressCard && (boundProject || truthSourceOrder)) return 'progress-pass'
    if (progressCard) return 'progress-pass'
    if (!progressCard && text.trim().length > 20) return 'progress-fail'
  }
  if (progressCard) return 'progress-pass'
  return 'progress-na'
}

/**
 * R2 TaskPhaseProjectionGate — multi-task / continue must project phase + sourceDelivery.
 * @returns {'phase-pass'|'phase-fail'|'phase-na'}
 */
function classifyTaskPhaseProjectionSample(sample, options = {}) {
  const text = String(sample || '')
  const multiOrContinue = options.multiTask === true || options.continueIntent === true ||
    /多个 active|多任务|继续|resume|刚才那个|当前任务|sourceDelivery|phaseKind|实施计划/i.test(text)
  if (!multiOrContinue && options.forcePhase !== true) return 'phase-na'

  const hasActiveTask = /activeTask|当前任务|任务[：:]\s*\S+/i.test(text)
  const hasPhase = /phaseKind|CP[123]|阶段[：:]/i.test(text)
  const hasSourceDelivery = /sourceDelivery\s*[=:]\s*(none|started|partial|complete)|源码实施\s*[=:]\s*(未开始|已开始|部分|完成)/i.test(text)
  const hasNext = /nextAllowedAction|下一步[：:]|next action/i.test(text)
  const falseStarted = /已在实施|已经开始写代码|实施中(?!计划)|sourceDelivery\s*[=:]\s*started/i.test(text) &&
    !/CP3.*confirm|05-实施进度|source mutation/i.test(text) &&
    /04-实施计划|CP3 pending|sourceDelivery\s*[=:]\s*none|未确认 CP3/i.test(text)

  if (falseStarted) return 'phase-fail'
  if (hasActiveTask && hasPhase && hasSourceDelivery) return 'phase-pass'
  if ((options.multiTask || options.continueIntent || /继续|多任务/i.test(text)) &&
    (!hasSourceDelivery || !hasPhase)) {
    return 'phase-fail'
  }
  if (hasSourceDelivery && hasPhase) return 'phase-pass'
  return 'phase-na'
}

/**
 * R3 ClosedArtifactNoReviveGate
 * sample: { headerStatus, intendedAction, targetPath }
 * @returns {'revive-blocked'|'revive-allowed-invalid'|'revive-na'|'revive-ok-new'}
 */
function classifyClosedArtifactNoReviveSample(sample) {
  const obj = sample && typeof sample === 'object' ? sample : null
  const text = obj ? '' : String(sample || '')
  const header = String(obj?.headerStatus || obj?.status || '')
  const action = String(obj?.intendedAction || obj?.action || '')
  const combined = `${header} ${action} ${text}`

  const closed = /closed|canceled|cancelled|archived|user-canceled|已关闭|已取消|用户取消/i.test(combined)
  const revive = /update.?same|incremental|改回 active|复活|重新打开同一|写回 candidate|update 00|update 01|继续该需求目录/i.test(combined)
  const newDir = /new.?directory|新建需求|新建 bug|superseded|related marker|新目录/i.test(combined)

  if (!closed && !/closed|canceled|已关闭/i.test(combined)) return 'revive-na'
  if (closed && revive && !newDir) return 'revive-allowed-invalid'
  if (closed && newDir) return 'revive-ok-new'
  if (closed && !revive) return 'revive-blocked'
  return 'revive-na'
}

/**
 * R4 FormalRerunLightClassify — must classify before full formal.
 * sample: { classified, class, startingFullFormal, hasSharedBenefit }
 * @returns {'rerun-pass'|'rerun-fail'|'rerun-na'}
 */
function classifyFormalRerunLightSample(sample) {
  const obj = sample && typeof sample === 'object' ? sample : null
  if (!obj) {
    const text = String(sample || '')
    if (!/formal|rerun|full formal|正式运行/i.test(text)) return 'rerun-na'
    if (/逐个 finding.*full formal|finding 粒度.*正式运行|未分类.*full formal/i.test(text)) return 'rerun-fail'
    if (/LightClassify|可关闭候选|shared rerun|分类后/i.test(text)) return 'rerun-pass'
    return 'rerun-na'
  }
  if (obj.applicable === false) return 'rerun-na'
  const starting = obj.startingFullFormal === true
  const classified = obj.classified === true
  const cls = String(obj.class || '')
  if (!starting) return 'rerun-na'
  if (!classified) return 'rerun-fail'
  if (/close-with-fresh|unmet|blocked|shared-rerun|可关闭|未满足|阻断|共享/i.test(cls) || obj.class) {
    if (obj.class === 'need-full-per-finding' && !obj.hasSharedBenefit) return 'rerun-fail'
    return 'rerun-pass'
  }
  return 'rerun-fail'
}

/**
 * T2 Finding object layer — source-product vs verification-system
 * @returns {'layer-pass'|'layer-fail'|'layer-na'}
 */
function classifyFindingObjectLayerSample(sample) {
  const obj = sample && typeof sample === 'object' ? sample : null
  const text = obj ? JSON.stringify(obj) : String(sample || '')
  if (!/finding|authority|verification|source-product|verification-system|产品问题|验证系统/i.test(text)) {
    return 'layer-na'
  }
  const layer = obj?.objectLayer || obj?.findingObject || obj?.layer ||
    (/source-product/i.test(text) ? 'source-product' : (/verification-system/i.test(text) ? 'verification-system' : ''))
  const claimsProductFixed = /产品已修复|source 已修|Vext 已修复|产品问题.*已关闭/i.test(text)
  const onlyVerification = /validator|验证脚本|控制面|evidence chain|verification-system/i.test(text) &&
    !/source patch|source mutation|产品源码/i.test(text)

  if (!layer) return 'layer-fail'
  if (!/source-product|verification-system/i.test(layer)) return 'layer-fail'
  if (claimsProductFixed && (layer === 'verification-system' || onlyVerification)) return 'layer-fail'
  return 'layer-pass'
}

module.exports = {
  classifyProgressReportFastPathSample,
  classifyTaskPhaseProjectionSample,
  classifyClosedArtifactNoReviveSample,
  classifyFormalRerunLightSample,
  classifyFindingObjectLayerSample
}
