#!/bin/sh

# Remove chromium profile lock.
# When running in docker and then killing it, on the next run chromium displayed a dialog to unlock the profile which made the script time out.
# Maybe due to changed hostname of container or due to how the docker container kills playwright - didn't check.
# https://bugs.chromium.org/p/chromium/issues/detail?id=367048
rm -f /fgc/data/browser/SingletonLock

# 6000+SERVERNUM is the TCP port Xvfb is listening on:
# SERVERNUM=$(echo "$DISPLAY" | sed 's/:\([0-9][0-9]*\).*/\1/')

# Options passed directly to the Xvfb server:
# -ac disables host-based access control mechanisms
# −screen NUM WxHxD creates the screen and sets its width, height, and depth
Xvfb "$DISPLAY" -ac -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}" >/dev/null 2>&1 &

if [ "$VNC_ENABLED" = true ]; then
    vnc-start >/dev/null 2>&1 &
fi

exec tini -g -- "$@"
