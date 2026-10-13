# RFC 0001: Support Google Chrome via a separate Manifest V3 manifest

- Status: draft
- Author(s): Chris Coetzee, Claude
- Date: 2026-10-13
- Links: none yet.
- Precondition: the maintainer (@josh-berry) must agree on a GitHub issue that Tab Stash should support Chrome, and approve AI-assisted work on it (`AGENTS.md`). Link that issue here before any implementation.

## Problem

Chrome users, and developers testing Tab Stash's experimental Chrome port, can no longer run it. `make build-chrome-dbg` produces a Manifest V2 extension. Chrome has disabled MV2 extensions for all users since Chrome 138 [R1]. Google's documentation does not say whether _unpacked_ MV2 extensions still load, but third-party reports say Chrome 151 removed the last workaround [R1].

## Background

**Firefox and Chrome have diverged on MV2.** Firefox has no plans to drop MV2 and promises at least 12 months' notice if that changes [R2]. Chrome's MV3 requires a service worker as the background context [R3]. Firefox's MV3 does not support service workers and uses non-persistent event pages instead [R4].

**How the Chrome build works today.** `build-chrome-dbg` (`Makefile:137-142`) copies `dist/` to `dist-chrome/` and pipes `assets/manifest.json` through `patch-manifest-for-chrome.js`. The script:

- removes the Firefox-only permissions (`tabHide`, `browserSettings`, `contextualIdentities`);
- deletes `page_action` and `sidebar_action`;
- changes a key binding;
- points the toolbar icons at `icons/logo-{16,32,64}.svg`. Those files don't exist, because the build produces only `logo.svg` and PNGs (`Makefile:174-180`). Chrome doesn't support SVG icons anyway [R19].

The output still says `"manifest_version": 2`. No Chrome release target exists. `rel` (`Makefile:58`), `pkg-webext` (`:104`) and `build-rel` (`:152-160`) are Firefox-only.

**What the background does.** UI pages build their own tabs, bookmarks, options and containers models directly from browser APIs (`src/globals-ui.ts:61-93`). They depend on the background for three things:

1. **The three IndexedDB stores** (`deleted_items`, `favicons`, `bookmark-metadata`). The background serves them over `runtime.connect` ports (`src/service-model.ts:15-41`, `src/util/nanoservice/live.ts`).
2. **Context-menu and toolbar-button handlers** (`src/index.ts:314`, `:348`, `:366`), including popup mode (`setupPopup`, `:322-346`) and the button title (`:398-418`).
3. **Recurring jobs:**
   - auto-discarding hidden tabs (`src/index.ts:502-560`);
   - closing hidden tabs whose bookmarks were removed (`:440-470`);
   - a daily `model.gc()`, which also runs once at every startup (`:576`, `:582-584`).

**Why the background code does not survive as a service worker.** Chrome stops an extension service worker after 30 seconds without events or extension API calls [R5]. On restart it re-runs the script from the top. Chrome documents that listeners must be registered synchronously during that first run so that it can deliver the waking event [R3] [R20].

Tab Stash's background runs almost entirely inside `logErrorsFrom(async () => {...})` (`src/index.ts:20`). It awaits the full model load (`:28`) before registering any user-facing listener. The only listener registered at load time is `storage.onChanged` (`src/datastore/stored-object.ts:226`):

| Listener                                     | Where it is registered                                        | Registered after               |
| -------------------------------------------- | ------------------------------------------------------------- | ------------------------------ |
| `runtime.onConnect` (IndexedDB store ports)  | `src/util/nanoservice/live.ts:75`                             | all model loads                |
| `contextMenus.onClicked`                     | `src/index.ts:314`                                            | model load                     |
| `browserAction.onClicked`                    | `src/index.ts:348`                                            | model load                     |
| `bookmarks.on{Changed,Moved,Removed}` (GC)   | `src/index.ts:466-468`                                        | model load and `urlsInStash()` |
| tabs, bookmarks, windows, `tabGroups` models | `src/model/tabs.ts:217-233`, `src/model/bookmarks.ts:192-195` | opening the IndexedDB stores   |

Five smaller breakages:

- **Timers.** `setTimeout` timers die with the worker. Chrome's replacement is `chrome.alarms` [R3] [R6].
- **`navigator.storage.persist()`.** `KVSService.open` calls it (`src/datastore/kvs/service.ts:24-25`), and it isn't available in workers [R14]. In a worker, opening all three stores would fail.
- **Toolbar-button checks.** They use `if (browser.browserAction)` (`src/index.ts:322`, `:413`), and MV3 renames the namespace to `action` [R7], so the button would silently stop working. The unguarded calls in `show_popup` (`:178-183`) would throw.
- **Context menus.** The toolbar right-click menu uses the `browser_action` context (`src/index.ts:131-142`). Chrome documents `action` as the context for the toolbar button [R22]. `menu()` drops any context the browser does not list (`:73-89`), so that menu may silently disappear.
- **Startup GC.** The unconditional `gc()` at startup (`src/index.ts:584`) would run on every wake instead of once per browser session.

**Some differences are Chrome's, not MV3's.** Chrome lacks four Firefox features, and the code already feature-detects each one:

- `tabs.hide` [R8], checked with `!!browser.tabs.hide` (`src/model/tabs.ts:636`, `src/index.ts:43`). On Chrome, stashing closes tabs instead of hiding them.
- `sessions.setTabValue`/`getTabValue` [R9].
- `sidebar_action` (Chrome has the separate `sidePanel` API [R10]), checked with `sidebarAction` (`src/index.ts:103`).
- Containers, checked with `contextualIdentities` (`src/model/containers.ts:21-30`).

**The polyfill.** Every file imports `browser` from `webextension-polyfill` 0.12, which Mozilla archived on 2026-07-30 [R11]. Chrome 148 and later expose all extension APIs natively as `browser.*` with promise-based return values [R12]. On those versions the polyfill returns the native object unchanged.

## Goals

1. On Chrome, these work from an MV3 build:
   - stashing all tabs, the current tab and pinned tabs;
   - copying tabs to the stash;
   - restoring;
   - the stash list in a tab and in popup mode;
   - deleted items and undelete;
   - every context menu, including the toolbar right-click menu.
2. The Firefox build stays MV2. `assets/manifest.json` and the shipped Firefox behaviour do not change.
3. Both builds come from one source tree and one background entry point (`src/index.ts`).
4. The Chrome manifest lives in its own file, readable without running a script.
5. The Chrome build keeps working when Chrome stops the idle service worker between events and starts it again.

## Non-goals

- **Moving Firefox to MV3.** Firefox supports MV2 with no end date [R2]. Switching would change permission prompts and background lifetime for every existing user.
- **Hiding tabs on Chrome.** Chrome has no equivalent API [R8]. Chrome keeps today's fallback of closing stashed tabs.
- **A Chrome side panel.** `chrome.sidePanel` [R10] is a separate UI feature for a later RFC. Chrome keeps today's behaviour of opening the stash list in a tab.
- **Surviving a stop in the middle of an event.** Chrome stops a worker mid-event only after five minutes [R5]. No Tab Stash operation runs that long.
- **Publishing to the Chrome Web Store.** That needs a separate developer account and listing [R13], and it is the maintainer's decision.
- **Replacing `webextension-polyfill`.** It still works, and removing it touches every file. That belongs in its own RFC.
- **Containers on Chrome.** Chrome has no equivalent.

## Proposal

We propose three changes:

1. Add a static MV3 manifest for Chrome.
2. Make the shared background tolerate restarts. On Firefox this is a refactor with no visible change.
3. Add Chrome-only code paths that are inert on Firefox.

### 1. A separate Chrome manifest: `assets/manifest-chrome.json`

This new file replaces `patch-manifest-for-chrome.js`. It is a complete, hand-maintained MV3 manifest:

```jsonc
{
  "manifest_version": 3,
  "minimum_chrome_version": "148", // native browser.* namespace [R12]
  "default_locale": "en",
  "name": "__MSG_extensionName__",
  "version": "0.0", // replaced at build time, see below
  "description": "__MSG_extensionDescription__",
  "homepage_url": "https://josh-berry.github.io/tab-stash/",
  "icons": {"16": "icons/logo-16.png", "...": "same as Firefox"},
  "permissions": [
    "sessions",
    "tabs",
    "tabGroups",
    "bookmarks",
    "contextMenus",
    "storage",
    "unlimitedStorage",
    "alarms",
  ],
  "background": {"service_worker": "index.js"},
  "action": {
    "default_title": "__MSG_extensionName__",
    "default_icon": {
      "16": "icons/logo-16.png",
      "32": "icons/logo-32.png",
      "64": "icons/logo-64.png",
    },
  },
  "options_ui": {"page": "options.html", "open_in_tab": true},
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self';",
  },
  "commands": {
    "_execute_action": {"suggested_key": {"default": "Alt+Shift+T"}},
  },
}
```

Compared with today's patched output:

- **Background.** `background.service_worker` replaces `background.scripts` [R3].
- **Toolbar button.** `action` and `_execute_action` replace `browser_action` and `_execute_browser_action` [R7].
- **Security policy.** The content security policy becomes an object [R15].
- **Icons.** They point at PNGs the build already produces (`TOOLBAR_ICONS`, `Makefile:178-180`). This fixes today's paths to non-existent SVGs. `theme_icons` goes, because Chrome doesn't support it [R16].
- **Permissions.** `alarms` is added. `cookies` is dropped: no code calls `browser.cookies`, and `cookieStoreId` is read only from Firefox tabs and containers (`src/model/tabs.ts:243`, `src/model/containers.ts:84`).

**The background bundle needs no format change.** Vite already emits `src/index.ts` as one self-contained file: the built `dist/index.js` contains no `import` or `export` statements and no dynamic imports. It therefore runs as a classic worker script.

**The version has one source of truth.** `assets/manifest.json` stays the only place the version is set. The Chrome build copies `manifest-chrome.json` and overwrites its `version` field with Firefox's. That is a two-line Node script, `stamp-chrome-manifest.js`, replacing the 26-line patch script.

**Makefile changes:**

- `build-chrome-dbg` uses `stamp-chrome-manifest.js` in place of `patch-manifest-for-chrome.js`.
- A new `build-chrome-rel` target does the same for release builds.
- A new `pkg-chrome` target zips the release build into `releases/tab-stash-chrome-X.XX.zip`.
- A new `check-chrome-manifest` target fails if any file the Chrome manifest references is missing from `dist-chrome/`.
- `rel` stays Firefox-only until the maintainer decides to ship Chrome.

### 2. A shared background that tolerates restarts

These changes apply to both builds. On Firefox they must not change visible behaviour.

**a. Register every waking listener synchronously, and keep handlers synchronous when the model is loaded.** Firefox only lets the extension open the sidebar or a popup before the handler's first `await` (`src/index.ts:159-161`, `:244-246`, `:323-327`). Today every handler runs with the model already loaded and calls `show_something()` synchronously. We keep that path exactly and add an async path for cold starts:

```ts
// src/index.ts (sketch)
let loaded: Model | undefined; // set when the model finishes loading
let loading: Promise<Model> | undefined;
function model(): Promise<Model> {
  loading ??= service_model().then(
    m => (loaded = m),
    e => {
      loading = undefined;
      throw e;
    }, // let the next event retry
  );
  return loading;
}
void model(); // start loading immediately, as today

/** Runs `fn` synchronously if the model is loaded (always true on Firefox
 * after startup, preserving gesture rules), else after it loads (Chrome cold
 * wake, where there is no sidebar to open). */
function withModel<A extends unknown[]>(fn: (m: Model, ...a: A) => unknown) {
  return (...a: A) =>
    loaded
      ? fn(loaded, ...a)
      : model()
          .then(m => fn(m, ...a))
          .catch(console.log);
}

browser.contextMenus.onClicked.addListener(
  withModel((m, info, tab) => {
    const cmd = (<string>info.menuItemId).replace(/^[^:]*:/, ""); // as today
    const t = tab?.id ? m.tabs.tab(tab.id) : undefined;
    commands[cmd](t).catch(console.log); // commands close over `loaded`
  }),
);
```

The toolbar button handler, `pageAction.onClicked` and `alarms.onAlarm` follow the same pattern. On Firefox, a click arriving during the first second of startup used to find no listener at all. Now it waits for the model, so startup behaviour is no worse than before.

**b. Leave the model's own sync listeners where they are.** The tabs and bookmarks models register their listeners in their constructors (`src/model/tabs.ts:217-233`, `src/model/bookmarks.ts:192-195`) to keep in-memory state current. They run after an `await`. Chrome documents only top-level registration as the way to get events on start [R20], so we do not count on these listeners to wake the worker. On every wake the model rebuilds from `tabs.query` and `bookmarks.getSubTree`, so it starts from current browser state either way. Phase 0 measures which events actually wake the worker.

**c. Register the IndexedDB store services synchronously and open the databases lazily.**

- **Constructor change.** `KVSService`'s constructor changes from taking an open `IDBPDatabase` (`src/datastore/kvs/service.ts:51-56`) to taking a `Promise<IDBPDatabase>`. Every `KeyValueStore` method awaits it, so requests that arrive while the database is opening wait for it.
- **Registration moves earlier.** The three `listen()` calls move to the top of `src/index.ts`. `listen()` adds the `runtime.onConnect` listener only when the first service registers (`src/util/nanoservice/live.ts:59-82`). That works around Firefox bug 1465514, where dropping a connection could drop unrelated ones. The workaround still holds: all three services register in the same synchronous run, before any connection can arrive, so no connection is dropped for an unknown service.
- **Failure handling.** If `openDB` fails, every request rejects with that error, and `KVSClient` retries with backoff (`src/datastore/kvs/client.ts:101-123`).
- **Firefox timing.** The favicons model writes to its store while it is constructed, so the databases still open at startup.

**d. Guard `navigator.storage.persist()`.** In `src/datastore/kvs/service.ts:24-25`, call `persisted()`/`persist()` only when `persist` exists. In Chrome's service worker it doesn't [R14], and Chrome's `unlimitedStorage` permission already "exempts extensions from both quota restrictions and eviction" [R18]. Firefox's behaviour is unchanged.

**e. Alias the toolbar-button namespace.** Add `const action = browser.action ?? browser.browserAction` and use it everywhere the code uses `browser.browserAction`:

- `onClicked`
- `setPopup`
- `openPopup`
- `setTitle`
- the `show_popup` calls at `src/index.ts:178-183`

On Firefox it resolves to `browserAction`.

**f. Typing.** `@types/webextension-polyfill` describes MV2 and has no `browser.action` or `browser.alarms` types. We add a small local declaration in `src/util/browser-mv3.d.ts` rather than `any` casts at call sites.

### 3. Chrome-only paths

Each of these is gated on a feature Firefox's MV2 build lacks, so Firefox never runs it.

**a. Context menus.**

- **Context names.** When `browser.action` exists, `menu()` maps the `browser_action` context to `action` [R22]. The `page_action` menu (`src/index.ts:144-155`) already filters out on Chrome, because Chrome has no page action.
- **Re-creation.** We have not verified whether Chrome keeps menus across worker or browser restarts [R22]. So on Chrome we `await browser.contextMenus.removeAll()` and re-create the menus on every wake. During those few milliseconds a click can find no menu, but the click itself wakes the worker and the menu is rebuilt.

**b. Popup mode.** `setupPopup` (`src/index.ts:328-345`) runs on every wake. We have not verified whether `setPopup` survives a restart [R7]. Re-applying it costs one API call and doesn't depend on the answer. When a popup is set, Chrome opens it without waking the worker.

**c. Recurring jobs.**

- **Hidden-tab jobs.** Auto-discarding hidden tabs (`src/index.ts:502-560`) and closing hidden tabs for removed bookmarks (`:440-470`) can never find a hidden tab on Chrome. We wrap both in `if (browser.tabs.hide)`, like the rest of the hidden-tab code.
- **Daily GC.** When `browser.alarms` exists, `index.ts` calls `alarms.get("gc")` and creates the 24-hour alarm only if it is missing. Calling `create` unconditionally would reset the schedule on every wake, because "it will be cancelled and replaced by this alarm" [R6].
- **GC at startup.** The startup `gc()` call moves to `runtime.onStartup` on Chrome, so it runs once per browser session, as on Firefox.
- **Firefox.** Its manifest does not request `alarms`, so it keeps its `setTimeout` loops and its startup `gc()` unchanged.

### Before and after

| Concern                 | Firefox today          | Firefox after                    | Chrome after                          |
| ----------------------- | ---------------------- | -------------------------------- | ------------------------------------- |
| Manifest                | `manifest.json`        | unchanged                        | `manifest-chrome.json` (MV3)          |
| Background lifetime     | persistent page        | persistent page                  | service worker, stopped when idle     |
| Waking listeners        | after model load       | top-level, sync                  | top-level, sync                       |
| Handler with model      | synchronous            | synchronous (gesture rules kept) | async on cold wake, sync while warm   |
| IndexedDB stores opened | at startup             | at startup                       | at each wake                          |
| Toolbar button API      | `browserAction`        | `browserAction` (via alias)      | `action` (via alias)                  |
| Popup mode              | `setPopup` at startup  | unchanged                        | `setPopup` re-applied on each wake    |
| Context menus           | created at startup     | unchanged                        | removed and re-created on each wake   |
| Daily GC                | `setTimeout` + startup | unchanged                        | `chrome.alarms` + `runtime.onStartup` |
| Stashing                | hides tabs             | hides tabs                       | closes tabs (existing fallback)       |
| Sidebar                 | `sidebar_action`       | unchanged                        | none; stash list opens in a tab       |

## Alternatives considered

**Keep generating the Chrome manifest from the Firefox one.** We could extend `patch-manifest-for-chrome.js` to emit MV3. The script would then have to rewrite the background, action, commands, the security policy, permissions and icons, which is more transformation than content. A reviewer could no longer see what Chrome receives without running it. Today's script already hides one bug that way: it points the icons at files that don't exist. We chose a static file and accepted the drift risk (see Tradeoffs). Copying only the version keeps the one field that must match automatic.

**One MV3 manifest for both browsers.** A single manifest can declare both `background.scripts` and `background.service_worker`, and each browser uses the one it supports [R4]. This moves Firefox to MV3, which breaks Goal 2: background lifetime changes for every Firefox user, and so do MV3's host-permission rules [R17]. Firefox gives no reason to switch now [R2].

**A separate Chrome background entry point (`src/index-chrome.ts`).** This would leave the Firefox code untouched, at the cost of copying most of the 585 lines of `src/index.ts`. Every future menu item, command or GC change would then have to land twice. Section 2's changes are small and keep Firefox's behaviour, so we prefer one entry point.

**Keep the worker alive.** Long-lived messaging and extension API calls reset Chrome's idle timer [R5], so a ping loop could keep the in-memory model alive and avoid the restructure. Chrome's guidance is to "avoid keeping your service worker alive indefinitely if possible" and to be "resilient against unexpected termination" [R5]. A Chrome team member has said they may act against extensions that do this without a clear need [R21]. Chrome can also still stop the worker when a single event runs over five minutes [R5].

**Host the model in an offscreen document.** Chrome's offscreen documents can hold state and DOM [R3], and their messages reset the worker's idle timer [R5]. This adds a third execution context with its own lifecycle, in place of the simpler fix of rebuilding state on wake.

## Tradeoffs and risks

- **Firefox carries refactoring risk for a Chrome feature.**
  - **The risk.** Section 2 changes listener and startup order in `src/index.ts` and `src/service-model.ts`. Both are excluded from coverage (`c8 ignore`). A mistake ships to every Firefox user, and the gesture rule in 2a is easy to break silently.
  - **Mitigation.** A Chrome spike (Phase 0) proves the design before Firefox code changes. Phase 1 lands Section 2 alone, with a behavioural checklist and a named rollback.
- **The two manifests will drift.** A new permission, command or locale key added to `manifest.json` won't reach `manifest-chrome.json` unless someone remembers. A `check-manifests` target could diff the permission and command lists (see Open questions). `check-chrome-manifest` catches only missing files.
- **Every cold wake rebuilds the whole model.** The first click or reconnect after 30 seconds idle runs, before the extension acts:
  - `tabs.query({})` and `tabGroups.query` (`src/model/tabs.ts:280-325`);
  - a bookmark subtree walk (`src/model/bookmarks.ts:172-176`);
  - a second `tabs.query` for favicons (`src/model/favicons.ts:45`).

  The wake sources are the top-level listeners in 2a (menus, toolbar button, `onConnect` from UI pages, alarms). We have no measurements yet. Phase 0 measures cold-wake latency and wakes per hour of normal browsing.

- **Open UI pages may lose their store connection.**
  - **When it happens.** Chrome documents that _sending_ over a port keeps the worker alive [R5]. If an idle open port does not, Chrome can stop the worker under an open stash list.
  - **Recovery.** `KVSClient` reconnects immediately and fires `onSyncLost` (`src/datastore/kvs/client.ts:84-99`), and Section 2c ensures the services are listening before any connection arrives.
  - **What can still go wrong.** The service's client list (`src/datastore/kvs/service.ts:177-183`) is lost on restart, so broadcasts reach only clients that have reconnected. A page could show stale deleted items until its next request. Phase 3 tests this.
- **Chrome is a weaker product than Firefox.** Stashing closes tabs, there is no sidebar and there are no containers. Chrome users will file bugs about these gaps.
- **Chrome 148 is the minimum.** Older Chrome versions, and Chromium-based browsers that lag behind Chrome's versions, cannot install the extension.
- **The polyfill is archived [R11].** Tab Stash depends on unmaintained code on both browsers. This RFC doesn't make that worse, but it doesn't fix it either.

## Rollout

**Phase 0: Chrome spike (not merged).**

- **Build:** on a throwaway branch, apply Section 1 plus a minimal version of 2a, 2c, 2d and 2e, and load it in current stable Chrome.
- **Measure:**
  - **Idle port.** Does an idle open port keep the worker alive (Open question 3)?
  - **Wake sources.** Which events wake the worker?
  - **Latency.** What is the cold wake-to-action latency with 500 open tabs and 2,000 stashed bookmarks?
  - **Context menus.** Does Chrome accept the `browser_action` context in MV3 (Open question 7)?
- **Exit criteria:** record the answers in this RFC. If cold wake exceeds 1 second, revise Section 2 before Phase 1, for example by loading only the bookmarks model for menu commands.
- **Owner:** whoever implements Phase 1.

**Phase 1: Shared background refactor (Firefox-visible, no behaviour change).**

- **Work:** land Section 2 (a–f).
- **Exit criteria:** `make` passes, `git diff master -- assets/manifest.json` is empty, and this checklist passes in Firefox:
  - the toolbar button opens the sidebar;
  - the context menu "Show stashed tabs in sidebar" opens the sidebar;
  - popup mode shows the popup;
  - a fresh profile shows the setup page on first toolbar click;
  - stash a window, a single tab and a link from the context menu;
  - restore a tab;
  - delete and undelete a bookmark;
  - deleted items are still listed after a browser restart;
  - hidden tabs are discarded after the configured interval.
- **Rollback:** revert the PR and cut a point release.
- **Ships in:** a normal Firefox release.

**Phase 2: Chrome manifest, build targets and Chrome-only paths.**

- **Work:**
  - add `assets/manifest-chrome.json` and `stamp-chrome-manifest.js`, and delete `patch-manifest-for-chrome.js`;
  - add Section 3;
  - update `build-chrome-dbg`, and add `build-chrome-rel`, `pkg-chrome` and `check-chrome-manifest`.
- **Exit criteria:**
  - `check-chrome-manifest` passes;
  - `dist-chrome/` loads unpacked in current stable Chrome with no errors on `chrome://extensions` or in the service worker console;
  - the toolbar icon renders.

**Phase 3: Chrome functional and restart testing.**

- **Cold-start check:** with a fresh profile, every Goal 1 item works.
- **Restart check:** stop the worker by hand (the "service worker" link on `chrome://extensions`, then _Stop_ in DevTools). Then confirm each of these works on the first try:
  - the toolbar button, in normal and popup mode;
  - every context-menu item, including the toolbar right-click menu;
  - opening the stash list and the deleted items page.
- **Open-page check:** stop the worker with the stash list open, delete a bookmark, and confirm the deleted items page shows it.
- **GC alarm check:** run `chrome.alarms.get("gc")` before and after a stop and wake, and confirm `scheduledTime` is unchanged.

**Phase 4: Distribution.** The maintainer decides. It needs a Chrome Web Store developer account and listing [R13]. Until then, Chrome builds are for developers only.

Phases 1–3 are separate PRs. If Phase 2 or 3 stalls, Phase 1 still stands, because Phase 0 has already shown the design works on Chrome.

## Success criteria

- **Firefox:** `assets/manifest.json` is unchanged, and the Phase 1 Firefox checklist passes.
- **Chrome loads:** `make build-chrome-dbg` produces an extension that current stable Chrome loads without errors, with a visible toolbar icon.
- **Chrome works:** every Goal 1 item works in Chrome, both from a cold start and after a forced worker stop.
- **GC:** the `gc` alarm exists and its `scheduledTime` does not move across worker stops.
- **Cleanup:** `patch-manifest-for-chrome.js` no longer exists.
- **Latency:** cold wake-to-action latency is recorded in this RFC. Phase 0 gates on 1 second; no bound is promised after that.

## Security, privacy, operational impact

**Security:**

- The Chrome build requests fewer permissions than Firefox: no `tabHide`, `browserSettings`, `contextualIdentities` or `cookies`, and one addition, `alarms`.
- It requests no host permissions.
- MV3's security policy forbids remote code and `unsafe-eval` [R15]. Tab Stash already uses `script-src 'self'` (`assets/manifest.json`), so nothing in it relies on either.

**Privacy:**

- No new data is collected or sent.
- The stores stay in local IndexedDB, which Chrome shares between the worker and extension pages [R18].

**Operations:**

- **New artifact:** one more release artifact (`pkg-chrome`) once the maintainer chooses to ship.
- **Support load:** a new class of bug reports, from Chrome users.
- **Store account:** a Chrome Web Store account if the extension is published [R13].
- **Firefox:** Firefox has no telemetry for startup errors. The Phase 1 checklist is the only gate, and the rollback is a revert plus a point release.

## Open questions

1. **Does the maintainer want to support Chrome at all?** See Precondition. _Resolve in RFC_, before any implementation.
2. **Should the version be stamped into the Chrome manifest or checked for equality?** Stamping (proposed) needs no extra step at release. A check keeps `manifest-chrome.json` fully static. _Resolve in RFC._
3. **Does an open but idle `runtime.connect` port keep a Chrome extension service worker alive?** Chrome documents only that sending messages does [R5]. This decides how often open pages hit the reconnect path. _Resolve in Phase 0._
4. **How slow is a cold wake, and how often does it happen?** _Resolve in Phase 0_, with the 1-second gate.
5. **Does Chrome need the `cookies` permission?** Resolved: no. See Section 1.
6. **Should a `check-manifests` target guard against drift?** _Resolve in implementation._ Cheap if wanted.
7. **Does Chrome's MV3 accept the `browser_action` menu context, or only `action`?** Chrome's reference lists `action` [R22]; we have not confirmed whether `browser_action` is rejected. Section 3a maps it either way. _Resolve in Phase 0._
8. **Do Chrome's context menus and `setPopup` persist across worker restarts?** Unverified [R7] [R22]. Sections 3a and 3b re-apply both on each wake, so the design doesn't depend on the answer. If they do persist, re-applying them is optional. _Resolve in implementation._
9. **Can `action.openPopup()` run on Chrome without a user gesture?** It is needed for "show popup" from a context menu after a cold wake. Chrome's reference mentions only policy-installed restrictions for Chrome 118–126 [R7]. _Resolve in Phase 0._
10. **Chrome side panel.** _Defer_ to a later RFC.
11. **Replacing `webextension-polyfill`.** _Defer_ to a later RFC.

## References

All external claims were checked on 2026-10-13. Third-party sources are marked as such.

- **[R1]** Chrome MV2 deprecation timeline. MV2 extensions are disabled on all channels from Chrome 138 with no way to re-enable them, and the `ExtensionManifestV2Availability` policy was removed in Chrome 139. https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline. Loading _unpacked_ MV2 is not covered there. Third-party reports say Chrome 151 removed the last workaround: https://www.superchargebrowser.com/library/chrome-manifest-v2-vs-v3-extensions/ and https://github.com/uBlockOrigin/uBlock-issues/discussions/3690 (unverified against Google).
- **[R2]** Mozilla, "Manifest V3 & Manifest V2 (March 2024 update)": no plans to deprecate MV2, and at least 12 months' notice if that changes. https://blog.mozilla.org/addons/2024/03/13/manifest-v3-manifest-v2-march-2024-update/. Restated in https://blog.mozilla.org/addons/2024/06/13/manifest-v3-updates-landed-in-firefox-127/ and https://blog.mozilla.org/en/firefox/firefox-manifest-v3-adblockers/. No newer statement found.
- **[R3]** Chrome, "Migrate to a service worker": `service_worker` replaces `scripts`, listeners must be registered synchronously at the top level, there is no DOM (use the Offscreen API), and alarms replace timers. https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers
- **[R4]** MDN, `manifest.json` `background`: Firefox uses `scripts`/`page` as event pages and does not support `service_worker`. A manifest may declare both. https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background. Event pages arrived in Firefox 106: https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/
- **[R5]** Chrome, "The extension service worker lifecycle". https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
  - The worker stops after 30 s of inactivity; events and extension API calls reset the timer (Chrome 110+).
  - A single event or call that takes over 5 minutes also stops it.
  - Sending over long-lived messaging keeps the worker alive (Chrome 114+), and messages from offscreen documents reset the timer (Chrome 109+).
  - Advice: "avoid keeping your service worker alive indefinitely if possible" and be "resilient against unexpected termination".
- **[R6]** Chrome, `chrome.alarms`. https://developer.chrome.com/docs/extensions/reference/api/alarms
  - Creating an alarm whose name already exists means the old one "will be cancelled and replaced by this alarm".
  - The minimum period has been 30 s since Chrome 120 (unpacked extensions are exempt): https://developer.chrome.com/blog/chrome-120-beta-whats-new-for-extensions
  - Chrome 150 added `persistAcrossSessions`, which defaults to true.
  - Chrome advises re-creating alarms when the worker starts.
- **[R7]** Chrome, `chrome.action` and the migration checklist: `browser_action` becomes `action` (Chrome 88+, MV3). `setPopup` and `openPopup` are documented, but neither page says whether `setPopup` persists across restarts or whether `openPopup` needs a user gesture. https://developer.chrome.com/docs/extensions/reference/api/action and https://developer.chrome.com/docs/extensions/develop/migrate/checklist. `_execute_browser_action` becomes `_execute_action`: https://developer.chrome.com/docs/extensions/reference/api/commands
- **[R8]** Chrome, `chrome.tabs`: no `hide`/`show`; `discard` exists (Chrome 54+). https://developer.chrome.com/docs/extensions/reference/api/tabs
- **[R9]** Chrome, `chrome.sessions`: only `getDevices`, `getRecentlyClosed`, `restore` and `onChanged`. https://developer.chrome.com/docs/extensions/reference/api/sessions
- **[R10]** Chrome, `chrome.sidePanel`: Chrome 114+, MV3, needs the `sidePanel` permission. `open()` came in Chrome 116 and requires a user gesture. https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- **[R11]** `mozilla/webextension-polyfill`, archived 2026-07-30. https://github.com/mozilla/webextension-polyfill
- **[R12]** Chrome, "The `browser` namespace": all extension APIs are exposed as `browser.*` from Chrome 148, in service workers too. Google suggests `minimum_chrome_version: "148"` or `globalThis.browser ??= chrome`. https://developer.chrome.com/docs/extensions/develop/concepts/browser-namespace
- **[R13]** Chrome Web Store registration: a one-time fee and 2-Step Verification. https://developer.chrome.com/docs/webstore/register and https://developer.chrome.com/docs/webstore/program-policies/terms
- **[R14]** MDN, `StorageManager.persist()`: "not available in Web Workers, though the StorageManager interface is". https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist. `persisted()` is available in workers: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persisted
- **[R15]** Chrome, manifest `content_security_policy`: an object with `extension_pages` and `sandbox`, and remote code or `unsafe-eval` are not allowed. https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
- **[R16]** MDN browser-compat-data, `action.theme_icons`: Chrome `version_added: false`. https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/manifest/action.json
- **[R17]** Chrome, "Update the manifest": host permissions move to `host_permissions`, and `web_accessible_resources` changes shape. https://developer.chrome.com/docs/extensions/develop/migrate/manifest
- **[R18]** Chrome, "Storage and cookies". IndexedDB in the service worker is shared with extension pages and offscreen documents. `unlimitedStorage` "exempts extensions from both quota restrictions and eviction". https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- **[R19]** Chrome, manifest `icons`: "WebP and SVG files are not supported." https://developer.chrome.com/docs/extensions/reference/manifest/icons
- **[R20]** Chrome, "Events in service workers": handlers must be declared in the global scope so "they are registered synchronously on initial script execution, which enables Chrome to dispatch events to the service worker as soon as it starts". https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/events
- **[R21]** chromium-extensions mailing list, a Chrome team member on keep-alive techniques (a mailing-list post, not a published policy). https://groups.google.com/a/chromium.org/g/chromium-extensions/c/7Ag1vPlb_qU
- **[R22]** Chrome, `chrome.contextMenus`: `action` "applies to the context menu of the extension's action (its toolbar icon)". The page says nothing about whether menus persist across restarts. https://developer.chrome.com/docs/extensions/reference/api/contextMenus

Code references are to commit `6df8b7f` on branch `chore/chriscz`:

- **Background entry:** `src/index.ts`, `src/service-model.ts`
- **Port messaging:** `src/util/nanoservice/live.ts`
- **IndexedDB stores:** `src/datastore/kvs/service.ts`, `src/datastore/kvs/client.ts`
- **Models:** `src/model/tabs.ts`, `src/model/bookmarks.ts`, `src/model/favicons.ts`, `src/model/containers.ts`
- **Shared storage object:** `src/datastore/stored-object.ts`
- **UI globals:** `src/globals-ui.ts`
- **Build:** `vite.config.lib.ts`, `Makefile`, `patch-manifest-for-chrome.js`, `assets/manifest.json`

## History

- 2026-10-13 — draft
