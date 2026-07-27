'use strict'

/**
 * SkillsDeployModeV1 — hidden (default) vs legacy full scan-tree deploy.
 * Spec: requirements/全局Skill与插件隐蔽运行时/02-技术方案.md v2.0
 */

const path = require('path')

const MODES = Object.freeze(['hidden', 'legacy'])

function normalizeSkillsDeployMode (raw) {
  const value = String(raw || '').trim().toLowerCase()
  if (!value) return null
  if (value === 'hidden' || value === 'hook-only-hidden') return 'hidden'
  if (value === 'legacy' || value === 'legacy-full-tree' || value === 'visible') return 'legacy'
  return null
}

/**
 * Priority: options.skillsDeployMode → env DEVCODEX_SKILLS_DEPLOY_MODE → default hidden
 */
function resolveSkillsDeployMode (env = process.env, options = {}) {
  const fromOpt = normalizeSkillsDeployMode(options.skillsDeployMode)
  if (fromOpt) return fromOpt
  const fromEnv = normalizeSkillsDeployMode(env && env.DEVCODEX_SKILLS_DEPLOY_MODE)
  if (fromEnv) return fromEnv
  return 'hidden'
}

function resolveSkillsRuntimeRoot (sharedRoot) {
  return path.join(path.resolve(sharedRoot), 'devcodex', 'skills')
}

function resolveSkillsScanRoot (sharedRoot) {
  return path.join(path.resolve(sharedRoot), 'skills')
}

module.exports = {
  MODES,
  normalizeSkillsDeployMode,
  resolveSkillsDeployMode,
  resolveSkillsRuntimeRoot,
  resolveSkillsScanRoot
}
