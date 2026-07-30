#!/usr/bin/env node
'use strict'

const path = require('path')
const { cleanupPackageProjection } = require('./lib/package-compatibility-projection')

const ROOT = path.resolve(__dirname, '..')
const result = cleanupPackageProjection(ROOT)
process.stdout.write(`${JSON.stringify(result)}\n`)
