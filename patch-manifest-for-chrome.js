// Generates Chrome's Manifest V3 manifest from the Firefox (MV2) one, so that
// changes to assets/manifest.json carry over to Chrome automatically.  Missing
// keys make this throw, which fails the build.

import manifest from "./assets/manifest.json" with {type: "json"};

manifest.manifest_version = 3;
// Chrome 148 exposes extension APIs natively as browser.*.
manifest.minimum_chrome_version = "148";
delete manifest.browser_specific_settings;

const permsToDrop = [
  "tabHide",
  "browserSettings",
  "contextualIdentities",
  "cookies",
];
manifest.permissions = manifest.permissions
  .filter(p => !permsToDrop.includes(p))
  .concat(["alarms"]);

const scripts = manifest.background.scripts;
if (scripts.length !== 1) {
  throw new Error(`expected exactly one background script`);
}
manifest.background = {service_worker: scripts[0]};

manifest.action = manifest.browser_action;
delete manifest.browser_action;
delete manifest.action.theme_icons;
delete manifest.action.browser_style;
if (!manifest.action.default_icon) {
  throw new Error(`browser_action.default_icon key not found`);
}
// Chrome doesn't support SVG icons; the build makes these PNGs.
for (const k in manifest.action.default_icon) {
  manifest.action.default_icon[k] = `icons/logo-${k}.png`;
}

delete manifest.page_action;
delete manifest.sidebar_action;

delete manifest.options_ui.browser_style;
manifest.options_ui.open_in_tab = true;

// Wrapping an undefined policy would not throw, so check it explicitly.
if (typeof manifest.content_security_policy !== "string") {
  throw new Error(`content_security_policy key missing`);
}
manifest.content_security_policy = {
  extension_pages: manifest.content_security_policy,
};

const commands = manifest.commands;
commands._execute_action = commands._execute_browser_action;
commands._execute_action.suggested_key.default = "Alt+Shift+T";
delete commands._execute_browser_action;
delete commands._execute_sidebar_action;
delete commands._execute_page_action;

console.log(JSON.stringify(manifest, undefined, 2));
