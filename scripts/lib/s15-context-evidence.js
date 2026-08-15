'use strict'

function contextAcquisitionObservedTools (contextAcquisition) {
  const postHistory = Array.isArray(contextAcquisition?.postHistory)
    ? contextAcquisition.postHistory
    : []
  if (postHistory.length) {
    return [...new Set(postHistory
      .map(item => String(item?.canonical || '').trim())
      .filter(Boolean))]
  }
  const observations = Array.isArray(contextAcquisition?.receipt?.observations)
    ? contextAcquisition.receipt.observations
    : []
  const observed = ['devcodex-profile/profile_context_plan']
  if (observations.some(item =>
    item?.successful === true &&
    item?.outcome === 'observed-success' &&
    item?.sourceKind === 'profile'
  )) {
    observed.push('devcodex-profile/profile_load')
  }
  if (observations.some(item =>
    item?.successful === true &&
    item?.outcome === 'observed-success' &&
    item?.sourceKind === 'memory'
  )) {
    observed.push('devcodex-memory/memory_status')
  }
  return [...new Set(observed)]
}

function contextAcquisitionObservationMode (contextAcquisition) {
  if (Array.isArray(contextAcquisition?.postHistory) && contextAcquisition.postHistory.length) {
    return 'hook-post-history'
  }
  if (Array.isArray(contextAcquisition?.receipt?.observations)) {
    return 'structured-context-receipt'
  }
  return 'unobserved'
}

module.exports = {
  contextAcquisitionObservationMode,
  contextAcquisitionObservedTools
}
