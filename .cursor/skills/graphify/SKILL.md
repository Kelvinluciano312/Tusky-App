---
name: graphify
description: "Query or update this repo's Graphify knowledge graph. Use when the user says graphify, or before a broad architecture question when the graphify CLI and graphify-out/graph.json are both available. If graphify is not installed, install it or skip and keep working. Do not commit graphify-out/."
---

# Graphify

Source: PyPI package `graphifyy` 0.9.94 ([Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify)), Apache-2.0. Copyright 2026 Safi Shamsi and the Graphify contributors. See `LICENSE`, `LICENSE-MIT`, and `NOTICE` in this directory.

`graphify install --project --platform cursor` writes `.cursor/rules/graphify.mdc` and does not write this skill. This file is the project skill so Cursor can load the same install-or-skip behavior. The always-on rule is still the generated one.

## Tusky

`COORDINATION.md` overrides this skill. Never merge, never push to `master`, and never skip the pull-request flow.

`graphify-out/` is gitignored generated output. Do not commit it, and do not `git add -f` it. A missing graph on a fresh clone is normal. PR #51 committed a snapshot; this repo no longer tracks that directory.

## When `graphify` is not installed

Check once:

```bash
command -v graphify
```

- If it is missing, install it when you can: `uv tool install graphifyy`, or `pip install graphifyy`. The command is `graphify`.
- If you cannot install it, say so in one line and skip the graph. Use Read, Grep, and Glob. Do not stall and do not fail the task.

The same skip applies when `graphify-out/graph.json` does not exist and building the graph is outside the task.

## When it is installed

From the repo root:

- `graphify query "<question>"` — scoped subgraph for a codebase or architecture question
- `graphify path "<A>" "<B>"` — dependency path between two symbols
- `graphify explain "<concept>"` — nodes related to a concept
- `graphify .` — build the graph (writes `graphify-out/`, local only)
- `graphify update .` — refresh after code changes (AST-only)

Prefer those CLI commands. Do not reimplement Graphify's Claude Code extraction pipeline (subagent chunks, semantic JSON) inside this repo.

After the CLI has oriented you, read the specific files you need to change. If `graphify-out/wiki/index.md` exists, use it for broad navigation. Read `GRAPH_REPORT.md` only when query, path, and explain are not enough.
