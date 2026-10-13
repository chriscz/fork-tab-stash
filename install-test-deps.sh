#!/bin/sh

# Dev image build script (run from the Dockerfile, not by hand): installs the
# tools for the end-to-end tests (make check-e2e): Puppeteer and the Chrome for
# Testing and Firefox builds it drives.  The e2e tests are supported only inside
# the dev Docker image (`bin/dev run make check-e2e`); on macOS, use Colima or a
# similar Docker runtime.  These tools are kept out of package.json so normal
# builds don't download a browser.

set -ex

# Bump all three together: Puppeteer only launches the browser builds it was
# released with.
PUPPETEER_VERSION=25.13.0
CHROME_VERSION=155.0.8059.39
FIREFOX_VERSION=stable_157.0.1
JS_YAML_VERSION=5.4.3

# Respect PUPPETEER_CACHE_DIR so the browser can live somewhere every user can
# read (the dev image runs as the host user's UID); otherwise use Puppeteer's
# default per-user cache.
CACHE_DIR="${PUPPETEER_CACHE_DIR:-$HOME/.cache/puppeteer}"

# Skip the postinstall download: under sudo it would land in root's cache.
sudo env PUPPETEER_SKIP_DOWNLOAD=1 npm install -g \
    "puppeteer@$PUPPETEER_VERSION" "js-yaml@$JS_YAML_VERSION"

# --install-deps runs apt-get for Chrome's system libraries, so it needs root
# and fresh package lists.
sudo apt-get update
sudo env PUPPETEER_CACHE_DIR="$CACHE_DIR" \
    puppeteer browsers install "chrome@$CHROME_VERSION" --install-deps

# --install-deps only knows Chrome's libraries.  Firefox ships as a .tar.xz and
# needs a few more (most of its GTK stack came in with Chrome's).  Ubuntu's own
# firefox package is a snap shim that doesn't work in Docker.  The "t64" package
# names are Ubuntu 24.04+ (Docker on 24.04 is the supported path).
sudo apt-get install -y --no-install-recommends xz-utils \
    libgtk-3-0t64 libdbus-glib-1-2 libasound2t64 libx11-xcb1 libxtst6 libpci3
sudo env PUPPETEER_CACHE_DIR="$CACHE_DIR" \
    puppeteer browsers install "firefox@$FIREFOX_VERSION"
sudo chown -R "$(id -u):$(id -g)" "$CACHE_DIR"
sudo chmod -R a+rX "$CACHE_DIR"

set +ex
echo
echo ">>> All done!  Run the end-to-end tests with: bin/dev run make check-e2e"
echo
