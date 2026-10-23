---
name: graphify
description: "Use this repo's committed Graphify knowledge graph for codebase orientation. Read graphify-out/GRAPH_REPORT.md first. If graphify is installed and you make a significant code change, refresh the graph and commit graphify-out/ in the same PR. If it is not installed, use the committed graph and note that it may be stale."
---

# Graphify

Source: PyPI package `graphifyy` 0.9.94 ([Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify)), Apache-2.0. Copyright 2026 Safi Shamsi and the Graphify contributors. See `LICENSE`, `LICENSE-MIT`, and `NOTICE` in this directory.

`graphify install --project --platform cursor` writes `.cursor/rules/graphify.mdc` and does not write this skill. This file is the project skill. The always-on rule is still `.cursor/rules/graphify.mdc`. A later `graphify install` overwrites that rule; put the Tusky notes back after an upgrade.

## Tusky

`COORDINATION.md` overrides this skill. Never merge, never push to `master`, and never skip the pull-request flow.

The graph is committed in `graphify-out/`. Read it. Do not `git add -f` the ignored machine-local files (`cache/`, `cost.json`, `.graphify_python`, `.graphify_root`, `memory/`, `reflections/`, dated backup folders).

## Read the committed graph first

Before a broad look at the codebase, read `graphify-out/GRAPH_REPORT.md`:

- Summary, god nodes, and community hubs for the map
- Surprising connections and the per-community node lists when you need a neighborhood

`graph.json` is the same graph (relative `source_file` paths). `graph.html` is the browser view. `.graphify_labels.json` names the communities.

The committed snapshot is a **code** graph (AST). Markdown docs, including `CLAUDE.md` and the specs, are not nodes. There is no LLM semantic layer. Say so if someone expects docs or inferred doc edges in the graph.

This applies to you and to every subagent that explores code. Tell them to read `GRAPH_REPORT.md` first.

If `graphify-out/wiki/index.md` exists, use it for broad navigation.

## When `graphify` is not installed

Use the committed graph anyway. Say once that it may be stale. Then keep working with Read, Grep, and Glob. Do not stall, and do not treat a missing CLI as a failed task.

Install it when you can: `uv tool install graphifyy`, or `pip install graphifyy`. The command is `graphify`. This repo's SQL migrations need the extra: `uv tool install "graphifyy[sql]"`, or `pip install "graphifyy[sql]"`. Without `tree-sitter-sql`, a rebuild drops every `.sql` file from the graph.

## When it is installed

From the repo root, after you have read the report, you may narrow further:

- `graphify query "<question>"` — scoped subgraph
- `graphify path "<A>" "<B>"` — dependency path between two symbols
- `graphify explain "<concept>"` — nodes related to a concept

Prefer those CLI commands over reimplementing Graphify's extraction pipeline.

After the graph has oriented you, read the specific files you need to change.

## Refresh after significant code changes

Significant means new or renamed modules, new dependencies between areas, or schema changes (a migration, a new edge function, a new screen). A typo, copy edit, or docs-only change does not need a refresh.

When the CLI is installed and the change is significant, refresh and commit `graphify-out/` in the **same pull request**:

```bash
graphify update .
```

`graphify update .` is AST-only and does not call an LLM. If `graphify-out/graph.json` is missing, rebuild instead:

```bash
GRAPHIFY_BACKEND=none graphify extract . --code-only
graphify cluster-only .
```

`graphify extract` without `--code-only` tries semantic extraction and fails closed when no LLM key is set. Do not add a key to force that. Commit the code graph you can build locally.
