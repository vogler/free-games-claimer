# FROM mcr.microsoft.com/playwright:v1.20.0
# Partially from https://github.com/microsoft/playwright/blob/main/utils/docker/Dockerfile.focal
FROM ubuntu:jammy

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
      python3-pip \
    # && npx playwright install-deps firefox \
    && apt-get install --no-install-recommends -y \
      libgtk-3-0 \
      libasound2 \
      libxcomposite1 \
      libpangocairo-1.0-0 \
      libpango-1.0-0 \
      libatk1.0-0 \
      libcairo-gobject2 \
      libcairo2 \
      libgdk-pixbuf-2.0-0 \
      libdbus-glib-1-2 \
      libxcursor1 \
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
RUN pip install --no-cache-dir apprise

WORKDIR /fgc
# add user fgc to not run the application as root in the end
ARG USER=fgc
RUN useradd -ms /bin/bash fgc
# adjust permissions, otherwise can only read /fgc/data, but not write
# normally this would be mounted, but since this only happens later we need to create /fgc/data first
# also need to chown ., otherwise we can't create node_modules inside as fgc
RUN mkdir data && chown -R fgc:fgc .
USER fgc
COPY --chown=fgc:fgc package*.json ./

# Playwright installs patched firefox to ~/.cache/ms-playwright/firefox-*
# Requires some system deps to run (see inlined install-deps above).
RUN npm install
# Old: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD + install firefox (had to be done after `npm install` to get the correct version). Now: playwright-firefox as npm dep and `npm install` will only install that.
# From 1.38 Playwright will no longer install browser automatically for playwright, but apparently still for playwright-firefox: https://github.com/microsoft/playwright/releases/tag/v1.38.0
# RUN npx playwright install firefox

COPY --chown=fgc:fgc . .

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
