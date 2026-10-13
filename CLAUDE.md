# Working conventions

`AGENTS.md` still applies in full, including maintainer approval for AI
contributions and the `Co-Authored-By:` line on every AI-assisted commit and PR.

## Maintainer preferences

These come from @josh-berry's review of the closed Chrome MV3 PR
([#711](https://github.com/josh-berry/tab-stash/pull/711), July 2026). He
is "willing to try [AI contributions] as an experiment". Changes should be
minimally intrusive and build on what is already there.

- **Reuse what exists before adding anything.** The codebase already has
  Chrome-friendly code, including a Chrome build. Find it and extend it. Don't
  build a parallel path.
- **Generate derived files rather than duplicating them.** He wants the Chrome
  manifest generated from `assets/manifest.json` by a small Node script that
  reads, mutates and emits the JSON, as `patch-manifest-for-chrome.js` does.
  Permission changes should carry over to Chrome without anyone remembering
  to update a second file.
- **One build system.** Use and tweak the `Makefile`. Don't add separate build
  scripts or systems.
- **Use the existing helpers and model logic.**
  - Open tabs through `restoreTabs()`; it handles empty tabs and picking the
    target window. If it needs another option, add one.
  - Reuse existing feature checks and helpers instead of re-checking inline.
  - Extend existing Chrome-specific branches, such as tab opening in
    `src/model/tabs.ts`, rather than adding new ones. Keep the
    `_loading_queue` protection.
  - Rely on the existing privileged-URL handling rather than blocking URLs.
  - If something underneath is wrong, fix it at the source instead of working
    around it in the caller.
- **No `<any>` casts.** If types are missing, update `webextension-polyfill`'s
  types instead.
- **Don't weaken safety for portability.** He is wary of skipping
  `navigator.storage.persist()`, because saved deleted items could be lost.
  Any change like this needs evidence that the data stays safe.
- **Keep diagnostics.** Don't remove warnings, such as unknown-tab events,
  just because one browser triggers them more often.
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

| #   | Title | Status |
| --- | ----- | ------ |

<!-- rfc-index:end -->
