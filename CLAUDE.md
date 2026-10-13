# Working conventions

`AGENTS.md` still applies in full, including maintainer approval for AI
contributions and the `Co-Authored-By:` line on every AI-assisted commit and PR.

## Maintainer preferences

How @josh-berry likes changes to be made, from his comments on
[#52](https://github.com/josh-berry/tab-stash/issues/52) and his review of
[#711](https://github.com/josh-berry/tab-stash/pull/711). His views on the
Chrome port itself are in
[rfcs/0001_chrome-mv3-separate-manifest.d/maintainer-views.md](rfcs/0001_chrome-mv3-separate-manifest.d/maintainer-views.md).

Changes should be minimally intrusive and build on what is already there.

- **A human must own every PR.** Even when AI helped, he wants a person to
  sign off that the work is theirs, that they reviewed and tested it, and that
  they'll put their name on it (in the spirit of the Developer Certificate of
  Origin). He has raised ethical and copyright concerns about LLM-written code.
  By July 2026 he was "willing to try [AI contributions] as an experiment",
  under the rules in `AGENTS.md`.
- **Prefer small, independent PRs** that each take one step, over one large
  change.
- **Test thoroughly before sending a PR.**
- **Reuse what exists before adding anything.** Find the existing code that
  does something similar and extend it. Don't build a parallel path.
- **Generate derived files rather than duplicating them**, so a change to the
  source carries over without anyone remembering to update a second file.
- **One build system.** Use and tweak the `Makefile`. Don't add separate build
  scripts or systems.
- **Use the existing helpers and model logic.**
  - Open tabs through `restoreTabs()`; it handles empty tabs and picking the
    target window. If it needs another option, add one.
  - Reuse existing feature checks and helpers instead of re-checking inline.
  - Extend existing browser-specific branches rather than adding new ones.
  - Rely on existing handling (e.g. for privileged URLs) rather than blocking
    things outright.
  - If something underneath is wrong, fix it at the source instead of working
    around it in the caller.
- **No `<any>` casts.** If types are missing, update `webextension-polyfill`'s
  types instead.
- **Don't weaken safety for portability.** Any change that could lose user
  data (e.g. skipping `navigator.storage.persist()`) needs evidence that the
  data stays safe.
- **Keep diagnostics.** Don't remove warnings just because one browser
  triggers them more often.
- **Don't duplicate docs.** Check that the README doesn't already say it.
- **Expect to address review comments.** He closes PRs that go stale without
  responses to his review.

## Commits

- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `type(scope): summary`.
- Work that belongs to an RFC uses the RFC as its scope, e.g.
  `feat(rfc-0001): register background listeners synchronously` or
  `docs(rfc-0001): update proposal after review`. This shows which RFC each
  commit serves.
- A fix for a bug that already existed upstream ends its subject with
  `[pre-existing]`, e.g.
  `fix(rfc-0002): close hidden tabs of newly stashed bookmarks [pre-existing]`.
  If the fix changes what the user sees, it comes with an end-to-end test;
  otherwise a unit regression test.
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

**Track bugs outside the current RFC in `TASKS.md`.** When work turns up a bug
that isn't the current RFC's job, record it there (where, what, effect, how
it was found, the fix) instead of fixing it in passing.

**Never reference RFCs in code.** No RFC numbers, section references such as
`§2a`, or links to `rfcs/` in source, comments, tests or build files. RFCs
live in this fork and upstream readers won't have them. Comments explain why
in their own words; the commit scope (`rfc-NNNN`) carries the link to the RFC.

## RFCs

RFCs live in [rfcs/](rfcs/).

<!-- rfc-index:start -->

| #    | Title                                                      | Status |
| ---- | ---------------------------------------------------------- | ------ |
| 0001 | Support Google Chrome via a generated Manifest V3 manifest | draft  |
| 0002 | A Firefox-baseline end-to-end test suite                   | draft  |

<!-- rfc-index:end -->
