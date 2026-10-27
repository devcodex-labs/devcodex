# Contributing to DevCodex

Thanks for your interest in DevCodex. Bug reports, real-world usage feedback, host compatibility issues, Skill suggestions, documentation fixes, and code changes are all welcome.

## Reporting issues

- Open an [Issue](https://github.com/devcodex-labs/devcodex/issues) with: DevCodex version (`devcodex --version`), Node.js version, OS, which AI coding host you used, steps to reproduce, and what you expected.
- Output from `devcodex status` or `devcodex doctor --json` helps. Remove secrets and private paths first.
- Security vulnerabilities: do **not** open a public Issue. Follow [SECURITY.md](./SECURITY.md).

## Development setup

Requirements: Node.js >= 18.17.0 and npm.

```bash
git clone https://github.com/devcodex-labs/devcodex.git
cd devcodex
npm ci
```

To try your local checkout as the global `devcodex` command:

```bash
npm link
devcodex --version
```

For normal use, install the published package with `npm install -g devcodex` as described in the README.

## Validation

The project uses a validation planner. Preview what a change needs before running it:

```bash
npm run test:plan        # plan for changed files
npm run test:fast:plan   # plan for the fast route
```

Some routes require a human or CI attestation and will refuse to run from an AI agent session. CI on the pull request is the source of truth.

If you change Skills under `content/skills/`, regenerate the portfolio instead of editing it by hand:

```bash
node scripts/generate-skill-portfolio.js
node scripts/generate-skill-portfolio.js --check
```

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Keep each PR focused on one change.
3. Write code comments, commit messages, and README text in English. `README.zh-CN.md` is the optional Chinese translation; keep it in sync when you change `README.md`.
4. Make sure CI passes.
5. Describe what changed, why, and how you verified it.

## Project rules

See [RULES.md](./RULES.md) (in Chinese) for the engineering rules the project follows.

## License of contributions

DevCodex is licensed under [AGPL-3.0-or-later](./LICENSE). By submitting a contribution you agree that it is licensed under the same terms.
