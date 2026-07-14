'use strict'

const { buildGovernanceIntakeChecks } = require('./validate-governance-intake')
const { buildGovernanceQualityChecks } = require('./validate-governance-quality')
const { buildGovernanceReviewChecks } = require('./validate-governance-review')
const { buildGovernanceExpertChecks } = require('./validate-governance-expert')

function buildGovernanceTailChecks(ctx) {
  return {
    ...buildGovernanceIntakeChecks(ctx),
    ...buildGovernanceQualityChecks(ctx),
    ...buildGovernanceReviewChecks(ctx),
    ...buildGovernanceExpertChecks(ctx)
  }
}

module.exports = { buildGovernanceTailChecks }
