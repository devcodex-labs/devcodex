#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const {
  resolveDefaultActiveRoot
} = require('./lib/runtime-state-index.js')

const SOURCE_ROOT = path.resolve(__dirname, '..')
const HOSTS = ['claude', 'codex', 'copilot', 'gemini', 'grok']
const argv = process.argv.slice(2)

function usage () {
  return [
    'Usage: node scripts/run-skill-route-retirement-sample.js [options]',
    '',
    'Options:',
    '  --host <name[,name...]>  Exact hosts to sample (default: all)',
    '  --root <path>             DevCodex active-root',
    '  --evidence-dir <path>     Evidence output directory',
    '  --timeout-ms <ms>         Per-host probe timeout (default: 900000)',
    '  --max-turns <count>       Grok probe turn limit (default: 32)',
    '  --candidate               Run candidate probes instead of production-eligible probes',
    '  --strict                  Exit non-zero when a probe or the retirement gate blocks',
    '  --help                    Show this help without running probes'
  ].join('\n')
}

function argument (name, fallback = '') {
  const index = argv.indexOf(name)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}

function selectedHosts () {
  const value = argument('--host', 'all').trim().toLowerCase()
  const hosts = value === 'all'
    ? HOSTS
    : value.split(',').map(item => item.trim()).filter(Boolean)
  const invalid = hosts.filter(host => !HOSTS.includes(host))
  if (invalid.length) throw new Error(`Unsupported host(s): ${invalid.join(', ')}`)
  return [...new Set(hosts)]
}

function safeStamp (date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function runProbe (host, evidenceFile, candidate) {
  const script = host === 'grok'
    ? path.join(__dirname, 'probe-skill-route-s15-grok.js')
    : path.join(__dirname, 'probe-skill-route-s15-host.js')
  const args = [script]
  if (host !== 'grok') args.push('--host', host)
  if (!candidate) args.push('--production-eligible')
  args.push('--evidence-output', evidenceFile)
  const timeoutMs = Number.parseInt(argument('--timeout-ms', '900000'), 10)
  if (host === 'grok') {
    args.push('--max-turns', argument('--max-turns', '32'))
  } else {
    args.push('--timeout-ms', String(timeoutMs))
  }
  return spawnSync(process.execPath, args, {
    cwd: SOURCE_ROOT,
    encoding: 'utf8',
    timeout: Math.min(1860000, Math.max(120000, timeoutMs + 60000)),
    maxBuffer: 24 * 1024 * 1024
  })
}

function main () {
  if (argv.includes('--help')) {
    process.stdout.write(`${usage()}\n`)
    return
  }
  const candidate = argv.includes('--candidate')
  const activeRoot = path.resolve(
    argument(
      '--root',
      process.env.DEVCODEX_ACTIVE_ROOT || resolveDefaultActiveRoot(SOURCE_ROOT)
    )
  )
  const evidenceDir = path.resolve(
    argument('--evidence-dir', path.join(activeRoot, '.audit-state'))
  )
  fs.mkdirSync(evidenceDir, { recursive: true })
  const stamp = safeStamp()
  const batchId = crypto.randomUUID()
  const runs = []

  for (const host of selectedHosts()) {
    const evidenceFile = path.join(
      evidenceDir,
      `skill-route-s15-${host}-${candidate ? 'candidate' : 'production'}-${stamp}-${crypto.randomUUID()}.json`
    )
    const result = runProbe(host, evidenceFile, candidate)
    runs.push({
      host,
      status: result.status === 0 ? 'PASS' : 'BLOCK',
      exitCode: result.status,
      signal: result.signal || null,
      evidenceFile: result.status === 0 ? evidenceFile : null,
      failureFile: fs.existsSync(`${evidenceFile}.failure.json`)
        ? `${evidenceFile}.failure.json`
        : null,
      stdoutTail: String(result.stdout || '').slice(-2000),
      stderrTail: String(result.stderr || '').slice(-2000)
    })
  }

  const gateRun = spawnSync(process.execPath, [
    path.join(__dirname, 'check-skill-route-retirement.js'),
    '--root', activeRoot,
    '--evidence-dir', evidenceDir
  ], {
    cwd: SOURCE_ROOT,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024
  })
  let gateReceipt = null
  try {
    gateReceipt = JSON.parse(gateRun.stdout)
  } catch {}
  const receipt = {
    schemaVersion: 'SkillRouteSamplingBatchReceiptV1',
    batchId,
    mode: candidate ? 'candidate' : 'production-eligible',
    startedAt: stamp,
    completedAt: new Date().toISOString(),
    activeRoot,
    evidenceDir,
    runs,
    gate: gateReceipt?.gate || null,
    gateCheckExitCode: gateRun.status,
    transport: {
      kind: 'local-stdio',
      networkListener: false,
      longRunningServiceStarted: false
    }
  }
  const receiptFile = path.join(
    evidenceDir,
    `skill-route-sampling-${stamp}-${batchId}.json`
  )
  fs.writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ ...receipt, receiptFile }, null, 2)}\n`)
  if (argv.includes('--strict') &&
      (runs.some(run => run.status !== 'PASS') || receipt.gate?.status !== 'PASS')) {
    process.exitCode = 1
  }
}

if (require.main === module) main()

module.exports = {
  HOSTS,
  safeStamp,
  selectedHosts,
  usage
}
