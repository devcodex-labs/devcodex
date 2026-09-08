const assert = require('node:assert/strict')
const { total } = require('./cart.cjs')
assert.equal(total([]), 0)
