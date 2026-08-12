'use strict'

const identity = require('./host-adapter-identity.cjs')
const {
  getCompatibleLifecycleHostAdapterDigest
} = require('./compatible-host-adapter-identity.cjs')

identity.getLifecycleHostAdapterDigest = getCompatibleLifecycleHostAdapterDigest
