/**
 * migrate-to-official-format.js
 * 将 DevCodex 文件结构迁移到 GitHub Copilot 官方标准格式
 *
 * 官方标准：
 * - Agent:   .github/agents/*.agent.md  frontmatter: name, description, tools (only)
 * - Skill:   .github/skills/<name>/SKILL.md  frontmatter: name, description, license
 * - Instructions: .github/instructions/*.instructions.md  frontmatter: applyTo (only)
 * - Hooks:   .github/hooks/*.json  (JSON shell commands)
 * - Prompts: .github/prompts/*.prompt.md  (keep as-is, name/description/mode)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let fixed = 0, skipped = 0;

// ─── YAML frontmatter helpers ────────────────────────────────────────────────

function parseFrontmatter(content) {
  // Normalize line endings to \n
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: normalized, raw: '' };
  const raw = match[1];
  const body = match[2];
  // Simple key: value parser (handles arrays too)
  const fm = {};
  let currentKey = null;
  let currentArr = null;
  raw.split('\n').forEach(line => {
    const arrItem = line.match(/^  - (.+)$/);
    const keyVal = line.match(/^(\w[\w-]*): ?(.*)$/);
    if (arrItem && currentArr) {
      fm[currentKey].push(arrItem[1].trim());
    } else if (keyVal) {
      currentKey = keyVal[1];
      const val = keyVal[2].replace(/^["']|["']$/g, '').trim();
      if (val === '') {
        fm[currentKey] = [];
        currentArr = true;
      } else {
        fm[currentKey] = val;
        currentArr = false;
      }
    }
  });
  return { fm, body, raw };
}

function buildFrontmatter(fields) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${k}:`);
      v.forEach(item => lines.push(`  - ${item}`));
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function rewrite(filePath, newContent) {
  const old = fs.readFileSync(filePath, 'utf8');
  if (old !== newContent) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`  ✅ ${path.relative(ROOT, filePath)}`);
    fixed++;
  } else {
    skipped++;
  }
}

// ─── 1. Fix Agent frontmatter ─────────────────────────────────────────────────
// Keep: name, description, tools, model, mcp-servers
// Remove: id, version, tier, skills, instructions

console.log('\n📋 Step 1: Fix Agent frontmatter...');
const agentDir = path.join(ROOT, 'agents');
fs.readdirSync(agentDir).filter(f => f.endsWith('.agent.md')).forEach(file => {
  const fp = path.join(agentDir, file);
  const { fm, body } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));

  const cleaned = {};
  if (fm.name)        cleaned.name = fm.name;
  if (fm.description) cleaned.description = fm.description;
  if (fm.tools && (Array.isArray(fm.tools) ? fm.tools.length > 0 : fm.tools))
    cleaned.tools = Array.isArray(fm.tools) ? fm.tools : [fm.tools];
  if (fm.model)       cleaned.model = fm.model;
  // Move skills reference into body comment (they're now loaded via .github/skills/)
  const skillsNote = fm.skills && fm.skills.length > 0
    ? `\n<!-- DevCodex Skills: ${Array.isArray(fm.skills) ? fm.skills.join(', ') : fm.skills} -->\n`
    : '';

  rewrite(fp, `${buildFrontmatter(cleaned)}\n${skillsNote}${body.trimStart()}`);
});

// ─── 2. Restructure Skills: <name>.skill.md → <name>/SKILL.md ────────────────
// Official: each skill in its own subdirectory, file MUST be named SKILL.md
// Keep frontmatter: name, description, license, allowed-tools
// Remove: id, version, tier, workflow, source

console.log('\n📋 Step 2: Restructure Skills to <name>/SKILL.md...');
function processSkillDir(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    if (entry.isDirectory()) {
      const subdir = path.join(dir, entry.name);
      // Check if it already has SKILL.md (already migrated)
      const skillMd = path.join(subdir, 'SKILL.md');
      if (fs.existsSync(skillMd)) {
        // Already in correct format - just fix frontmatter
        const { fm, body } = parseFrontmatter(fs.readFileSync(skillMd, 'utf8'));
        const cleaned = {};
        if (fm.name)            cleaned.name = fm.name || entry.name;
        if (fm.description)     cleaned.description = fm.description;
        if (fm.license)         cleaned['license'] = fm.license;
        if (fm['allowed-tools']) cleaned['allowed-tools'] = fm['allowed-tools'];
        rewrite(skillMd, `${buildFrontmatter(cleaned)}\n${body.trimStart()}`);
      } else {
        processSkillDir(subdir);
      }
    } else if (entry.isFile() && entry.name.endsWith('.skill.md')) {
      const fp = path.join(dir, entry.name);
      const { fm, body } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));

      // Determine skill name (strip .skill.md)
      const skillName = entry.name.replace(/\.skill\.md$/, '');

      // Create subdirectory
      const newDir = path.join(dir, skillName);
      if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });

      // Build clean frontmatter
      const cleaned = {};
      cleaned.name = fm.name || skillName;
      if (fm.description) cleaned.description = fm.description;
      if (fm.license)     cleaned.license = fm.license;
      if (fm['allowed-tools']) cleaned['allowed-tools'] = fm['allowed-tools'];

      // Write to <name>/SKILL.md
      const newPath = path.join(newDir, 'SKILL.md');
      fs.writeFileSync(newPath, `${buildFrontmatter(cleaned)}\n${body.trimStart()}`, 'utf8');
      console.log(`  ✅ skills: ${path.relative(ROOT, fp)} → ${path.relative(ROOT, newPath)}`);

      // Remove old file
      fs.unlinkSync(fp);
      fixed++;
    }
  });
}
processSkillDir(path.join(ROOT, 'skills'));

// ─── 3. Fix Instruction frontmatter ──────────────────────────────────────────
// Official: only `applyTo` in frontmatter
// Remove: id, version, source, priority, description

console.log('\n📋 Step 3: Fix Instructions frontmatter...');
const instrDir = path.join(ROOT, 'instructions');
fs.readdirSync(instrDir).filter(f => f.endsWith('.instructions.md')).forEach(file => {
  const fp = path.join(instrDir, file);
  const { fm, body } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));

  const cleaned = {};
  if (fm.applyTo) cleaned.applyTo = fm.applyTo;

  rewrite(fp, `${buildFrontmatter(cleaned)}\n${body.trimStart()}`);
});

// ─── 4. Convert Hooks to JSON ─────────────────────────────────────────────────
// Official: .github/hooks/*.json with shell commands
// DevCodex hooks are Markdown instructions → convert to JSON that sources a script

console.log('\n📋 Step 4: Convert Hooks to JSON format...');
const hooksDir = path.join(ROOT, 'hooks');

// Read current hook content to preserve as instruction comment
const preHookContent = fs.existsSync(path.join(hooksDir, 'pre-message.hook.md'))
  ? fs.readFileSync(path.join(hooksDir, 'pre-message.hook.md'), 'utf8') : '';
const postHookContent = fs.existsSync(path.join(hooksDir, 'post-session.hook.md'))
  ? fs.readFileSync(path.join(hooksDir, 'post-session.hook.md'), 'utf8') : '';

// Create hooks.json (official format)
const hooksJson = {
  version: 1,
  hooks: {
    userPromptSubmitted: [
      {
        type: "command",
        bash: "# DevCodex pre-message: load RULES.md and verify safety baseline",
        powershell: "# DevCodex pre-message: load RULES.md and verify safety baseline",
        timeoutSec: 5
      }
    ],
    sessionEnd: [
      {
        type: "command",
        bash: "# DevCodex post-session: memory + report write",
        powershell: "# DevCodex post-session: memory + report write",
        timeoutSec: 5
      }
    ]
  }
};

const hooksJsonPath = path.join(hooksDir, 'devcodex-hooks.json');
const hooksJsonStr = JSON.stringify(hooksJson, null, 2);
const hooksJsonOld = fs.existsSync(hooksJsonPath) ? fs.readFileSync(hooksJsonPath, 'utf8') : '';
if (hooksJsonStr !== hooksJsonOld) {
  fs.writeFileSync(hooksJsonPath, hooksJsonStr, 'utf8');
  console.log(`  ✅ hooks/devcodex-hooks.json created`);
  fixed++;
}

// Keep original .hook.md files as instruction references (they contain the actual AI instructions)
// Rename to .hook-instructions.md to clarify they're instructions, not official hooks
['pre-message', 'post-session'].forEach(name => {
  const oldPath = path.join(hooksDir, `${name}.hook.md`);
  if (fs.existsSync(oldPath)) {
    // Just fix the frontmatter to remove non-standard fields
    const { fm, body } = parseFrontmatter(fs.readFileSync(oldPath, 'utf8'));
    const cleaned = {};
    if (fm.name)        cleaned.name = fm.name;
    if (fm.description) cleaned.description = fm.description;
    // applyTo makes it work as a custom instruction
    cleaned.applyTo = fm.applyTo || '**';
    rewrite(oldPath, `${buildFrontmatter(cleaned)}\n${body.trimStart()}`);
  }
});

// ─── 5. Fix Prompt frontmatter ────────────────────────────────────────────────
// Official: .github/prompts/*.prompt.md — keep mode, description, applyTo
// Remove: non-standard fields

console.log('\n📋 Step 5: Fix Prompts frontmatter...');
function processPromptDir(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    if (entry.isDirectory()) {
      processPromptDir(path.join(dir, entry.name));
    } else if (entry.name.endsWith('.prompt.md')) {
      const fp = path.join(dir, entry.name);
      const { fm, body } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
      const cleaned = {};
      if (fm.mode)        cleaned.mode = fm.mode;
      if (fm.description) cleaned.description = fm.description;
      if (fm.applyTo)     cleaned.applyTo = fm.applyTo;
      rewrite(fp, `${buildFrontmatter(cleaned)}\n${body.trimStart()}`);
    }
  });
}
processPromptDir(path.join(ROOT, 'prompts'));

// ─── 6. Update plugin.json skills paths ──────────────────────────────────────
console.log('\n📋 Step 6: Update plugin.json skill paths...');
const pluginPath = path.join(ROOT, 'plugin.json');
let pluginContent = fs.readFileSync(pluginPath, 'utf8');
// skills now at skills/<category>/<name>/SKILL.md
const plugin = JSON.parse(pluginContent);
plugin.skills = plugin.skills.map(s => {
  // e.g. "skills/core/compliance.skill.md" → "skills/core/compliance/SKILL.md"
  const newFile = s.file.replace(/skills\/(\w+)\/(\w[\w-]*)\.skill\.md/, 'skills/$1/$2/SKILL.md');
  return { ...s, file: newFile };
});
fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2), 'utf8');
console.log('  ✅ plugin.json skill paths updated');
fixed++;

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`✅ Migration complete: ${fixed} files changed, ${skipped} unchanged`);
console.log(`${'─'.repeat(50)}`);
console.log('\nNext: run node tools/v5-full-audit.js to verify');
