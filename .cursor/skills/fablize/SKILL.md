---
name: fablize
description: "See a multi-step task through to the end, with evidence and verification, as procedure. Use for 2+ sequential stories, long autonomous work, debugging or root-cause investigation, or render/executable artifacts (HTML, SVG, games, charts). Also when the user says fablize, see it through, verify as you go, or split into goals."
---

# fablize

Adapted from [fivetaku/fablize](https://github.com/fivetaku/fablize) v2.1.1 (`e221f32b16f7b0ef39393ba47c37cb8345ffe749`). MIT License, copyright (c) 2026 fivetaku. See `LICENSE` in this directory.

This copy keeps the procedure (multi-story loop, investigation, verification grounding) and the `goals.py` helper. It does not include Claude Code hooks, slash-command setup, or any prompt to star the repository.

## Tusky

`COORDINATION.md` overrides this skill. Never merge, never push to `master`, and never skip the pull-request flow. A verification gate is not permission to merge.

> A harness cannot raise a model's ceiling. It makes the model go all the way to its own ceiling by enforcing verification, completion, and investigation as procedure. When the ceiling is the blocker, say so (see At the ceiling).
>
> Apply only what the task signals. Smallest matching discipline. Overlap only when the task really is more than one of these.

## 1. Multi-story loop (2+ sequential stories)

Decompose into sequential stories and finish one at a time, with evidence. Single-step tasks skip this loop.

Run from the repo root. State lives in `./.fablize/`, which is gitignored. Resume with `status`.

```bash
python3 .cursor/skills/fablize/goals.py create --brief "<summary>" \
  --goal "title::verifiable objective" --goal "title::..."   # the last goal is a verification story
python3 .cursor/skills/fablize/goals.py next
# ... work that story only ...
python3 .cursor/skills/fablize/goals.py checkpoint --id G001 --status complete --evidence "<concrete evidence>"
# the final story needs --verify-cmd "<command>" --verify-evidence "<result>"
python3 .cursor/skills/fablize/goals.py status
```

`complete` requires non-empty evidence. The final goal cannot complete without a verify command and its result (the script refuses). If blocked, record `--status blocked` and report.

## 2. Deep investigation (debugging / unknown cause / review)

Read and follow `packs/investigation-protocol.txt` (this directory): reproduce first, form 3+ competing hypotheses, gather evidence per hypothesis, trace the full causal chain (removing the symptom is not removing the defect), verify before and after, and report the hypotheses you rejected. For reviews, report everything including low-confidence findings, and filter in a separate step.

## 3. Verification grounding (render/executable artifacts)

For artifacts whose correctness only shows when run (HTML, SVG, games, UI, charts), follow `packs/verification-grounding-pack.txt`: run it in the real renderer, observe the actual output, fix what the observation reveals, and re-run. A static parse confirms well-formed, not correct.

## 4. Working style

Lead with the outcome. Stay within the requested scope (no incidental refactors or abstractions). Ground every completion claim in a tool result from this session. Confirm before destructive or hard-to-reverse actions.

## 5. At the ceiling

Signals: stuck on the same problem 2+ times, open-ended creation where the detail itself is the value, or a review that needs discovery the spec does not cover. Procedure cannot fill a capability gap. In order: use a stronger effort or a subagent if this harness has one, and only for a bounded stuck slice; if still short, hand off to a stronger model in a fresh session with the evidence (symptoms, attempts, failure point, repro, the specific sub-question); otherwise report the limit honestly and name where a person has to step in.
