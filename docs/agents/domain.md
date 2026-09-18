# Domain Docs

How engineering skills should consume this repository's domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repository root.
- `CONTEXT-MAP.md` if it exists.
- Relevant ADRs under `docs/adr/`.

If these files do not exist, proceed silently. Domain-modeling skills create them when terminology or architectural decisions are resolved.

## File structure

This repository uses a single-context layout:

/
├── CONTEXT.md
├── docs/
│   └── adr/
└── src/

## Use the glossary’s vocabulary

When naming a domain concept in issues, proposals, hypotheses, or tests, use the term defined in `CONTEXT.md`.

If a needed concept is absent, reconsider whether the term fits the project or note the gap for domain modeling.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding it.
