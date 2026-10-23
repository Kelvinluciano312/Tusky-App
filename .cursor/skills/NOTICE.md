# Notices for vendored agent skills

These skills are third-party. `COORDINATION.md` overrides them in this repository. See `.cursor/rules/agent-skills.mdc`.

## Superpowers

- Source: https://github.com/obra/superpowers
- Version: v7.0.1 (`2ce8aa15d05bd57213e6f746f953aafb7ded7a8b`)
- License: MIT. Copyright (c) 2025 Jesse Vincent.
- Text: `.cursor/skills/superpowers/LICENSE`
- Files: `.cursor/skills/<skill-name>/` (every skill except `graphify` and `fablize`)
- Local edits: Tusky notes in `brainstorming`, `finishing-a-development-branch`, `using-superpowers`, and `using-git-worktrees`.

## Graphify

- Source: https://github.com/Graphify-Labs/graphify (PyPI package `graphifyy`)
- Version: 0.9.94
- License: Apache-2.0. Copyright 2026 Safi Shamsi and the Graphify contributors.
- Text: `.cursor/skills/graphify/LICENSE`, `LICENSE-MIT`, and `NOTICE`
- Generated file: `.cursor/rules/graphify.mdc`, from `graphify install --project --platform cursor`, plus local Tusky notes (read the committed `graphify-out/` graph first; refresh and commit it after a significant code change when the CLI is installed).
- `.cursor/skills/graphify/SKILL.md` is a short project skill added here. The Cursor installer does not write a skill file.

## fablize

- Source: https://github.com/fivetaku/fablize
- Version: 2.1.1 (`e221f32b16f7b0ef39393ba47c37cb8345ffe749`)
- License: MIT. Copyright (c) 2026 fivetaku.
- Text: `.cursor/skills/fablize/LICENSE`
- Files: `.cursor/skills/fablize/` (`SKILL.md`, `goals.py`, `packs/`)
- Left out on purpose: Claude Code hooks, slash-command setup, and any prompt to star the repository.
