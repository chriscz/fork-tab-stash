# Tab Stash

[![ci](https://github.com/josh-berry/tab-stash/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/josh-berry/tab-stash/actions?query=branch%3Amaster+)
[![codecov](https://codecov.io/gh/josh-berry/tab-stash/branch/master/graph/badge.svg)](https://codecov.io/gh/josh-berry/tab-stash)

Can't keep all your tabs straight? Need to clear your plate, but want to come
back to your tabs later?

Tab Stash is a no-fuss way to save and organize batches of tabs as bookmarks.
Sweep your browser clean with one click of the Tab Stash icon (if configured).
Your open tabs will be stashed away in your bookmarks, conveniently organized
into groups. When it's time to pick up where you left off, open Tab Stash and
restore just the tabs or groups you want.

<img src="docs/screenshot.png" alt="Screenshot" width="100%"/>

## Want to give it a try?

Install Tab Stash from [Mozilla Add-Ons][amo]!

[amo]: https://addons.mozilla.org/firefox/addon/tab-stash/

## Build and Packaging Instructions

You'll need a UNIX-like system (e.g. Mac or Linux) to build Tab Stash.
Unfortunately, building on Windows is not supported due to the multiple build
steps involved (although patches to make the build more cross-platform are
welcome). Here's what you need to do:

1. Install dependencies. You can use the handy `install-deps.sh` script to do
   it automatically on supported OSes/distros (latest macOS and Ubuntu 22.04 are
   known to work). Or if you prefer to do it manually, install the following:
   - GNU `make`, `git`, `diff`, `patch`, `rsync`, `zip` (plus the usual set of
     standard UNIX utilities like `mkdir`, `sed`, etc.)

   - Node.js and `npm` (the latest "Current" or "LTS" release)

   - Inkscape version 1.0 or newer--the CLI must be available as `inkscape` in
     your PATH. (Note that Inkscape is known _not_ to work when installed via
     `snap`; if you're on Ubuntu, please install it with `apt-get` instead.)

2. **To build a debug/development version:** Run `make`. (You can use `-j<...>`
   if you want for a parallel build.)

3. **To build a release version (for packaging or review):**
   1. Make sure your source tree has no uncommitted changes (`git status` should
      say, `nothing to commit, working tree clean`).

   2. `git checkout` the tag for the version you want to build. (Mozilla
      reviewers, you can skip this step--the provided source bundle should
      already have the correct tag checked out.)

   3. Run `make rel`. (You can use `-j<...>` if you want for a parallel build.)

4. You'll get the following artifacts:
   - `dist`: The unpacked Firefox extension

   - `dist-chrome`: A highly-experimental Manifest V3 port to Chrome 148 or
     newer (also unpacked). `make pkg-chrome` packs a release build of it.

   - (release builds only) `releases/tab-stash-X.XX-hhhhhhh.zip`: The packed
     Firefox extension (this is what gets uploaded to AMO)

   - (release builds only) `releases/tab-stash-src-X.XX-hhhhhhh.tar.gz`: A clean
     git checkout of the source tree for the release (also for uploading to AMO)

### Building with Docker

If you have Docker, you can skip installing dependencies. The provided
`Dockerfile` builds an Ubuntu image with everything `install-deps.sh` installs.
Your source tree is mounted into the container, so build artifacts end up in the
same places as above:

```sh
bin/dev image build   # build (or rebuild) the image
bin/dev run make      # or `make rel` for a release version
bin/dev shell         # open a temporary shell in the container
```

`bin/dev run make check-e2e` runs the end-to-end tests in Chrome and Firefox.
They are supported only inside the dev Docker image (on macOS, use Colima or a
similar Docker runtime).

Run `bin/dev help` to see all commands.

To use Docker directly instead of `bin/dev`:

```sh
docker build -t tab-stash-dev .
docker run --rm -it -u "$(id -u):$(id -g)" -v "$PWD":/src tab-stash-dev make
```

Replace `make` with `make rel` to build a release version.

## Want to help out?

If you're interested in contributing to Tab Stash, be sure to read [the
contributing guidelines][contrib] to get oriented and learn how to submit your
changes for inclusion in future releases.

[contrib]: docs/contributing.md

## Want to re-distribute Tab Stash?

You're more than welcome to do so according to the terms of the
[license](LICENSE), and I'm happy to work with you to make sure Tab Stash users
have a great experience on your platform. I do have a couple requests, though:

- Please _only_ ship release packages that are built using `make rel` per the
  instructions above. Debug builds may cause performance problems or include
  other changes that make for a poor user experience.

- If you find it necessary to apply patches to Tab Stash, please work with me
  _ahead of time_ to get your proposed changes merged into a release. I
  unfortunately cannot provide support to users running patched builds. (If
  your patch introduces a bug, it's going to cause a lot of headache for the
  user only for me to have to tell them to install the official version.)
