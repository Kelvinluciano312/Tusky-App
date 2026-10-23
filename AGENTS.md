# Agent skills

Project skills for Cursor and Claude Code live in `.cursor/skills/<skill-name>/SKILL.md`. Rules that always apply live in `.cursor/rules/`. Upstream licenses and versions are in `.cursor/skills/NOTICE.md`.

**`COORDINATION.md` wins** whenever a skill disagrees with it. Skills must not merge, push to `master`, or skip the pull-request flow. The always-on statement is `.cursor/rules/agent-skills.mdc`.

Read `COORDINATION.md` before starting work. This file does not replace `CLAUDE.md`.

Claude Code loads `.claude/skills`. The tree is not mirrored or symlinked there: a symlink checks out as a plain text file on Windows unless Git's `core.symlinks` is on, and Pedro's machine is Windows. Point Claude Code at `.cursor/skills`, or copy the one skill you need into `.claude/skills/<name>/SKILL.md` locally.

| Set | Where | How to use it |
| --- | --- | --- |
| Superpowers (obra/superpowers, MIT) | `.cursor/skills/<skill-name>/` | Skills trigger from their descriptions (brainstorming, TDD, debugging, plans). In Cursor chat, `/add-plugin superpowers` installs the upstream plugin instead of this copy. |
| Graphify (PyPI `graphifyy`, Apache-2.0) | `.cursor/rules/graphify.mdc`, `.cursor/skills/graphify/SKILL.md` | `graphify query "<question>"` when the CLI is installed. If it is not, install `graphifyy` or skip. `graphify-out/` is gitignored. |
| fablize (fivetaku/fablize, MIT) | `.cursor/skills/fablize/SKILL.md` | Multi-step work, debugging, and rendered artifacts. `goals.py` is the local ledger. No Claude hooks and no star prompt. |
