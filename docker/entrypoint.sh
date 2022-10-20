#!/bin/sh

# Remove chromium profile lock.
# When running in docker and then killing it, on the next run chromium displayed a dialog to unlock the profile which made the script time out.
# Maybe due to changed hostname of container or due to how the docker container kills playwright - didn't check.
# https://bugs.chromium.org/p/chromium/issues/detail?id=367048
rm -f /fgc/data/browser/SingletonLock

# Remove X server display lock, fix for `docker compose up` which reuses container which made it fail after initial run, https://github.com/vogler/free-games-claimer/issues/31
# echo $DISPLAY
# ls -l /tmp/.X11-unix/
rm -f /tmp/.X1-lock

# 6000+SERVERNUM is the TCP port Xvfb is listening on:
# SERVERNUM=$(echo "$DISPLAY" | sed 's/:\([0-9][0-9]*\).*/\1/')

# Options passed directly to the Xvfb server:
# -ac disables host-based access control mechanisms
# −screen NUM WxHxD creates the screen and sets its width, height, and depth

Xvfb :1 -ac -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}" >/dev/null 2>&1 &
x11vnc -display :1.0 -forever -shared -rfbport "${VNC_PORT:-5900}" -passwd "${VNC_PASSWORD:-secret}" -bg
websockify -D --web "$NOVNC_HOME" "$NOVNC_PORT" "localhost:$VNC_PORT" &
DISPLAY=:1.0
export DISPLAY
exec tini -g -- "$@"
