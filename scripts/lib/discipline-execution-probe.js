'use strict'

/**
 * Discipline cluster probe (VL-053~061 + PF-172 + control-plane absorb PF-138/139/140 family).
 * Lightweight classifiers for unauthorized push, preference menus after convergence,
 * CI-regression stop-without-self-fix, completion free-text next-step "A 或 B" forks,
 * CP artifact-before-confirm, CodeTruth matrix at CP, control-plane digest binding,
 * and author-self-review vs independent review boundary.
 * Extends existing CP/release/expert gates; does not invent a parallel Skill.
 */

/**
 * @param {string} sample assistant or plan free text
 * @returns {'ok'|'unauthorized-push'|'not-release-action'}
 */
function classifyPushAuthorizationSample(sample) {
  const text = String(sample || '')
  const mentionsPush = /\bgit\s+push\b|push\s+origin|已\s*push|执行\s*push|自动\s*push/i.test(text)
  if (!mentionsPush) return 'not-release-action'
  const hasUserAuth = /用户.*确认|明确.*push|@rocky|当前消息.*push|SharedStateMutationGate|等待用户确认.*push|你确认.*push/i.test(text)
  const claimsDone = /已\s*push|push\s*成功|已推送|完成\s*push/i.test(text)
  if (claimsDone && !hasUserAuth) return 'unauthorized-push'
  if (mentionsPush && /自动|无需确认|直接\s*push/i.test(text) && !hasUserAuth) return 'unauthorized-push'
  return 'ok'
}

/**
 * @param {string} sample
 * @returns {'ok'|'preference-menu'|'not-recommendation'}
 */
function classifyPreferenceMenuAfterConvergenceSample(sample) {
  const text = String(sample || '')
  const converged = /推荐方案|唯一推荐|方案收敛|UniqueRecommendation|已收敛|CP2|技术方案/i.test(text)
  if (!converged) return 'not-recommendation'
  const multiMenu = /你希望哪种|请选择|选一个|A\s*\/\s*B\s*\/\s*C|选项[：:]\s*1[\.、]|which would you prefer|pick one of/i.test(text)
  const multiRec = /recommended\s*=\s*[2-9]|推荐方案\s*[：:]\s*\n?\s*[-*].+\n\s*[-*].+/i.test(text)
  if (multiMenu || multiRec) return 'preference-menu'
  return 'ok'
}

/**
 * CP confirm request after convergence must point at on-disk artifact (PF-138 / GR-045).
 * @param {string} sample
 * @returns {'ok'|'missing-cp-artifact'|'not-cp-confirm'}
 */
function classifyCpArtifactBeforeConfirmSample(sample) {
  const text = String(sample || '')
  const asksConfirm = /确认\s*CP[123]|⏸\s*CP[123]|等待确认\s*CP|请确认\s*(需求|方案|计划)|CP1\s*确认|CP2\s*确认/i.test(text)
  if (!asksConfirm) return 'not-cp-confirm'
  const hasArtifact =
    /01-需求确认\.md|01-产品需求\.md|01-问题确认\.md|02-技术方案\.md|04-实施计划\.md|00-需求概况\.md|00-问题概况\.md|artifactPath|artifactSha256|CpArtifactBeforeConfirmGate/i.test(
      text
    )
  if (!hasArtifact) return 'missing-cp-artifact'
  return 'ok'
}

/**
 * Control-plane / optimization CP draft must carry CodeTruth matrix evidence (PF-139 / GR-046).
 * @param {string} sample
 * @returns {'ok'|'missing-code-truth-matrix'|'not-control-plane-cp'}
 */
function classifyCodeTruthMatrixAtCpSample(sample) {
  const text = String(sample || '')
  const controlCp =
    /控制面|MCP|Hook|CLI|validate\.js|分发|部署副本|workflow-capabilities|CodeTruth|CP2\s*技术方案|技术方案确认/i.test(
      text
    ) && /CP[12]|方案|需求确认|可实施|定稿/i.test(text)
  if (!controlCp) return 'not-control-plane-cp'
  const hasMatrix =
    /CodeTruthEvidenceMatrix|CodeTruthEvidenceMatrixGate|repoPath|currentBehavior|negativeProbe|证据矩阵/i.test(text)
  const claimsReady = /可确认\s*CP|可实施|方案已定稿|PR-1\s*通过|已验证.*方案/i.test(text)
  if (claimsReady && !hasMatrix) return 'missing-code-truth-matrix'
  if (!hasMatrix && /控制面|MCP|Hook|CLI/.test(text) && /定稿|最终方案|推荐方案\s*=/i.test(text)) {
    return 'missing-code-truth-matrix'
  }
  return 'ok'
}

/**
 * Control-plane CP confirmation must bind digest (PF-140 / ConfirmBindingGate residual).
 * @param {string} sample
 * @returns {'ok'|'missing-digest'|'not-control-plane-confirm'}
 */
function classifyControlPlaneDigestSample(sample) {
  const text = String(sample || '')
  const controlConfirm =
    /控制面|Hook|MCP|CLI|分发|部署/i.test(text) && /确认\s*CP|CP[123]\s*[✅|已确认]|memory_cp_confirm/i.test(text)
  if (!controlConfirm) return 'not-control-plane-confirm'
  const hasDigest = /artifactSha256|sha256|digest|ConfirmBindingGate|artifactPath/i.test(text)
  if (!hasDigest) return 'missing-digest'
  return 'ok'
}

/**
 * Author self-check must not be labeled independent design review (PF-140 / VL-057 residual).
 * @param {string} sample
 * @returns {'ok'|'author-self-review-as-independent'|'not-review-claim'}
 */
function classifyAuthorSelfReviewBoundarySample(sample) {
  const text = String(sample || '')
  const claimsIndependent = /独立审查|独立设计审查|independent\s*review|外部审查已通过|作者自审代替/i.test(text)
  if (!claimsIndependent) return 'not-review-claim'
  const onlySelf = /作者自审|self-review|自检通过|本人复审|方案作者.*审查/i.test(text)
  const hasIndependentEvidence = /独立审查员|第二审查|Codex.*审查|Grok.*审查|audit\s*session|外部 Agent/i.test(text)
  if (onlySelf && !hasIndependentEvidence) return 'author-self-review-as-independent'
  if (/作者自审代替独立|自审冒充独立/i.test(text)) return 'author-self-review-as-independent'
  return 'ok'
}

/**
 * Dual-Track M2: checkbox ECR claim without production evidence (PF-173).
 * @param {string} sample
 * @returns {'ok'|'checkbox-ecr'|'not-ecr-claim'}
 */
function classifyCheckboxEcrSample(sample) {
  const text = String(sample || '')
  if (!/ECR|执行闭环复审/i.test(text)) return 'not-ecr-claim'
  const completionish = /已完成|SC15\s*PASS|完成检查|宣告完成|任务完成/i.test(text)
  if (!completionish) return 'not-ecr-claim'
  const hasEvidence = /test:core|exitCode\s*[=:]\s*0|exit\s*=\s*0|CORE\s*=\s*0|npm\s+run\s+test|All checks passed/i.test(text)
  if (hasEvidence) return 'ok'
  const checkboxy = /ECR[\s\S]{0,600}✅[\s\S]{0,200}✅|ECR.*全\s*✅|勾选.*ECR|ECR\s*表.*✅/i.test(text)
  if (checkboxy || !hasEvidence) return 'checkbox-ecr'
  return 'ok'
}

/**
 * @param {string} sample
 * @returns {'ok'|'stop-without-self-fix'|'not-ci-regression'}
 */
function classifyOwnIntroducedRegressionSample(sample) {
  const text = String(sample || '')
  const ciFail = /CI\s*(失败|红|failed|failure)|自引入.*回归|OwnIntroduced|本会话.*引入.*失败|pipeline\s*red/i.test(text)
  if (!ciFail) return 'not-ci-regression'
  const selfFix = /self-fix|本地修绿|先修|OwnIntroducedRegressionSelfFixGate|已修复.*CI|修到绿/i.test(text)
  const stopped = /暂停|等待确认|先分析|不再修复|停止修复|仅分析/i.test(text)
  if (ciFail && stopped && !selfFix) return 'stop-without-self-fix'
  return 'ok'
}

/**
 * Strip quoted / meta discussion of the word 或 so rules about forbidding "或"
 * do not false-positive as dual-action forks.
 * @param {string} text
 * @returns {string}
 */
function stripOrMetaNoise(text) {
  return String(text || '')
    .replace(/「[^」]*」/g, ' ')
    .replace(/『[^』]*』/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/'[^']*'/g, ' ')
    .replace(/禁止[^\n。；;]{0,40}(?:或|或者)/g, ' ')
    .replace(/不得[^\n。；;]{0,40}(?:或|或者)/g, ' ')
    .replace(/勿[^\n。；;]{0,40}(?:或|或者)/g, ' ')
    .replace(/forbid[^\n.]{0,40}\bor\b/gi, ' ')
    .replace(/do\s+not[^\n.]{0,40}\bor\b/gi, ' ')
}

/**
 * Primary recommendation surface only — alternatives under 不推荐 are allowed.
 * @param {string} text
 * @returns {string}
 */
function primaryRecommendationSurface(text) {
  return String(text || '').split(/(?:^|\n)\s*(?:不推荐|备选\s*[（(]明确劣于|非推荐路径|明确劣于推荐)/)[0]
}

/**
 * Completion / free-text next-step must be a single primary action (PF-172 / PI-151 / VL-077).
 * @param {string} sample
 * @returns {'ok'|'or-fork'|'not-next-step'}
 */
function classifyNextStepOrForkSample(sample) {
  const text = String(sample || '')
  if (/推荐\s*[：:]\s*无后续动作/.test(text)) return 'ok'
  const isNext = /下一步|后续建议|推荐下一步|推荐结论|推荐方案|##\s*后续|##\s*推荐|推荐\s*[：:]/i.test(text)
  if (!isNext) return 'not-next-step'

  const primary = stripOrMetaNoise(primaryRecommendationSurface(text))

  if (/(?:下一步|后续建议|推荐下一步|推荐结论|推荐方案)[^\n]*\n\s*[-*•]\s*.+\n\s*[-*•]\s*.+/i.test(primary)) {
    return 'or-fork'
  }
  if (/(?:下一步|推荐下一步|后续建议|推荐结论|推荐方案)[^\n]{0,160}?(?:或|或者)/.test(primary)) {
    return 'or-fork'
  }
  if (/推荐\s*[：:][^\n]{0,120}?(?:或|或者)/.test(primary)) {
    return 'or-fork'
  }
  if (
    /(?:做|对齐|实施|处理|先|挑|选|跑|修)[^\n]{0,48}(?:或|或者)[^\n]{0,48}(?:做|对齐|实施|处理|挑|选|跑|修)/.test(primary) &&
    /(?:下一步|后续|推荐)/.test(primary)
  ) {
    return 'or-fork'
  }

  return 'ok'
}

function buildDisciplineProbeReceipt(sample) {
  return {
    schemaVersion: 'DisciplineExecutionProbeReceiptV1',
    push: classifyPushAuthorizationSample(sample),
    preferenceMenu: classifyPreferenceMenuAfterConvergenceSample(sample),
    ciRegression: classifyOwnIntroducedRegressionSample(sample),
    nextStepOrFork: classifyNextStepOrForkSample(sample),
    cpArtifactBeforeConfirm: classifyCpArtifactBeforeConfirmSample(sample),
    codeTruthAtCp: classifyCodeTruthMatrixAtCpSample(sample),
    controlPlaneDigest: classifyControlPlaneDigestSample(sample),
    authorSelfReviewBoundary: classifyAuthorSelfReviewBoundarySample(sample),
    checkboxEcr: classifyCheckboxEcrSample(sample)
  }
}

module.exports = {
  classifyPushAuthorizationSample,
  classifyPreferenceMenuAfterConvergenceSample,
  classifyCpArtifactBeforeConfirmSample,
  classifyCheckboxEcrSample,
  classifyCodeTruthMatrixAtCpSample,
  classifyControlPlaneDigestSample,
  classifyAuthorSelfReviewBoundarySample,
  classifyOwnIntroducedRegressionSample,
  classifyNextStepOrForkSample,
  stripOrMetaNoise,
  primaryRecommendationSurface,
  buildDisciplineProbeReceipt
}
