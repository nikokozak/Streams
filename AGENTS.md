# Agent Notes (Ticker)

This file captures repository-specific workflow and environment pitfalls discovered during work on `feature/single-editor-refactor`.
It is intended for coding agents (Codex/Claude/GPT) so future sessions don’t have to rediscover these constraints.

## Follow CLAUDE.md

`CLAUDE.md` is the authoritative collaboration/workflow guide for this repo. In particular:
- Work in small, verifiable slices.
- Get GPT-5.2 review after each slice before moving on.
- Do not expand scope without asking.

## Shell / Sandbox Pitfall: Login zsh runs Homebrew/RVM

In some environments, running commands through a **login zsh** sources user dotfiles that invoke Homebrew/RVM.
Those scripts may try to create temp files or call `ps`, which can fail under sandboxing with errors like:
- `brew.sh: cannot create temp file ... Operation not permitted`
- `.../ps: Operation not permitted`

**Agent guidance:**
- Prefer running tool shell commands with **non-login** semantics (e.g., `login=false` when supported by the harness).
- Avoid relying on Homebrew/RVM in automated tool execution.

**Human fix (optional):**
- Guard `brew shellenv` / `rvm` init behind an interactive-shell check in `~/.zshrc` / `~/.zprofile`, e.g.:
  - `[[ -o interactive ]] || return`

## Unified Editor Invariants (do not break)

- Cell identity is UUID-based: `cellBlock.attrs.id` must be a UUID that matches persistence expectations.
- Schema is `doc -> cellBlock+` and `cellBlock -> block+` (rich block content).
- Paste must rewrite pasted `cellBlock` UUIDs to avoid persistence collisions.
- Avoid parsing arbitrary HTML as a full `doc` under `cellBlock+`; parse inside a dummy `cellBlock` and insert its content.
- Drag reorder persists via `reorderBlocks` bridge message; suppress content-save storms during reorder.

## UX Polish Planning

- Refer to `IMPLEMENTATION_TASKS_UX_POLISH.md` for the current polish slice plan.
- Cell-level error overlay/state-machine work is explicitly deferred unless re-approved.

