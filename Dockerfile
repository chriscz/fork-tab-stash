# Dev image: docker build -t tab-stash-dev . && docker run --rm -it -u "$(id -u):$(id -g)" -v "$PWD":/src tab-stash-dev make
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
# install-deps.sh expects sudo + lsb_release
RUN apt-get update && apt-get install -y --no-install-recommends sudo lsb-release
COPY install-deps.sh /tmp/
RUN /tmp/install-deps.sh && rm -rf /var/lib/apt/lists/* /tmp/install-deps.sh

# Test-only tools (Puppeteer, Chrome for Testing, Firefox).  Browsers go outside
# any home directory, and NODE_PATH points at npm's global root, so any UID
# can launch them and require("puppeteer").
ENV PUPPETEER_CACHE_DIR=/opt/puppeteer
ENV NODE_PATH=/usr/lib/node_modules
COPY install-test-deps.sh /tmp/
RUN /tmp/install-test-deps.sh && rm -rf /var/lib/apt/lists/* /tmp/install-test-deps.sh

# Source is bind-mounted at runtime, so nothing is copied in
WORKDIR /src
RUN git config --system --add safe.directory /src
