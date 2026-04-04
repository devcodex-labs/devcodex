# DevCodex

> AI-powered development workflow rules as a GitHub Copilot Agent Plugin.

[![npm](https://img.shields.io/badge/npm-%40vextjs%2Fdevcodex-blue)](https://github.com/vextjs/devcodex)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](LICENSE)

## What is DevCodex?

DevCodex injects structured, opinionated development workflows into GitHub Copilot via the Agent Plugin API.  
It enforces a consistent dev → fix → audit → analyze cycle with built-in compliance checks, memory, and reporting.

## Features

- **8 Workflow types**: `dev` / `fix` / `audit` / `analyze` / `self-fix` / `resume` / `plan` / `chat`
- **Compliance pipeline**: FC (formal) → SC (substantive) → RC (recovery) → T (task-complete)
- **Persistent memory**: per-agent, per-day session files with structured fields
- **Automated reports**: auto-written per session, never asked — always done
- **Tier system**: `free` / `pro` — core workflows available on free tier

## Installation

```bash
# Install via GitHub Packages
npm install @vextjs/devcodex

# Initialize in your project
npx devcodex init
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `devcodex init` | Install plugin files to `~/.github/` |
| `devcodex update` | Re-sync latest version to `~/.github/` |
| `devcodex status` | Show current version, tier, and mode |

## Documentation

Full documentation: [devcodex.dev](https://devcodex.dev)

## License

AGPL-3.0-or-later © Rocky / [vextjs](https://github.com/vextjs)
