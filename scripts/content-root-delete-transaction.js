#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  buildDeletePreview,
  finalizeDeleteTransaction,
  rollbackDeleteTransaction,
  stageDeleteTransaction,
  verifyDeletePreview,
  writeJsonAtomic
} = require('./lib/content-root-delete-transaction')

function option (name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

function required (name) {
  const value = option(name)
  if (!value) throw new Error(`missing required option: ${name}`)
  return value
}

function print (value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function main () {
  const root = path.resolve(option('--root') || process.cwd())
  if (process.argv.includes('--create-preview')) {
    const output = path.resolve(required('--output'))
    const preview = buildDeletePreview(root)
    writeJsonAtomic(output, preview)
    print({
      status: 'PASS',
      operation: 'create-preview',
      output,
      previewDigest: preview.previewDigest,
      fileCount: preview.fileCount,
      groups: preview.groups
    })
    return
  }

  const previewPath = path.resolve(required('--preview'))
  if (process.argv.includes('--verify')) {
    print({
      operation: 'verify',
      ...verifyDeletePreview(root, JSON.parse(fs.readFileSync(previewPath, 'utf8')))
    })
    return
  }

  const receiptPath = path.resolve(required('--receipt'))
  if (process.argv.includes('--stage')) {
    print({
      operation: 'stage',
      ...stageDeleteTransaction(
        root,
        previewPath,
        receiptPath,
        required('--expected-preview-digest')
      )
    })
    return
  }
  if (process.argv.includes('--rollback')) {
    print({ operation: 'rollback', ...rollbackDeleteTransaction(root, receiptPath) })
    return
  }
  if (process.argv.includes('--finalize')) {
    print({
      operation: 'finalize',
      ...finalizeDeleteTransaction(
        root,
        receiptPath,
        required('--expected-preview-digest'),
        required('--confirm-finalize')
      )
    })
    return
  }
  throw new Error('choose one operation: --create-preview, --verify, --stage, --rollback, --finalize')
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error.code || 'CONTENT_ROOT_DELETE_FAILED'}: ${error.message}\n`)
  process.exitCode = 1
}
