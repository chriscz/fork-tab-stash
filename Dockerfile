# Dev image: docker build -t tab-stash-dev . && docker run --rm -it -u "$(id -u):$(id -g)" -v "$PWD":/src tab-stash-dev make
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
# install-deps.sh expects sudo + lsb_release
RUN apt-get update && apt-get install -y --no-install-recommends sudo lsb-release
COPY install-deps.sh /tmp/
RUN /tmp/install-deps.sh && rm -rf /var/lib/apt/lists/* /tmp/install-deps.sh

# Source is bind-mounted at runtime, so nothing is copied in
WORKDIR /src
RUN git config --system --add safe.directory /src
