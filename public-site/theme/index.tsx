import { HomeLayout as DefaultHomeLayout, Link } from '@rspress/core/theme-original'
import projection from '../data/public-product-projection.json'
import './index.css'

type CapabilityScenario = {
  id: string
  userProblem: string
  userOutcome: string
  representativeSkillIds: string[]
  skillFocus: string
  workflowBoundary: string
  nextHref: string
}

const scenarios = projection.capabilityScenarios as CapabilityScenario[]
const projectionDate = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'UTC'
}).format(new Date(projection.generatedAt))

function CapabilityShowcase () {
  return (
    <main className="devcodex-home-content">
      <section className="devcodex-home-intro" aria-labelledby="devcodex-home-value">
        <p className="devcodex-home-eyebrow">安装后实际得到的增强</p>
        <h2 id="devcodex-home-value">不只是换一个入口，而是把专业工程流程带进宿主</h2>
        <p>
          DevCodex 已登记 {projection.skills.total} 个 Skill（{projection.skills.active} active、{projection.skills.gray} gray）。
          它们不会一次性塞进会话，而是随任务意图和阶段渐进路由，让需要的专业路径在需要时进入工作。
        </p>
        <p className="devcodex-home-freshness">
          当前文档事实：DevCodex v{projection.release.version} · 投影更新于 {projectionDate}
        </p>
      </section>

      <section className="devcodex-home-section" aria-labelledby="devcodex-home-scenarios">
        <div className="devcodex-home-section-heading">
          <p className="devcodex-home-eyebrow">你会在哪些地方感觉到差异</p>
          <h2 id="devcodex-home-scenarios">四类从安装到结果的能力场景</h2>
        </div>
        <div className="devcodex-capability-grid">
          {scenarios.map((scenario, index) => (
            <Link
              key={scenario.id}
              href={scenario.nextHref}
              className="devcodex-capability-card"
              aria-label={'查看：' + scenario.userProblem}
            >
              <span className="devcodex-capability-index">0{index + 1}</span>
              <h3>{scenario.userProblem}</h3>
              <p>{scenario.userOutcome}</p>
              <span className="devcodex-capability-focus">代表专业流程：{scenario.skillFocus}</span>
              <span className="devcodex-capability-boundary">{scenario.workflowBoundary}</span>
              <span className="devcodex-capability-link">进入完整教程 →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="devcodex-host-split" aria-labelledby="devcodex-host-split-title">
        <div>
          <p className="devcodex-home-eyebrow">和宿主的分工</p>
          <h2 id="devcodex-host-split-title">需要的是增强，不是替代</h2>
        </div>
        <div className="devcodex-host-split-grid">
          <article>
            <h3>直接使用宿主</h3>
            <p>一次性问答、短小编辑或依赖某个原生工具时，宿主最快。</p>
          </article>
          <article>
            <h3>使用 DevCodex</h3>
            <p>跨文件、需确认、需验证、需交接或换会话继续时，把项目上下文和专业路径一起带上。</p>
          </article>
          <article>
            <h3>两者可以共存</h3>
            <p>宿主继续提供模型、编辑器和原生工具；DevCodex 不接管你的原生 Skill、指令或个人配置。</p>
          </article>
        </div>
      </section>
    </main>
  )
}

function FirstSuccessLine () {
  return (
    <section className="devcodex-first-success" aria-labelledby="devcodex-first-success-title">
      <p className="devcodex-home-eyebrow">第一次成功路径</p>
      <h2 id="devcodex-first-success-title">五步确认已经可用</h2>
      <ol>
        <li>全局安装 DevCodex</li>
        <li>在真实项目根执行 devcodex init</li>
        <li>用 devcodex status 和 doctor 检查状态</li>
        <li>完全重新打开目标宿主会话</li>
        <li>先发送一条只读分析任务，再按结果进入下一步</li>
      </ol>
      <Link href="/guide/getting-started" className="devcodex-first-success-link">
        按 5 分钟开始完成首次验证 →
      </Link>
    </section>
  )
}

function HomeLayout () {
  return (
    <DefaultHomeLayout
      afterHero={<CapabilityShowcase />}
      afterFeatures={<FirstSuccessLine />}
    />
  )
}

export { HomeLayout }
export * from '@rspress/core/theme-original'
