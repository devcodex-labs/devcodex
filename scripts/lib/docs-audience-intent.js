'use strict'

/**
 * DocsAudienceIntentGate classifiers (CP1/CP2: 文档受众双 Skill 分流).
 * Portable pure functions — no I/O.
 */

/**
 * @typedef {'public-user'|'maintainer-dev'|'ambiguous'|'multi-audience'} DocsAudience
 * @typedef {'guide'|'readme'|'reference'|'migration'|'changelog'|'operations'|'maintainer'|'other'} DocsSurface
 */

/**
 * @param {string} prompt
 * @param {{ pathHints?: string[] }} [opts]
 * @returns {{
 *   docsAudience: DocsAudience,
 *   docsSurface: DocsSurface,
 *   recommendedAudience: 'public-user'|'maintainer-dev'|null,
 *   recommendedLabel: string|null,
 *   signals: string[],
 *   status: 'ok'|'ambiguous'|'multi-audience',
 *   failClosed: boolean
 * }}
 */
function classifyDocsAudienceSample(prompt, opts = {}) {
  const text = String(prompt || '')
  const pathBlob = (opts.pathHints || []).map(String).join(' ')
  const blob = `${text}\n${pathBlob}`
  const signals = []

  const hasUserPhrase = /用户使用|用户文档|使用文档|使用者文档|安装|quick\s*start|快速开始|接入|给使用者|开源用户|第一次成功|how to use|getting started/i.test(blob)
  // 贡献 alone is weak; prefer contributing/维护者/开发站 to avoid over-fire, but 贡献指南 is maintainer
  const hasMaintPhrase = /维护者|贡献指南|贡献流程|contributing|本地开发|clone|发版\s*runbook|release\s*checklist|internals|ADR|开发站点|给维护|维护者文档/i.test(blob)
  const hasReadme = /\bREADME\b|主入口文档/i.test(blob)
  const hasReference = /\bAPI\b|CLI|Config\s*参考|接口参考|reference/i.test(blob)
  const hasMigrationUser = /升级指南|迁移指南|从\s*v?\d|upgrade\s+guide/i.test(blob) && !/实现迁移|迁移代码|写迁移/i.test(blob)
  const hasMigrationImpl = /实现迁移|迁移代码|写迁移|migration\s+impl/i.test(blob)
  const hasChangelogUser = /changelog|更新日志|release\s*notes/i.test(blob) && !/发版\s*runbook|发布清单|release\s*checklist/i.test(blob)
  const hasChangelogMaint = /发版\s*runbook|发布清单|release\s*checklist|tag\s*发布流程/i.test(blob)
  const hasOpsUser = /自托管|部署方|运维手册|operations/i.test(blob) && !/值班|on-?call|内部\s*runbook/i.test(blob)
  const hasOpsMaint = /值班|on-?call|内部\s*runbook/i.test(blob)
  const vagueSiteOnly = /^(?:请)?(?:把|将)?(?:website|文档站|站点文档)(?:写一下|补全|更新)?[.。!！]?$/i.test(text.trim()) ||
    (/写(?:一下)?(?:website|文档站|站点文档)/i.test(text) && !hasUserPhrase && !hasMaintPhrase && !hasReadme && !hasReference)

  const pathUser = /\/(guide|docs\/intro|getting-started|quick-start)\//i.test(pathBlob)
  const pathMaint = /\/(contributing|internals|development|maintainer)\//i.test(pathBlob)

  if (hasUserPhrase) signals.push('phrase:public-user')
  if (hasMaintPhrase) signals.push('phrase:maintainer-dev')
  if (hasReadme) signals.push('phrase:readme')
  if (hasReference) signals.push('phrase:reference')
  if (vagueSiteOnly) signals.push('phrase:vague-site')
  if (pathUser) signals.push('path:user')
  if (pathMaint) signals.push('path:maintainer')

  const userHit = hasUserPhrase || hasReadme || hasReference || hasMigrationUser || hasChangelogUser || hasOpsUser || pathUser
  const maintHit = hasMaintPhrase || hasMigrationImpl || hasChangelogMaint || hasOpsMaint || pathMaint

  if (userHit && maintHit) {
    return {
      docsAudience: 'multi-audience',
      docsSurface: 'other',
      recommendedAudience: null,
      recommendedLabel: null,
      signals,
      status: 'multi-audience',
      failClosed: true
    }
  }

  if (vagueSiteOnly || (!userHit && !maintHit && /文档站|website|站点文档|写文档/i.test(text))) {
    const recommendedAudience = pathMaint ? 'maintainer-dev' : (pathUser || hasReadme ? 'public-user' : 'public-user')
    // path-only vague: still ambiguous if no path; with path can soft-recommend
    const pureVague = vagueSiteOnly || (!pathUser && !pathMaint && !hasReadme)
    if (pureVague) {
      return {
        docsAudience: 'ambiguous',
        docsSurface: 'other',
        recommendedAudience: 'public-user',
        recommendedLabel: '用户使用站点（安装/接入/排错）（推荐）',
        signals: signals.length ? signals : ['phrase:vague-docs'],
        status: 'ambiguous',
        failClosed: true
      }
    }
  }

  if (maintHit) {
    let surface = 'maintainer'
    if (hasMigrationImpl) surface = 'maintainer'
    if (hasChangelogMaint) surface = 'maintainer'
    return {
      docsAudience: 'maintainer-dev',
      docsSurface: surface,
      recommendedAudience: null,
      recommendedLabel: null,
      signals,
      status: 'ok',
      failClosed: false
    }
  }

  if (userHit) {
    let surface = 'guide'
    if (hasReadme) surface = 'readme'
    if (hasReference) surface = 'reference'
    if (hasMigrationUser) surface = 'migration'
    if (hasChangelogUser) surface = 'changelog'
    if (hasOpsUser) surface = 'operations'
    return {
      docsAudience: 'public-user',
      docsSurface: surface,
      recommendedAudience: null,
      recommendedLabel: null,
      signals,
      status: 'ok',
      failClosed: false
    }
  }

  return {
    docsAudience: 'ambiguous',
    docsSurface: 'other',
    recommendedAudience: 'public-user',
    recommendedLabel: '用户使用站点（安装/接入/排错）（推荐）',
    signals: signals.length ? signals : ['none'],
    status: 'ambiguous',
    failClosed: true
  }
}

/**
 * Detect audience drift in drafted doc body for a locked audience.
 * @param {'public-user'|'maintainer-dev'} audience
 * @param {string} body
 * @returns {'ok'|'drift-maintainer-on-user'|'drift-no-dev-path'|'not-applicable'}
 */
function classifyDocsAudienceDriftSample(audience, body) {
  const text = String(body || '')
  if (!text.trim()) return 'not-applicable'

  if (audience === 'public-user') {
    const maintainerPollution = /release\s*checklist|发版清单|monorepo\s*架构|内部台账|ADR\s*列表|contributing\s*流程(?!.*安装)/i.test(text)
    const hasUserPath = /安装|install|快速开始|quick\s*start|第一次|npm\s+i|pnpm\s+add|yarn\s+add|使用/i.test(text)
    if (maintainerPollution && !hasUserPath) return 'drift-maintainer-on-user'
    if (maintainerPollution && /^(?:#|\s)*release\s*checklist/im.test(text.slice(0, 400))) return 'drift-maintainer-on-user'
    return 'ok'
  }

  if (audience === 'maintainer-dev') {
    const hasDevPath = /clone|git\s+clone|npm\s+(?:i|install|test|run)|pnpm|yarn|本地开发|贡献|contributing|环境/i.test(text)
    const onlyProduct = /这是什么|适合谁|产品价值/.test(text) && !hasDevPath
    if (onlyProduct || !hasDevPath) return 'drift-no-dev-path'
    return 'ok'
  }

  return 'not-applicable'
}

/**
 * @param {string} disambiguationText assistant text when status=ambiguous
 * @returns {'ok'|'missing-recommendation'|'preference-menu'}
 */
function classifyDocsAudienceDisambiguationSample(disambiguationText) {
  const text = String(disambiguationText || '')
  const hasRecommended = /推荐|（推荐）|\(推荐\)|recommended/i.test(text)
  const flatMenu = /你希望哪种|选一个|A\s*\/\s*B\s*\/\s*C|A\/B\/C|which would you prefer|pick one of/i.test(text) && !hasRecommended
  if (flatMenu) return 'preference-menu'
  if (!/ambiguous|消歧|受众|public-user|maintainer|用户|维护者|推荐/i.test(text)) {
    return 'missing-recommendation'
  }
  if (!hasRecommended) return 'missing-recommendation'
  return 'ok'
}

/**
 * Cognitive altitude for public-user guide/readme bodies.
 * Detects "complete but unreadable" function-inventory quick starts.
 *
 * @param {string} body markdown or free text
 * @param {{ surface?: string }} [opts]
 * @returns {'ok'|'function-inventory-as-guide'|'concept-dump-no-task'|'ok-reference-dense'|'not-applicable'}
 */
function classifyUserDocsCognitiveAltitudeSample(body, opts = {}) {
  const text = String(body || '')
  if (!text.trim()) return 'not-applicable'

  const surface = String(opts.surface || 'guide').toLowerCase()
  const head = text.slice(0, 1200)

  // Identifier-call chains: foo( bar( or a.b.c( density
  const callLike = (head.match(/\b[A-Za-z_][\w.]*\s*\(/g) || []).length
  const taskLanguage = /你要|完成|目标是|场景|例如你|第一次|安装后|发一条|创建一个|如何|怎么|步骤\s*[1１一]|推荐路径|适合谁/i.test(head)
  const conceptOnly = /架构|生命周期|模型|组件|模块|设计|原理/i.test(head) && !taskLanguage && callLike < 2

  if (surface === 'reference') {
    // Reference may be symbol-dense; still flag pure call lists with zero purpose lines if extreme
    if (callLike >= 8 && !/用途|何时|用于|use when|purpose/i.test(text) && !taskLanguage) {
      return 'function-inventory-as-guide'
    }
    return 'ok-reference-dense'
  }

  // guide / readme / quick start
  if (callLike >= 3 && !taskLanguage) return 'function-inventory-as-guide'
  // quick-start section that is only chained calls
  if (/快速开始|quick\s*start|getting started/i.test(head)) {
    const qs = head.split(/快速开始|quick\s*start|getting started/i)[1] || ''
    const qsCalls = (qs.slice(0, 500).match(/\b[A-Za-z_][\w.]*\s*\(/g) || []).length
    if (qsCalls >= 3 && !/安装|install|npm |pnpm |yarn /i.test(qs.slice(0, 500))) {
      return 'function-inventory-as-guide'
    }
  }
  if (conceptOnly && head.length > 200) return 'concept-dump-no-task'
  return 'ok'
}

/**
 * Whether an assistant reply proactively extended scenarios after a user pain point.
 * @param {string} userMessage
 * @param {string} assistantReply
 * @returns {'ok'|'missing-extension'|'not-applicable'}
 */
function classifyProactiveScenarioExtensionSample(userMessage, assistantReply) {
  const u = String(userMessage || '')
  const a = String(assistantReply || '')
  if (!u.trim() || !a.trim()) return 'not-applicable'
  // User raised a concrete docs/process issue
  const isPain = /问题|看不懂|复杂|场景|还有|为什么|如何处理|痛点|失败/i.test(u)
  if (!isPain) return 'not-applicable'
  // Assistant lists multiple related scenarios (tables, A1/B1, 场景)
  const extendsScenes = (/场景/.test(a) && (a.match(/场景/g) || []).length >= 2) ||
    /\|.*场景.*\|/.test(a) ||
    /A\d|B\d|C\d|同类|延展|还有.*情况|相关失败/i.test(a)
  if (!extendsScenes) return 'missing-extension'
  return 'ok'
}

module.exports = {
  classifyDocsAudienceSample,
  classifyDocsAudienceDriftSample,
  classifyDocsAudienceDisambiguationSample,
  classifyUserDocsCognitiveAltitudeSample,
  classifyProactiveScenarioExtensionSample
}
