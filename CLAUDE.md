# Working conventions

`AGENTS.md` still applies in full, including maintainer approval for AI
contributions and the `Co-Authored-By:` line on every AI-assisted commit and PR.

## Commits

- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `type(scope): summary`.
- Work that belongs to an RFC uses the RFC as its scope, e.g.
  `feat(rfc-0001): register background listeners synchronously` or
  `docs(rfc-0001): update proposal after review`. This shows which RFC each
  commit serves.
- Build commits as a Gerrit-style stack: each commit is one coherent change that
  builds, passes `make`, and delivers value on its own. Order the stack so any
  prefix of it could land without the rest.

## RFC process

1. **Draft** the RFC in `rfcs/NNNN_<slug>.md` with the `rfc-craft` skills. It
   starts as `draft`.
2. **Review** it with the independent review wave from `writing-rfc-prose`,
   integrate the findings, and commit it as `docs(rfc-NNNN): ...`.
3. **Plan** with `superpowers:writing-plans`, using the RFC as the spec. The plan
   lives at `rfcs/NNNN_<slug>.d/plan.md`.
4. **Implement** with `superpowers:subagent-driven-development`. This is the
   default for all implementation unless stated otherwise.
5. **Keep the RFC true.** The RFC stays `draft` until its implementation lands.
   If the plan or implementation changes anything the RFC says, update the RFC
   in the same stack, in its own `docs(rfc-NNNN): ...` commit.
6. **Close out** with `rfc-craft`: move the RFC to `in review`, then `accepted`,
   once the implementation is merged.

## RFCs

RFCs live in [rfcs/](rfcs/).

<!-- rfc-index:start -->

| #   | Title | Status |
| --- | ----- | ------ |

<!-- rfc-index:end -->
