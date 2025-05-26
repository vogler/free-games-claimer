# FROM mcr.microsoft.com/playwright:v1.20.0
# Partially from https://github.com/microsoft/playwright/blob/main/utils/docker/Dockerfile.jammy
FROM ubuntu:jammy

# Configuration variables are at the end!

# https://github.com/hadolint/hadolint/wiki/DL4006
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ARG DEBIAN_FRONTEND=noninteractive

# Install nodejs and deps for virtual display, noVNC, chromium, and pip for installing apprise.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install --no-install-recommends -y \
      nodejs \
      xvfb \
      x11vnc \
      tini \
      novnc websockify \
      dos2unix \
      python3-pip \
    # RUN npx patchright install-deps chromium
    # ^ installing deps manually instead saved ~130MB:
    && apt-get install -y --no-install-recommends \
      libnss3 \
      libnspr4 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libxkbcommon0 \
      libatspi2.0-0 \
      libxcomposite1 \
      libgbm1 \
      libpango-1.0-0 \
      libcairo2 \
      libasound2 \
    && apt-get autoremove -y \
    # https://www.perplexity.ai/search/what-files-do-i-need-to-remove-imjwdphNSUWK98WzsmQswA
    && apt-get clean \
    && rm -rf \
      /var/lib/apt/lists/* \
      /var/cache/* \
      /var/tmp/* \
      /tmp/* \
      /usr/share/doc/* \
    && ln -s /usr/share/novnc/vnc_auto.html /usr/share/novnc/index.html \
    && pip install --no-cache-dir apprise

WORKDIR /fgc
COPY package*.json ./

# --no-shell to avoid installing chromium_headless_shell (307MB) since headless mode could be detected without patching the browser itself
RUN npm install && npx patchright install chromium --no-shell && du -h -d1 ~/.cache/ms-playwright

COPY . .

# Shell scripts need Linux line endings. On Windows, git might be configured to check out dos/CRLF line endings, so we convert them for those people in case they want to build the image. They could also use --config core.autocrlf=input
RUN dos2unix ./*.sh && chmod +x ./*.sh
COPY docker-entrypoint.sh /usr/local/bin/

# set by .github/workflows/docker.yml
ARG COMMIT=""
ARG BRANCH=""
ARG NOW=""
# need as env vars to log in docker-entrypoint.sh
ENV COMMIT=${COMMIT}
ENV BRANCH=${BRANCH}
ENV NOW=${NOW}

# added by docker/metadata-action using data from GitHub
# LABEL org.opencontainers.image.title="free-games-claimer" \
#       org.opencontainers.image.url="https://github.com/vogler/free-games-claimer" \
#       org.opencontainers.image.source="https://github.com/vogler/free-games-claimer"

# Configure VNC via environment variables:
ENV VNC_PORT=5900
ENV NOVNC_PORT=6080
EXPOSE 5900
EXPOSE 6080

# Configure Xvfb via environment variables:
ENV WIDTH=1920
ENV HEIGHT=1080
ENV DEPTH=24

# Show browser instead of running headless
ENV SHOW=1

# mega-linter (KICS, Trivy) complained about it missing - usually this checks some API endpoint, for a container that runs ~1min a healthcheck doesn't make that much sense since playwright has timeouts for everything. Could react to SIGUSR1 and check something in JS - for now we just check that node is running and noVNC is reachable...
HEALTHCHECK --interval=5s --timeout=5s CMD pgrep node && curl --fail http://localhost:6080 || exit 1

# Script to setup display server & VNC is always executed.
ENTRYPOINT ["docker-entrypoint.sh"]
# Default command to run. This is replaced by appending own command, e.g. `docker run ... node prime-gaming` to only run this script.
CMD node epic-games; node prime-gaming; node gog
