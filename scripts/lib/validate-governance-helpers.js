'use strict'

function buildGovernanceHelpers(ctx) {
  const { ROOT, fs, path, read } = ctx

  function collectChangelogSources() {
    const sources = [
      { file: 'changelogs/unreleased.md', content: read(path.join(ROOT, 'changelogs/unreleased.md')) }
    ]
    const releasesDir = path.join(ROOT, 'changelogs', 'releases')
    if (fs.existsSync(releasesDir)) {
      for (const name of fs.readdirSync(releasesDir).filter(item => item.endsWith('.md')).sort()) {
        const file = `changelogs/releases/${name}`
        sources.push({ file, content: read(path.join(ROOT, file)) })
      }
    }
    return sources
  }

  function hasChangelogEvidence(needle) {
    return collectChangelogSources().some(source => source.content.includes(needle))
  }

  // __FUNCTIONS__

  return { collectChangelogSources, hasChangelogEvidence }
}

module.exports = { buildGovernanceHelpers }
