#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  BENCHMARK_INPUT_SCHEMA,
  ExecutionOptimizationError,
  evaluateExecutionChainBenchmark
} = require('./lib/execution-optimization')

function parseArgs(argv) {
  const options = { input: '', output: '', json: false, help: false, errors: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index])
    if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--input' || arg === '--output') {
      const value = argv[index + 1]
      if (!value || String(value).startsWith('--')) options.errors.push(`${arg} requires a path`)
      else {
        options[arg.slice(2)] = path.resolve(String(value))
        index += 1
      }
    } else options.errors.push(`unknown option: ${arg}`)
  }
  if (!options.help && !options.input) options.errors.push('--input is required')
  return options
}

function envelope(ok, data = null, error = null) {
  return { schemaVersion: 'ExecutionChainBenchmarkCliV1', ok, data, error }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write(`Usage: node scripts/benchmark-execution-chain.js --input <${BENCHMARK_INPUT_SCHEMA}.json> [--output <result.json>] [--json]\n`)
    return 0
  }
  if (options.errors.length) {
    const result = envelope(false, null, { code: 'EXECUTION_BENCHMARK_INVALID_OPTION', message: options.errors.join('; ') })
    process.stdout.write((options.json ? JSON.stringify(result, null, 2) : `[${result.error.code}] ${result.error.message}`) + '\n')
    return 2
  }
  try {
    const input = JSON.parse(fs.readFileSync(options.input, 'utf8'))
    const data = evaluateExecutionChainBenchmark(input)
    const result = envelope(true, data, null)
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true })
      fs.writeFileSync(options.output, JSON.stringify(result, null, 2) + '\n', 'utf8')
    }
    if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    else {
      process.stdout.write(`Execution-chain benchmark: ${data.status}; improvement=${data.overallImprovement === null ? 'N/A' : (data.overallImprovement * 100).toFixed(2) + '%'}; improvedDimensions=${data.improvedDimensions}/4\n`)
      if (data.reasons.length) process.stdout.write(`Reasons: ${data.reasons.join(', ')}\n`)
    }
    return data.status === 'rejected' ? 1 : 0
  } catch (error) {
    const code = error instanceof ExecutionOptimizationError ? error.code : 'EXECUTION_BENCHMARK_FAILED'
    const result = envelope(false, null, { code, message: error.message })
    process.stdout.write((options.json ? JSON.stringify(result, null, 2) : `[${code}] ${error.message}`) + '\n')
    return 1
  }
}

if (require.main === module) process.exitCode = main()

module.exports = { envelope, main, parseArgs }
