import { useEffect, useMemo, useState } from 'react'
import projection from '../data/public-product-projection.json'
import './skill-catalog.css'

type LifecycleState = 'active' | 'gray' | string

type PublicSkill = {
  id: string
  name: string
  description: string
  lifecycleState: LifecycleState
  publicCategory: string
}

type PublicCategory = {
  id: string
  label: string
  description: string
  count: number
  active: number
  gray: number
  representativeSkills: PublicSkill[]
}

type PublicSkillProjection = {
  total: number
  active: number
  gray: number
  categories: PublicCategory[]
  catalog: PublicSkill[]
  extensionPolicy: {
    extensionSource: string
    includedInAssignments: boolean
    includedInBundledCounts: boolean
    description: string
  }
}

const skillProjection = projection.skills as PublicSkillProjection
const categoryIds = new Set(skillProjection.categories.map(category => category.id))

export function filterSkillCatalog (
  catalog: PublicSkill[],
  query: string,
  category: string,
  lifecycle: string
) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return catalog.filter(skill => {
    const matchesCategory = category === 'all' || skill.publicCategory === category
    const matchesLifecycle = lifecycle === 'all' || skill.lifecycleState === lifecycle
    const searchable = `${skill.id}\n${skill.name}\n${skill.description}`.toLocaleLowerCase()
    return matchesCategory && matchesLifecycle && (!normalizedQuery || searchable.includes(normalizedQuery))
  })
}

function queryCategory () {
  if (typeof window === 'undefined') return 'all'
  const candidate = new URLSearchParams(window.location.search).get('category') || 'all'
  return categoryIds.has(candidate) ? candidate : 'all'
}

export function SkillCatalog () {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [lifecycle, setLifecycle] = useState('all')

  useEffect(() => {
    setCategory(queryCategory())
  }, [])

  const filtered = useMemo(
    () => filterSkillCatalog(skillProjection.catalog, query, category, lifecycle),
    [query, category, lifecycle]
  )

  function selectCategory (nextCategory: string) {
    setCategory(nextCategory)
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (nextCategory === 'all') url.searchParams.delete('category')
    else url.searchParams.set('category', nextCategory)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  function resetFilters () {
    setQuery('')
    setLifecycle('all')
    selectCategory('all')
  }

  return (
    <section className="devcodex-skill-catalog" aria-labelledby="devcodex-skill-catalog-title">
      <div className="devcodex-skill-catalog-heading">
        <div>
          <p className="devcodex-skill-eyebrow">Bundled catalog</p>
          <h2 id="devcodex-skill-catalog-title">完整 Skill 目录</h2>
          <p>
            当前共 {skillProjection.total} 项：{skillProjection.active} active、{skillProjection.gray} gray。
            默认服务端渲染全部条目；筛选只改变当前视图，不改变运行时加载状态。
          </p>
        </div>
        <span className="devcodex-skill-total" aria-label={`${skillProjection.total} 个 bundled Skill`}>
          {skillProjection.total}
        </span>
      </div>

      <div className="devcodex-skill-category-grid" aria-label="Skill 公开分类">
        {skillProjection.categories.map(item => (
          <a
            key={item.id}
            className={category === item.id ? 'is-selected' : ''}
            href={`?category=${item.id}`}
            onClick={(event) => {
              event.preventDefault()
              selectCategory(item.id)
            }}
          >
            <span>{item.label}</span>
            <strong>{item.count}</strong>
            <small>{item.active} active{item.gray ? ` · ${item.gray} gray` : ''}</small>
          </a>
        ))}
      </div>

      <div className="devcodex-skill-filters" role="search" aria-label="筛选 Skill 目录">
        <label>
          <span>关键词</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索 ID、名称或说明"
          />
        </label>
        <label>
          <span>分类</span>
          <select value={category} onChange={event => selectCategory(event.target.value)}>
            <option value="all">全部分类</option>
            {skillProjection.categories.map(item => (
              <option key={item.id} value={item.id}>{item.label}（{item.count}）</option>
            ))}
          </select>
        </label>
        <label>
          <span>生命周期</span>
          <select value={lifecycle} onChange={event => setLifecycle(event.target.value)}>
            <option value="all">全部状态</option>
            <option value="active">active</option>
            <option value="gray">gray</option>
          </select>
        </label>
        <button type="button" onClick={resetFilters}>重置</button>
      </div>

      <p className="devcodex-skill-result" aria-live="polite">
        显示 {filtered.length} / {skillProjection.total}
      </p>

      {filtered.length > 0
        ? (
          <div className="devcodex-skill-grid">
            {filtered.map(skill => (
              <article key={skill.id} className="devcodex-skill-card" data-skill-id={skill.id}>
                <div className="devcodex-skill-card-meta">
                  <code>{skill.id}</code>
                  <span className={`devcodex-skill-state is-${skill.lifecycleState}`}>{skill.lifecycleState}</span>
                </div>
                <h3>{skill.name}</h3>
                <p>{skill.description}</p>
                <span className="devcodex-skill-category">
                  {skillProjection.categories.find(item => item.id === skill.publicCategory)?.label}
                </span>
              </article>
            ))}
          </div>
          )
        : (
          <div className="devcodex-skill-empty" role="status">
            没有匹配项。请清空关键词或重置分类与生命周期筛选。
          </div>
          )}

      <aside className="devcodex-workspace-skill-note">
        <strong>Workspace Skill 不计入上述分母。</strong>
        <span>{skillProjection.extensionPolicy.description}</span>
      </aside>
    </section>
  )
}
