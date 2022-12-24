# FROM mcr.microsoft.com/playwright:v1.20.0
# Partially from https://github.com/microsoft/playwright/blob/main/utils/docker/Dockerfile.focal
FROM ubuntu:jammy

# Configuration variables are at the end!

# https://github.com/hadolint/hadolint/wiki/DL4006
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ARG DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD true

# Install up-to-date node & npm, deps for virtual screen & noVNC, browser.
# Playwright needs --with-deps for firefox.
RUN apt-get update \
    && apt-get install -y curl \
    && curl -fsSL https://deb.nodesource.com/setup_19.x | bash - \
    && apt-get install -y nodejs \
    && apt-get install --no-install-recommends --no-install-suggests -y \
      xvfb \
      ca-certificates \
      x11vnc \
      tini \
      novnc websockify \
      dos2unix \
    && npx playwright install --with-deps firefox \
    && apt-get clean \
    && rm -rf \
      /tmp/* \
      /usr/share/doc/* \
      /var/cache/* \
      /var/lib/apt/lists/* \
      /var/tmp/*

RUN ln -s /usr/share/novnc/vnc_auto.html /usr/share/novnc/index.html

WORKDIR /fgc
COPY package*.json ./

RUN npm install

COPY . .

# Shell scripts need Linux line endings. On Windows, git might be configured to check out dos/CRLF line endings, so we convert them for those people in case they want to build the image.
RUN dos2unix ./docker/*.sh
RUN mv ./docker/entrypoint.sh /usr/local/bin/entrypoint \
    && chmod +x /usr/local/bin/entrypoint

# Configure VNC via environment variables:
ENV VNC_PORT 5900
ENV NOVNC_PORT 6080
EXPOSE 5900
EXPOSE 6080

# Configure Xvfb via environment variables:
ENV SCREEN_WIDTH 1280
ENV SCREEN_HEIGHT 1280
ENV SCREEN_DEPTH 24

ENTRYPOINT ["entrypoint"]
CMD ["node", "epic-games.js"]
