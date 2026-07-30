#!/usr/bin/env node
'use strict'

const path = require('path')
const { cleanupPackageProjection } = require('./lib/package-compatibility-projection')

const ROOT = path.resolve(__dirname, '..')
const result = cleanupPackageProjection(ROOT)
process.stderr.write(`[package-projection] postpack ${result.status} removed=${result.removed.length}\n`)
