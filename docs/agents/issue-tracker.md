# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`.
- **Read an issue**: `gh issue view <number> --comments`, also fetching labels.
- **List issues**: use `gh issue list` with suitable state and label filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply/remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- **Close an issue**: `gh issue close <number> --comment "..."`

Infer the repository from `git remote -v`; `gh` does this automatically inside the clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and pull requests. Resolve an ambiguous reference such as `#42` with `gh pr view 42`, then fall back to `gh issue view 42`.

## When a skill says “publish to the issue tracker”

Create a GitHub issue.

## When a skill says “fetch the relevant ticket”

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. A map is one issue with child issues as tickets.

- **Map**: an issue labelled `wayfinder:map`.
- **Child ticket**: a GitHub sub-issue, or a task-list entry if sub-issues are unavailable.
- **Blocking**: use GitHub issue dependencies where available.
- **Frontier query**: choose the first open, unblocked, unassigned child in map order.
- **Claim**: assign the issue to the current user.
- **Resolve**: comment with the answer, close the issue, then record the context pointer in the map.
