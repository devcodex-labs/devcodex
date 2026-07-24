#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  classifyDocsAudienceSample,
  classifyDocsAudienceDriftSample,
  classifyDocsAudienceDisambiguationSample,
  classifyUserDocsCognitiveAltitudeSample,
  classifyProactiveScenarioExtensionSample
} = require('./lib/docs-audience-intent')

// Positive: user guide
{
  const r = classifyDocsAudienceSample('写开源用户使用文档站，包含安装和快速开始')
  assert.strictEqual(r.docsAudience, 'public-user')
  assert.strictEqual(r.status, 'ok')
  assert.ok(['guide', 'readme'].includes(r.docsSurface) || r.docsSurface === 'guide')
}

// Positive: reference → public-user
{
  const r = classifyDocsAudienceSample('写 API 参考文档和 CLI 说明')
  assert.strictEqual(r.docsAudience, 'public-user')
  assert.strictEqual(r.docsSurface, 'reference')
}

// Positive: maintainer
{
  const r = classifyDocsAudienceSample('写维护者开发站点文档，包含 clone、测试与贡献流程')
  assert.strictEqual(r.docsAudience, 'maintainer-dev')
  assert.strictEqual(r.status, 'ok')
}

// Negative 1: vague website → ambiguous + recommended
{
  const r = classifyDocsAudienceSample('把 website 写一下')
  assert.strictEqual(r.docsAudience, 'ambiguous')
  assert.strictEqual(r.failClosed, true)
  assert.strictEqual(r.recommendedAudience, 'public-user')
  assert.ok(r.recommendedLabel && /推荐/.test(r.recommendedLabel))
}

// Negative 2: user task body polluted with release checklist first screen
{
  const drift = classifyDocsAudienceDriftSample(
    'public-user',
    '# Release checklist\n\n- tag\n- publish\n\n内部台账状态\n'
  )
  assert.strictEqual(drift, 'drift-maintainer-on-user')
}

// Negative 3: maintainer body without dev path
{
  const drift = classifyDocsAudienceDriftSample(
    'maintainer-dev',
    '# 产品介绍\n\n这是什么\n适合谁\n产品价值巨大\n'
  )
  assert.strictEqual(drift, 'drift-no-dev-path')
}

// Multi-audience must split
{
  const r = classifyDocsAudienceSample('同时写用户使用文档和维护者贡献指南')
  assert.strictEqual(r.docsAudience, 'multi-audience')
  assert.strictEqual(r.failClosed, true)
}
{
  const r = classifyDocsAudienceSample('写用户文档和贡献指南')
  assert.strictEqual(r.docsAudience, 'multi-audience', 'user doc + contributing guide must split')
  assert.strictEqual(r.failClosed, true)
}

// Disambiguation must carry unique recommendation
{
  assert.strictEqual(
    classifyDocsAudienceDisambiguationSample('受众不明，推荐用户使用站点（推荐），备选维护者开发站'),
    'ok'
  )
  assert.strictEqual(
    classifyDocsAudienceDisambiguationSample('你希望哪种？A/B/C 选一个'),
    'preference-menu'
  )
}

// Healthy user body ok
{
  assert.strictEqual(
    classifyDocsAudienceDriftSample(
      'public-user',
      '# 安装\n\nnpm i foo\n\n## 快速开始\n\n第一次运行…\n'
    ),
    'ok'
  )
}

// Healthy maintainer body ok
{
  assert.strictEqual(
    classifyDocsAudienceDriftSample(
      'maintainer-dev',
      '# 开发\n\ngit clone …\nnpm install\nnpm test\n\n## 贡献\n'
    ),
    'ok'
  )
}

// Cognitive altitude: function inventory as guide
{
  const bad = `# 快速开始

createRuntime(opts)
registerPlugin(p)
resolveContext(ctx)
dispatch(event)
`
  assert.strictEqual(
    classifyUserDocsCognitiveAltitudeSample(bad, { surface: 'guide' }),
    'function-inventory-as-guide'
  )
}

// Cognitive altitude: task language ok
{
  const good = `# 快速开始

你要完成：用 SDK 发一条消息。

1. 安装依赖 npm i foo
2. 使用推荐入口 sendMessage
3. 看到成功回执

深入装配见 Reference。
`
  assert.strictEqual(
    classifyUserDocsCognitiveAltitudeSample(good, { surface: 'guide' }),
    'ok'
  )
}

// Reference may be denser
{
  assert.strictEqual(
    classifyUserDocsCognitiveAltitudeSample(
      '## sendMessage\n用途：发送消息\nsendMessage(x)\n',
      { surface: 'reference' }
    ),
    'ok-reference-dense'
  )
}

// Proactive scenario extension
{
  assert.strictEqual(
    classifyProactiveScenarioExtensionSample(
      '文档完整但底层函数看不懂怎么办',
      '除了函数清单，还有这些场景：A1… B1… 同类失败还包括配置字典当使用说明。'
    ),
    'ok'
  )
  assert.strictEqual(
    classifyProactiveScenarioExtensionSample(
      '文档完整但底层函数看不懂怎么办',
      '可以写得通俗一点。'
    ),
    'missing-extension'
  )
}

console.log('docs-audience-intent tests passed')
