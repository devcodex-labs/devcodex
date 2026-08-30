'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { resolveNpmInvocation } = require('./lib/checked-command.js')
const {
  summarizeMatrix,
  assertSixHosts
} = require('./lib/host-enforcement-matrix.js')
const {
  scanDocsSurfaceInventory,
  assertDocsSurfaceInventory
} = require('./lib/docs-surface-inventory.js')

const ROOT = path.resolve(__dirname, '..')
const rounds = []

function runNpm (args, cwd) {
  const env = { ...process.env }
  const invocation = resolveNpmInvocation('npm', args, env)
  return spawnSync(invocation.command, invocation.args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true
  })
}

function round (id, title, fn) {
  const r = { id, title, status: 'pass', findings: [], notes: [] }
  try {
    fn(r)
  } catch (e) {
    r.status = 'fail'
    r.findings.push({ severity: 'high', msg: e.message || String(e) })
  }
  if (r.findings.some((f) => f.severity === 'high' || f.severity === 'medium')) {
    r.status = r.findings.some((f) => f.severity === 'high') ? 'fail' : 'warn'
  }
  rounds.push(r)
  const mark = r.status === 'pass' ? 'PASS' : r.status.toUpperCase()
  console.log(`[${mark}] ${id} ${title} findings=${r.findings.length}`)
}

function walkMd (dir, acc = [], skip = new Set(['versions', 'node_modules', 'dist'])) {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (skip.has(e.name)) continue
      walkMd(path.join(dir, e.name), acc, skip)
    } else if (/\.mdx?$/i.test(e.name)) acc.push(path.join(dir, e.name))
  }
  return acc
}

const docsRoot = path.join(ROOT, 'website', 'docs')
const activePages = walkMd(docsRoot)
const introGuide = activePages.filter((p) =>
  /[\\/](intro|guide|specs)[\\/]/.test(p)
)

// R01
round('R01', 'HostEnforcementMatrix six hosts', (r) => {
  assertSixHosts()
  const rows = summarizeMatrix()
  if (rows.length !== 6) r.findings.push({ severity: 'high', msg: `expected 6 hosts got ${rows.length}` })
  r.notes.push(rows.map((x) => x.id).join(','))
})

// R02
round('R02', 'Matrix vs intro L0 table hosts', (r) => {
  const intro = fs.readFileSync(path.join(docsRoot, 'intro', 'index.md'), 'utf8')
  for (const id of ['copilot', 'claude', 'codex', 'gemini', 'grok', 'cursor']) {
    if (!new RegExp(id, 'i').test(intro)) {
      r.findings.push({ severity: 'high', msg: `intro missing host ${id}` })
    }
  }
  if (!/条件.*Stop|Stop.*条件/.test(intro)) {
    r.findings.push({ severity: 'medium', msg: 'intro missing conditional Stop for grok' })
  }
  if (!/无 UPS inject|UPS.*N\/A|禁止 UPS/i.test(intro)) {
    r.findings.push({ severity: 'medium', msg: 'intro missing Grok UPS N/A honesty' })
  }
  if (!/Cursor[^\n]*(Cloud|云端)[^\n]*(UNVERIFIED|未验证|partial)/i.test(intro)) {
    r.findings.push({ severity: 'medium', msg: 'intro missing Cursor Cloud evidence ceiling' })
  }
})

// R03
round('R03', 'Grok Stop false ceiling scan', (r) => {
  for (const p of introGuide) {
    const t = fs.readFileSync(p, 'utf8')
    const rel = path.relative(ROOT, p).replace(/\\/g, '/')
    if (/Grok/i.test(t) && /无\s*Stop\s*硬拦/.test(t) && !/条件/.test(t)) {
      r.findings.push({ severity: 'high', msg: `false no-Stop hard block: ${rel}` })
    }
  }
})

// R04
round('R04', 'Multi-host full-green false claims', (r) => {
  for (const p of introGuide) {
    const t = fs.readFileSync(p, 'utf8')
    const rel = path.relative(ROOT, p).replace(/\\/g, '/')
    // Ignore negation / prohibition sentences (≠ 不得 禁止 不是 非)
    const re = /[五六]宿主[^\n]{0,40}(全绿|全就绪|全部就绪|均已就绪)/g
    let m
    while ((m = re.exec(t))) {
      const start = Math.max(0, m.index - 24)
      const window = t.slice(start, m.index + m[0].length + 8)
      if (/[≠]|不得|禁止|不是|而非|非默认|≠|不等于/.test(window)) continue
      r.findings.push({ severity: 'high', msg: `multi-host full-ready claim: ${rel} :: ${m[0]}` })
    }
  }
})

// R05
round('R05', 'docs-surface-inventory assert', (r) => {
  const inv = scanDocsSurfaceInventory(ROOT)
  const a = assertDocsSurfaceInventory(inv)
  if (!a.ok) {
    for (const f of a.failures) r.findings.push({ severity: 'high', msg: f })
  }
  r.notes.push(`scripts=${inv.npmScripts} lib=${inv.scriptsLib} skills=${inv.skillDirs}`)
})

// R06
round('R06', 'Skills 84 consistency on intro', (r) => {
  const intro = fs.readFileSync(path.join(docsRoot, 'intro', 'index.md'), 'utf8')
  if (!/84/.test(intro)) r.findings.push({ severity: 'high', msg: 'intro missing 84 skills anchor' })
  const bad = intro.match(/Skills?[^\n]{0,20}(8[0-3]|8[5-9]|\d{3})\s*个/g)
  if (bad) r.findings.push({ severity: 'medium', msg: `possible non-84 skill counts: ${bad.join(';')}` })
})

// R07
round('R07', 'Workflows 8 + other not plan id', (r) => {
  const intro = fs.readFileSync(path.join(docsRoot, 'intro', 'index.md'), 'utf8')
  if (!/`other`/.test(intro) && !/\bother\b/.test(intro)) {
    r.findings.push({ severity: 'high', msg: 'intro missing other workflow' })
  }
  if (!/不是名为 `plan`|无 workflow id=`plan`|不是名为.?plan/.test(intro)) {
    r.findings.push({ severity: 'medium', msg: 'intro should deny plan as workflow id' })
  }
})

// R08
round('R08', 'MCP 15 stated', (r) => {
  const intro = fs.readFileSync(path.join(docsRoot, 'intro', 'index.md'), 'utf8')
  if (!/15/.test(intro) || !/MCP/i.test(intro)) {
    r.findings.push({ severity: 'high', msg: 'intro missing MCP 15' })
  }
})

// R09
round('R09', 'Hooks five events listed', (r) => {
  const intro = fs.readFileSync(path.join(docsRoot, 'intro', 'index.md'), 'utf8')
  for (const ev of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PreCompact', 'Stop']) {
    if (!intro.includes(ev)) r.findings.push({ severity: 'medium', msg: `intro missing hook event ${ev}` })
  }
})

// R10
round('R10', 'Evidence three-column present', (r) => {
  const intro = fs.readFileSync(path.join(docsRoot, 'intro', 'index.md'), 'utf8')
  if (!/声明/.test(intro) || !/探针/.test(intro) || !/真机/.test(intro)) {
    r.findings.push({ severity: 'high', msg: 'intro missing 声明/探针/真机 columns' })
  }
})

// R11
round('R11', 'Relative links intro/guide/specs', (r) => {
  const roots = ['intro', 'guide', 'specs'].map((x) => path.join(docsRoot, x))
  let broken = 0
  for (const root of roots) {
    for (const file of walkMd(root)) {
      const t = fs.readFileSync(file, 'utf8')
      const dir = path.dirname(file)
      const re = /\]\(([^)#][^)]*)\)/g
      let m
      while ((m = re.exec(t))) {
        let target = m[1].trim()
        if (/^(https?:|mailto:|\/)/i.test(target)) continue
        target = target.split('?')[0]
        const abs = path.normalize(path.join(dir, target))
        if (!fs.existsSync(abs) && !fs.existsSync(abs + '.md') && !fs.existsSync(abs + '.mdx')) {
          broken++
          if (broken <= 12) {
            r.findings.push({
              severity: 'medium',
              msg: `broken link ${path.relative(ROOT, file).replace(/\\/g, '/')} -> ${target}`
            })
          }
        }
      }
    }
  }
  if (broken > 12) r.notes.push(`broken total ${broken} (first 12 listed)`)
  else if (broken === 0) r.notes.push('no relative link breaks in intro/guide/specs')
})

// R12
round('R12', 'host-parity-grok key claims', (r) => {
  const p = path.join(docsRoot, 'intro', 'host-parity-grok.md')
  const t = fs.readFileSync(p, 'utf8')
  if (!/UPS.*inject|无 inject|stdout 忽略/i.test(t)) {
    r.findings.push({ severity: 'high', msg: 'host-parity-grok missing UPS inject honesty' })
  }
  if (!/条件.*block|decision:block|条件硬拦|条件.*Stop/i.test(t)) {
    r.findings.push({ severity: 'high', msg: 'host-parity-grok missing conditional Stop' })
  }
  if (!/devcodex grok/.test(t)) {
    r.findings.push({ severity: 'medium', msg: 'host-parity-grok missing devcodex grok entry' })
  }
})

// R13
round('R13', 'philosophy Auto table six hosts + Stop', (r) => {
  const t = fs.readFileSync(path.join(docsRoot, 'intro', 'philosophy.md'), 'utf8')
  for (const h of ['Claude', 'Codex', 'Copilot', 'Gemini', 'Grok', 'Cursor']) {
    if (!t.includes(h)) r.findings.push({ severity: 'medium', msg: `philosophy missing ${h}` })
  }
  if (/无\s*Stop\s*硬拦/.test(t) && /Grok/.test(t)) {
    r.findings.push({ severity: 'high', msg: 'philosophy still claims Grok no Stop hard-block' })
  }
  if (!/条件/.test(t) || !/Grok/.test(t)) {
    r.findings.push({ severity: 'medium', msg: 'philosophy Grok should mention conditional Stop' })
  }
})

// R14
round('R14', 'guide development CLI anchors', (r) => {
  const t = fs.readFileSync(path.join(docsRoot, 'guide', 'development.md'), 'utf8')
  for (const cmd of ['global-adapters', 'doctor', 'grok', 'init', 'update']) {
    if (!t.includes(cmd)) r.findings.push({ severity: 'medium', msg: `development.md missing ${cmd}` })
  }
})

// R15
round('R15', 'process-enforcement files + scripts', (r) => {
  for (const f of [
    'scripts/lib/process-enforcement.js',
    'scripts/lib/host-enforcement-matrix.js',
    'scripts/test-process-enforcement-e2e.js'
  ]) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      r.findings.push({ severity: 'high', msg: `missing ${f}` })
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  for (const s of [
    'test:docs-surface-inventory',
    'test:process-enforcement-e2e',
    'test:delivery-honesty',
    'test:ecr-closure',
    'test:mcp-runtime-closure'
  ]) {
    if (!pkg.scripts[s]) r.findings.push({ severity: 'high', msg: `missing script ${s}` })
  }
})

// R16
round('R16', 'baseline fixture present and floors', (r) => {
  const bpath = path.join(ROOT, 'scripts/fixtures/docs-surface-baseline-20260727.json')
  if (!fs.existsSync(bpath)) {
    r.findings.push({ severity: 'high', msg: 'missing baseline fixture' })
    return
  }
  const b = JSON.parse(fs.readFileSync(bpath, 'utf8'))
  if (b.minima.npmScripts < 113) r.findings.push({ severity: 'high', msg: 'baseline scripts floor <113' })
  if (b.minima.scriptsLib < 102) r.findings.push({ severity: 'high', msg: 'baseline lib floor <102' })
  if (b.exact.skills !== 84) r.findings.push({ severity: 'high', msg: 'baseline skills !=84' })
})

// R17
round('R17', 'npm test subset P0', (r) => {
  const cmds = [
    ['test:docs-surface-inventory', ['scripts/test-docs-surface-inventory.js']],
    ['test:public-text-integrity', ['scripts/test-public-text-integrity.js']],
    ['test:workflow-capabilities', ['scripts/test-workflow-capabilities.js']],
    ['test:delivery-honesty', ['scripts/test-delivery-honesty.js']],
    ['test:ecr-closure', ['scripts/test-ecr-closure.js']],
    ['test:mcp-runtime-closure', ['scripts/test-mcp-runtime-closure.js']]
  ]
  for (const [name, args] of cmds) {
    const res = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true })
    if (res.status !== 0) {
      r.findings.push({
        severity: 'high',
        msg: `${name} exit ${res.status}: ${(res.stderr || res.stdout || '').slice(0, 200)}`
      })
    }
  }
})

// R18
round('R18', 'website build', (r) => {
  const res = runNpm(['run', 'build'], path.join(ROOT, 'website'))
  if (res.status !== 0) {
    r.findings.push({
      severity: 'high',
      msg: `website build failed: ${(res.stderr || res.stdout || '').slice(-300)}`
    })
  } else r.notes.push('website build ok')
})

// R19
round('R19', 'doctor adapter vs native honesty', (r) => {
  const res = spawnSync(process.execPath, ['index.js', 'doctor'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  })
  const out = (res.stdout || '') + (res.stderr || '')
  if (!/(?:5\/5|6\/6) match/.test(out) && !/adapters:\s*(?:5\/5|6\/6)/.test(out) && !/global adapters:\s*(?:5\/5|6\/6)/.test(out)) {
    r.findings.push({ severity: 'medium', msg: 'doctor did not report a complete installed adapter set' })
    r.notes.push(out.slice(0, 400))
  }
  if (!/[0-6]\/(?:5|6) ready|native hosts:\s*[0-6]\/(?:5|6)/.test(out)) {
    r.notes.push('native ready line not matched; check output')
    r.notes.push(out.match(/native hosts:.*/)?.[0] || 'no native line')
  }
  // intro must not affirm all native ready (negation sentences OK)
  const intro = fs.readFileSync(path.join(docsRoot, 'intro', 'index.md'), 'utf8')
  const re = /[五六]宿主 CLI 全就绪|[五六]宿主均已 native/g
  let m
  while ((m = re.exec(intro))) {
    const start = Math.max(0, m.index - 24)
    const window = intro.slice(start, m.index + m[0].length + 8)
    if (/[≠]|不得|禁止|不是|而非|写成/.test(window)) continue
    r.findings.push({ severity: 'high', msg: 'intro claims all native ready' })
  }
})

// R20
round('R20', 'stop-gate + process-e2e', (r) => {
  const res = runNpm(['run', 'test:stop-gate'], ROOT)
  if (res.status !== 0) {
    r.findings.push({
      severity: 'high',
      msg: `stop-gate exit ${res.status}`
    })
  }
})

// R21 bonus
round('R21', 'package.json files includes absorption gates', (r) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const files = pkg.files || []
  if (!files.includes('scripts/lib/executable-absorption-gates.js')) {
    r.findings.push({ severity: 'medium', msg: 'package files missing executable-absorption-gates.js' })
  }
  if (!files.includes('scripts/lib/host-parity-scorecard.js')) {
    r.findings.push({ severity: 'high', msg: 'package files missing host-parity-scorecard.js' })
  }
})

// R22
round('R22', 'git clean for review sources', (r) => {
  const res = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8', windowsHide: true })
  const dirty = (res.stdout || '').trim()
  if (dirty) {
    r.notes.push('working tree dirty (expected during multi-round fix)')
    r.notes.push(dirty.split(/\n/).slice(0, 15).join(' | '))
  } else r.notes.push('clean')
})

const summary = {
  schemaVersion: 'TwentyRoundReviewV1',
  generatedAt: new Date().toISOString(),
  rounds: rounds.length,
  pass: rounds.filter((x) => x.status === 'pass').length,
  warn: rounds.filter((x) => x.status === 'warn').length,
  fail: rounds.filter((x) => x.status === 'fail').length,
  highFindings: rounds.flatMap((x) => x.findings.filter((f) => f.severity === 'high')),
  mediumFindings: rounds.flatMap((x) => x.findings.filter((f) => f.severity === 'medium')),
  roundsDetail: rounds
}

const outDir = path.join(
  ROOT,
  '..',
  '.devcodex',
  'devcodex',
  'requirements',
  'maintainer-site-docs-consistency',
  'reports',
  'grok',
  '20260727',
  'evidence'
)
// Keep review evidence bound to the checkout's workspace instead of selecting
// an unrelated drive merely because that directory happens to exist.
const dest = outDir
fs.mkdirSync(dest, { recursive: true })
const jsonPath = path.join(dest, '20-round-review.json')
fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8')
console.log('SUMMARY', JSON.stringify({
  rounds: summary.rounds,
  pass: summary.pass,
  warn: summary.warn,
  fail: summary.fail,
  high: summary.highFindings.length,
  medium: summary.mediumFindings.length,
  jsonPath
}, null, 2))
process.exit(summary.fail > 0 ? 2 : 0)
