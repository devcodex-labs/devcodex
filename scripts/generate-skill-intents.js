#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const {
  sanitizeModelText,
  validateSkillIntent
} = require('../hooks/_runtime/progressive-skill-route-contract.cjs')

const ROOT = path.resolve(__dirname, '..')
const PORTFOLIO_PATH = path.join(ROOT, 'skills', 'portfolio.json')

function optionNumber (name, fallback) {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return value
}

function compactText (value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function truncateText (value, maxChars) {
  const chars = Array.from(compactText(value))
  if (chars.length <= maxChars) return chars.join('')
  return chars.slice(0, Math.max(1, maxChars - 3)).join('').trimEnd() + '...'
}

function acceptedText (value, maxChars, fallback) {
  const candidate = truncateText(value, maxChars)
  const checked = sanitizeModelText(candidate, { maxChars })
  if (checked.ok && checked.value) return checked.value
  return fallback
}

function primaryLabel (skill) {
  const description = compactText(skill.description)
  const prefix = description.split(/\s+Owner\b|[—；;]/u)[0]
  return acceptedText(
    prefix || skill.name || skill.id,
    40,
    truncateText(skill.id, 40)
  )
}

function includeTerms (skill) {
  const source = [
    ...(skill.skillIndex?.triggers?.terms || []),
    ...String(skill.id).split(/[-_.]/)
  ]
  const accepted = []
  for (const raw of source) {
    const term = compactText(raw)
    if (!term || term.length > 16 || /^(?:owner|skill|workflow)$/i.test(term)) {
      continue
    }
    const checked = sanitizeModelText(term, { maxChars: 16 })
    if (!checked.ok || !checked.value) continue
    if (!accepted.some(item => item.toLowerCase() === checked.value.toLowerCase())) {
      accepted.push(checked.value)
    }
    if (accepted.length === 8) break
  }
  return accepted.length ? accepted : ['domain-work']
}

function buildSkillIntent (skill) {
  const label = primaryLabel(skill)
  const exampleLabel = truncateText(label, 32)
  const fallbackSummary = `Use for ${skill.id} domain work.`
  const intent = {
    schemaVersion: 'SkillIntentV1',
    skillId: skill.id,
    intents: [{
      id: 'primary',
      label,
      include: includeTerms(skill)
    }],
    examples: {
      positive: [
        `${exampleLabel}领域任务`,
        `${exampleLabel}专项审查`
      ],
      negative: [
        '无关闲聊或通用问答',
        '由其他领域 Skill 明确负责的任务'
      ]
    },
    summary: acceptedText(skill.description, 160, fallbackSummary)
  }
  const validation = validateSkillIntent(intent, { skillId: skill.id })
  if (!validation.ok) {
    throw new Error(`invalid generated intent for ${skill.id}: ${validation.reasonCode}`)
  }
  return validation.value
}

function serializeIntent (intent) {
  return `${JSON.stringify(intent, null, 2)}\n`
}

function loadActiveSkills () {
  const portfolio = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8'))
  return portfolio.skills
    .filter(skill => skill.lifecycleState === 'active')
    .sort((left, right) => left.id.localeCompare(right.id))
}

function intentPath (skillId) {
  return path.join(ROOT, 'skills', skillId, 'intent.json')
}

function processSkillIntents (options = {}) {
  const skills = loadActiveSkills()
  const start = options.start || 0
  const size = options.size == null ? skills.length : options.size
  const selected = skills.slice(start, start + size)
  const mismatches = []
  let written = 0

  for (const skill of selected) {
    const target = intentPath(skill.id)
    const expected = serializeIntent(buildSkillIntent(skill))
    const actual = fs.existsSync(target)
      ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
      : null
    if (actual === expected) continue
    mismatches.push(path.relative(ROOT, target).replace(/\\/g, '/'))
    if (options.write) {
      fs.writeFileSync(target, expected, 'utf8')
      written += 1
    }
  }

  return {
    activeCount: skills.length,
    selectedCount: selected.length,
    start,
    endExclusive: start + selected.length,
    mismatchCount: mismatches.length,
    written,
    mismatches
  }
}

function main () {
  const write = process.argv.includes('--write')
  const result = processSkillIntents({
    write,
    start: optionNumber('--batch-start', 0),
    size: optionNumber('--batch-size', null)
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!write && result.mismatchCount > 0) process.exitCode = 1
}

if (require.main === module) main()

module.exports = {
  buildSkillIntent,
  loadActiveSkills,
  processSkillIntents,
  serializeIntent
}
