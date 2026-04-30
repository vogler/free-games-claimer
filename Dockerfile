# FROM mcr.microsoft.com/playwright:v1.20.0
# Partially from https://github.com/microsoft/playwright/blob/main/utils/docker/Dockerfile.focal
FROM ubuntu:jammy
# Using patchright (patched Chromium) instead of playwright-firefox for better bot detection bypass

# Configuration variables are at the end!

# https://github.com/hadolint/hadolint/wiki/DL4006
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ARG DEBIAN_FRONTEND=noninteractive

# Install up-to-date node & npm, deps for virtual screen & noVNC, firefox, pip for apprise.
RUN apt-get update \
    && apt-get install --no-install-recommends -y curl ca-certificates gnupg \
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
      bc \
      python3-pip \
    # Chromium (patchright) system dependencies:
    && apt-get install --no-install-recommends -y \
      libgtk-3-0 \
      libasound2 \
      libxcomposite1 \
      libpangocairo-1.0-0 \
      libpango-1.0-0 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcairo-gobject2 \
      libcairo2 \
      libgdk-pixbuf-2.0-0 \
      libdbus-1-3 \
      libxcursor1 \
      libxdamage1 \
      libxrandr2 \
      libgbm1 \
      libxss1 \
      libnss3 \
      libnspr4 \
      libcups2 \
      libxkbcommon0 \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf \
      /tmp/* \
      /usr/share/doc/* \
      /var/cache/* \
      /var/lib/apt/lists/* \
      /var/tmp/*

# RUN node --version
# RUN npm --version

RUN ln -s /usr/share/novnc/vnc_auto.html /usr/share/novnc/index.html
RUN pip install apprise

WORKDIR /fgc
COPY package*.json ./

# Playwright installs patched firefox to ~/.cache/ms-playwright/firefox-*
# Requires some system deps to run (see inlined install-deps above).
RUN npm install
# Install patchright's patched Chromium browser binary
RUN npx patchright install chromium

COPY . .

# Shell scripts need Linux line endings. On Windows, git might be configured to check out dos/CRLF line endings, so we convert them for those people in case they want to build the image. They could also use --config core.autocrlf=input
RUN dos2unix ./*.sh && chmod +x ./*.sh
COPY docker-entrypoint.sh /usr/local/bin/
# Make scheduler available as absolute path (used in docker-compose command)
RUN chmod +x /fgc/run-scheduled.sh

ARG COMMIT=""
ARG BRANCH=""
ARG NOW=""
ENV COMMIT=${COMMIT}
ENV BRANCH=${BRANCH}
ENV NOW=${NOW}

LABEL org.opencontainers.image.title="free-games-claimer" \
      org.opencontainers.image.name="free-games-claimer" \
      org.opencontainers.image.description="Automatically claims free games on the Epic Games Store, Amazon Prime Gaming and GOG" \
      org.opencontainers.image.url="https://github.com/vogler/free-games-claimer" \
      org.opencontainers.image.source="https://github.com/vogler/free-games-claimer" \
      org.opencontainers.image.revision=${COMMIT} \
      org.opencontainers.image.ref.name=${BRANCH} \
      org.opencontainers.image.base.name="ubuntu:jammy" \
      org.opencontainers.image.version="latest"

# Configure VNC via environment variables:
ENV VNC_PORT 5900
ENV NOVNC_PORT 6080
EXPOSE 5900
EXPOSE 6080

# Configure Xvfb via environment variables:
ENV WIDTH 1920
ENV HEIGHT 1080
ENV DEPTH 24

# Show browser instead of running headless
ENV SHOW 1

# HEALTHCHECK: passes if lastrun.json was updated within the last 25 hours (1500 min).
# Fails if the scheduler is stuck or hasn't run since container start.
HEALTHCHECK --interval=30m --timeout=10s --start-period=120s --retries=3 \
  CMD find /fgc/data/lastrun.json -mmin -1500 > /dev/null 2>&1 || exit 1

# Script to setup display server & VNC is always executed.
ENTRYPOINT ["docker-entrypoint.sh"]
# Default command to run. This is replaced by appending own command, e.g. `docker run ... node prime-gaming` to only run this script.
CMD node epic-games; node prime-gaming; node gog; node steam-games
# For scheduled daily runs, override CMD with: /fgc/run-scheduled.sh
