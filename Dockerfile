# FROM mcr.microsoft.com/playwright:v1.20.0
FROM ubuntu:focal

ARG DEBIAN_FRONTEND=noninteractive

# Configure Xvfb via environment variables:
ENV SCREEN_WIDTH 1440
ENV SCREEN_HEIGHT 900
ENV SCREEN_DEPTH 24
ENV DISPLAY :60

# Configure VNC via environment variables:
ENV VNC_ENABLED true
ENV VNC_PASSWORD secret
ENV VNC_PORT 5900
ENV NOVNC_PORT 6080
EXPOSE 5900
EXPOSE 6080

# Playwright
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD true

# === INSTALL Node.js ===

# Taken from https://github.com/microsoft/playwright/blob/main/utils/docker/Dockerfile.focal
RUN apt-get update && \
    # Install node16
    apt-get install -y curl wget && \
    curl -sL https://deb.nodesource.com/setup_16.x | bash - && \
    apt-get install -y nodejs && \
    # Feature-parity with node.js base images.
    apt-get install -y --no-install-recommends git openssh-client && \
    npm install -g yarn && \
    # clean apt cache
    rm -rf /var/lib/apt/lists/* && \
    # Create the pwuser
    adduser pwuser


#  === Install the base requirements to run and debug webdriver implementations ===
RUN apt-get update \
    && apt-get install --no-install-recommends --no-install-suggests -y \
    xvfb \
    ca-certificates \
    x11vnc \
    curl \
    tini \
    novnc websockify \
    dos2unix \
    && apt-get clean \
    && rm -rf \
    /tmp/* \
    /usr/share/doc/* \
    /var/cache/* \
    /var/lib/apt/lists/* \
    /var/tmp/*


WORKDIR /fgc
COPY package.json .
# Install chromium & dependencies only
RUN npm install \
    && npx playwright install --with-deps chromium \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY . .

# Shell scripts
RUN dos2unix ./docker/*.sh
RUN mv ./docker/entrypoint.sh /usr/local/bin/entrypoint \
    && chmod +x /usr/local/bin/entrypoint \
    && mv ./docker/vnc-start.sh /usr/local/bin/vnc-start \
    && chmod +x /usr/local/bin/vnc-start


ENTRYPOINT ["entrypoint"]
CMD ["node", "epic-games.js"]
