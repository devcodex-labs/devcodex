/**
 * DevCodex Asset Generator
 * Generates icon, banner, and screenshot images for the plugin
 */
const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets');

// ─── Color palette ───────────────────────────────────────────────────────────
const C = {
  bg:         '#0A0F1C',
  bgLight:    '#101E3A',
  panel:      '#1E1E1E',
  sidebar:    '#252526',
  border:     '#373737',
  white:      '#FFFFFF',
  gray:       '#969696',
  grayLight:  '#CCCCCC',
  green:      '#50C858',
  greenDim:   '#2A6E2E',
  blue:       '#5894E4',
  yellow:     '#D7BA7D',
  purple:     '#C586C0',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function save(canvas, name) {
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`✅ ${name}  (${canvas.width}×${canvas.height}, ${Math.round(buf.length/1024)} KB)`);
}

// ─── 1. icon-512.png ──────────────────────────────────────────────────────────
function genIcon() {
  const S = 512;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, '#0A0F1C');
  grad.addColorStop(1, '#101E3A');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);

  // Rounded border
  roundRect(ctx, 20, 20, S - 40, S - 40, 64);
  ctx.strokeStyle = 'rgba(80,200,88,0.7)';
  ctx.lineWidth = 5;
  ctx.stroke();

  // Subtle inner glow at top
  const glow = ctx.createRadialGradient(S/2, 80, 10, S/2, 80, 200);
  glow.addColorStop(0, 'rgba(80,200,88,0.12)');
  glow.addColorStop(1, 'rgba(80,200,88,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  // "<DC>" — main text
  ctx.font = 'bold 110px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.green;
  ctx.fillText('<DC>', S / 2, 220);

  // "DevCodex" subtitle
  ctx.font = '38px Consolas, monospace';
  ctx.fillStyle = 'rgba(140,180,240,0.85)';
  ctx.fillText('DevCodex', S / 2, 340);

  // Dot row accent
  const dotCount = 7;
  const dotSpacing = 48;
  const dotStart = S / 2 - ((dotCount - 1) * dotSpacing) / 2;
  for (let i = 0; i < dotCount; i++) {
    const alpha = 0.2 + (i / dotCount) * 0.6;
    ctx.beginPath();
    ctx.arc(dotStart + i * dotSpacing, 430, 7, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(80,200,88,${alpha})`;
    ctx.fill();
  }

  save(canvas, 'icon-512.png');
}

// ─── 2. banner.png 1280×640 ───────────────────────────────────────────────────
function genBanner() {
  const W = 1280, H = 640;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#080C16');
  grad.addColorStop(1, '#12203A');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid
  ctx.strokeStyle = 'rgba(80,150,80,0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Left: icon box
  const iconX = 80, iconY = 180, iconSize = 200;
  roundRect(ctx, iconX, iconY, iconSize, iconSize, 28);
  const iconGrad = ctx.createLinearGradient(iconX, iconY, iconX + iconSize, iconY + iconSize);
  iconGrad.addColorStop(0, '#0D1828');
  iconGrad.addColorStop(1, '#162D50');
  ctx.fillStyle = iconGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,200,88,0.6)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.font = 'bold 44px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.green;
  ctx.fillText('<DC>', iconX + iconSize / 2, iconY + iconSize / 2);

  // Right: text content
  const tx = 340;
  ctx.textAlign = 'left';

  // Title
  ctx.font = 'bold 76px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = C.white;
  ctx.fillText('DevCodex', tx, 210);

  // Subtitle
  ctx.font = '28px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(160,190,240,0.9)';
  ctx.fillText('GitHub Copilot Agent Plugin', tx, 272);

  // Tag chips — type/category only, no counts
  const chips = ['Skills', 'Agents', 'Prompts', 'Instructions'];
  let cx = tx;
  chips.forEach(chip => {
    const w = chip.length * 11 + 28;
    roundRect(ctx, cx, 310, w, 34, 8);
    ctx.fillStyle = 'rgba(80,200,88,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,200,88,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = '14px Consolas, monospace';
    ctx.fillStyle = C.green;
    ctx.textBaseline = 'middle';
    ctx.fillText(chip, cx + 14, 327);
    cx += w + 12;
  });

  // Divider
  ctx.beginPath();
  ctx.moveTo(tx, 368);
  ctx.lineTo(960, 368);
  ctx.strokeStyle = 'rgba(80,200,88,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Footer info — no counts
  ctx.font = '18px Consolas, monospace';
  ctx.fillStyle = 'rgba(150,150,150,0.8)';
  ctx.textBaseline = 'middle';
  ctx.fillText('v1.0.0  ·  MIT  ·  npm install @devcodex/plugin', tx, 405);

  save(canvas, 'banner.png');
}

// ─── 3. screenshot-agents.png 1280×800 ────────────────────────────────────────
function genScreenshotAgents() {
  const W = 1280, H = 800;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // VS Code background
  ctx.fillStyle = '#1E1E1E';
  ctx.fillRect(0, 0, W, H);

  // Title bar
  ctx.fillStyle = '#323233';
  ctx.fillRect(0, 0, W, 32);
  ctx.font = '12px "Segoe UI", Arial';
  ctx.fillStyle = '#CCCCCC';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('devcodex — GitHub Copilot Chat', W / 2, 16);

  // Activity bar (leftmost)
  ctx.fillStyle = '#333333';
  ctx.fillRect(0, 32, 48, H - 32);

  // Sidebar
  ctx.fillStyle = '#252526';
  ctx.fillRect(48, 32, 290, H - 32);
  ctx.strokeStyle = '#454545';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(338, 32); ctx.lineTo(338, H); ctx.stroke();

  // Sidebar header
  ctx.font = 'bold 11px "Segoe UI", Arial';
  ctx.fillStyle = '#BBBBBB';
  ctx.textAlign = 'left';
  ctx.fillText('DEVCODEX — AGENTS', 64, 62);

  const agents = [
    { name: 'dev.agent.md',      color: C.blue,   desc: 'Full development workflow',    active: true },
    { name: 'fix.agent.md',      color: C.yellow, desc: 'Bug fix & hotfix'               },
    { name: 'audit.agent.md',    color: C.green,  desc: 'Code audit & review'            },
    { name: 'analyze.agent.md',  color: C.blue,   desc: 'Analysis & metrics'             },
    { name: 'self-fix.agent.md', color: C.green,  desc: 'Auto self-correction'           },
    { name: 'doc.agent.md',      color: '#969696', desc: 'Documentation generation'      },
    { name: 'test.agent.md',     color: C.green,  desc: 'Test generation'                },
    { name: 'refactor.agent.md', color: C.yellow, desc: 'Refactoring workflow'           },
  ];

  let ay = 85;
  agents.forEach(a => {
    if (a.active) {
      ctx.fillStyle = 'rgba(88,148,228,0.18)';
      ctx.fillRect(50, ay - 4, 282, 46);
      ctx.fillStyle = C.blue;
      ctx.fillRect(48, ay - 4, 3, 46);
    }
    // dot
    ctx.beginPath();
    ctx.arc(68, ay + 8, 5, 0, Math.PI * 2);
    ctx.fillStyle = a.color;
    ctx.fill();
    // filename
    ctx.font = '13px Consolas, monospace';
    ctx.fillStyle = a.active ? C.white : '#CCCCCC';
    ctx.textAlign = 'left';
    ctx.fillText(a.name, 82, ay + 12);
    // desc
    ctx.font = '11px "Segoe UI", Arial';
    ctx.fillStyle = C.gray;
    ctx.fillText(a.desc, 82, ay + 30);
    ay += 56;
  });

  // Main content area
  const mx = 360, mw = W - mx - 20;
  ctx.fillStyle = '#1E1E1E';
  ctx.fillRect(338, 32, W - 338, H - 32);

  // Breadcrumb bar
  ctx.fillStyle = '#2D2D2D';
  ctx.fillRect(338, 32, W - 338, 28);
  ctx.font = '12px "Segoe UI", Arial';
  ctx.fillStyle = C.gray;
  ctx.textBaseline = 'middle';
  ctx.fillText('agents  >  dev.agent.md', mx, 46);

  // Agent title
  ctx.font = 'bold 20px "Segoe UI", Arial';
  ctx.fillStyle = C.white;
  ctx.fillText('dev.agent.md', mx, 90);

  ctx.font = '13px "Segoe UI", Arial';
  ctx.fillStyle = C.gray;
  ctx.fillText('Full Development Workflow — DevCodex v1.0.0', mx, 115);

  // Separator
  ctx.strokeStyle = '#404040';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(mx, 132); ctx.lineTo(mx + mw, 132); ctx.stroke();

  // Code block
  const codeLines = [
    { text: '# dev.agent — DevCodex',         color: C.green },
    { text: '',                                 color: C.white },
    { text: 'description: |',                  color: C.blue  },
    { text: '  Complete development workflow', color: C.white },
    { text: '  with CP reviews and audit',     color: C.white },
    { text: '',                                 color: C.white },
    { text: 'phases:',                          color: C.blue  },
    { text: '  N10: Intent + Safety check',    color: C.grayLight },
    { text: '  N15: Load project profile',     color: C.grayLight },
    { text: '  N20: Tech plan (CP1)',           color: C.yellow },
    { text: '  N40: Implementation',           color: C.grayLight },
    { text: '  N50: Self review',              color: C.grayLight },
    { text: '  N60: Audit + tests',            color: C.yellow },
    { text: '  N80: Final report',             color: C.grayLight },
    { text: '',                                 color: C.white },
    { text: 'skills: [routing, intent, dev, audit, report]', color: C.purple },
  ];

  ctx.font = '14px Consolas, monospace';
  let ly = 158;
  codeLines.forEach((line, i) => {
    // line number
    ctx.fillStyle = '#555';
    ctx.textAlign = 'right';
    ctx.fillText(String(i + 1), mx - 12, ly);
    ctx.textAlign = 'left';
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, mx, ly);
    ly += 24;
  });

  save(canvas, 'screenshot-agents.png');
}

// ─── 4. screenshot-skills.png 1280×800 ────────────────────────────────────────
function genScreenshotSkills() {
  const W = 1280, H = 800;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1E1E1E';
  ctx.fillRect(0, 0, W, H);

  // Title bar
  ctx.fillStyle = '#323233';
  ctx.fillRect(0, 0, W, 32);
  ctx.font = '12px "Segoe UI", Arial';
  ctx.fillStyle = '#CCCCCC';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('devcodex — Skills Overview', W / 2, 16);

  // Activity bar
  ctx.fillStyle = '#333333';
  ctx.fillRect(0, 32, 48, H - 32);

  // Sidebar
  ctx.fillStyle = '#252526';
  ctx.fillRect(48, 32, 290, H - 32);
  ctx.strokeStyle = '#454545';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(338, 32); ctx.lineTo(338, H); ctx.stroke();

  ctx.font = 'bold 11px "Segoe UI", Arial';
  ctx.fillStyle = '#BBBBBB';
  ctx.textAlign = 'left';
  ctx.fillText('DEVCODEX — SKILLS', 64, 62);

  const categories = [
    { name: 'core/',      count: 6,  color: C.blue,   items: ['routing', 'intent', 'memory', 'report', 'session', 'compliance'] },
    { name: 'dev/',       count: 8,  color: C.green,  items: ['dev', 'dev-database', 'dev-api', 'dev-frontend', 'dev-test'] },
    { name: 'fix/',       count: 4,  color: C.yellow, items: ['fix', 'hotfix', 'root-cause'] },
    { name: 'audit/',     count: 5,  color: C.purple, items: ['audit', 'audit-security', 'audit-perf'] },
    { name: 'analyze/',   count: 4,  color: C.blue,   items: ['analyze', 'analyze-deps'] },
    { name: 'self-fix/',  count: 3,  color: C.green,  items: ['self-fix-auto', 'self-fix-pending'] },
    { name: 'doc/',       count: 2,  color: '#969696', items: ['doc-gen'] },
    { name: 'refactor/',  count: 2,  color: C.yellow, items: ['refactor'] },
  ];

  let sy = 85;
  categories.forEach(cat => {
    // folder row — no count badge
    ctx.font = '13px Consolas, monospace';
    ctx.fillStyle = '#CCCCCC';
    ctx.textAlign = 'left';
    // color dot
    ctx.beginPath();
    ctx.arc(60, sy + 8, 4, 0, Math.PI * 2);
    ctx.fillStyle = cat.color;
    ctx.fill();
    ctx.fillStyle = '#CCCCCC';
    ctx.fillText(cat.name, 72, sy + 12);
    sy += 28;
  });

  // Main area
  const mx = 360, mw = W - mx - 20;
  ctx.fillStyle = '#2D2D2D';
  ctx.fillRect(338, 32, W - 338, 28);
  ctx.font = '12px "Segoe UI", Arial';
  ctx.fillStyle = C.gray;
  ctx.textBaseline = 'middle';
  ctx.fillText('skills  >  core  >  routing.skill.md', mx, 46);

  // Skill card header
  ctx.font = 'bold 20px "Segoe UI", Arial';
  ctx.fillStyle = C.white;
  ctx.textAlign = 'left';
  ctx.fillText('routing.skill.md', mx, 90);
  ctx.font = '13px "Segoe UI", Arial';
  ctx.fillStyle = C.gray;
  ctx.fillText('Core Routing — intent → agent dispatch table', mx, 115);

  ctx.strokeStyle = '#404040';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(mx, 132); ctx.lineTo(mx + mw, 132); ctx.stroke();

  // Skill content
  const skillLines = [
    { text: '# routing.skill — DevCodex',      color: C.green  },
    { text: '',                                  color: C.white  },
    { text: 'trigger: always',                  color: C.blue   },
    { text: 'priority: P1',                     color: C.yellow },
    { text: '',                                  color: C.white  },
    { text: 'dispatch_table:',                  color: C.blue   },
    { text: '  dev | feat | impl  → dev.agent', color: C.white  },
    { text: '  fix | bug | hotfix → fix.agent', color: C.white  },
    { text: '  audit | review     → audit.agent',color: C.white },
    { text: '  analyze | check    → analyze.agent',color: C.white },
    { text: '  self-fix           → self-fix.agent',color: C.white },
    { text: '',                                  color: C.white  },
    { text: 'fallback: dev.agent',              color: C.purple },
    { text: '',                                  color: C.white  },
    { text: '# 约束 C01-C14 全部启用',           color: C.gray   },
    { text: '# 安全底线 S01-S06 不可覆盖',       color: C.gray   },
  ];

  ctx.font = '14px Consolas, monospace';
  let ly = 158;
  skillLines.forEach((line, i) => {
    ctx.fillStyle = '#555';
    ctx.textAlign = 'right';
    ctx.fillText(String(i + 1), mx - 12, ly);
    ctx.textAlign = 'left';
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, mx, ly);
    ly += 24;
  });

  // Bottom VS Code style status bar — version only, no counts
  ctx.fillStyle = '#007ACC';
  ctx.fillRect(0, H - 26, W, 26);
  ctx.font = '12px "Segoe UI", Arial';
  ctx.fillStyle = C.white;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('DevCodex v1.0.0  ·  MIT License', 16, H - 13);

  save(canvas, 'screenshot-skills.png');
}

// ─── Run ──────────────────────────────────────────────────────────────────────
console.log('Generating DevCodex assets...\n');
genIcon();
genBanner();
genScreenshotAgents();
genScreenshotSkills();
console.log('\n✨ All assets generated!');
