#!/bin/sh

# 6000+SERVERNUM is the TCP port Xvfb is listening on:
# SERVERNUM=$(echo "$DISPLAY" | sed 's/:\([0-9][0-9]*\).*/\1/')

# Options passed directly to the Xvfb server:
# -ac disables host-based access control mechanisms
# −screen NUM WxHxD creates the screen and sets its width, height, and depth
Xvfb "$DISPLAY" -ac -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}" >/dev/null 2>&1 &

if [ "$VNC_ENABLED" = true ]; then
    echo "Starting VNC server..."
    # wait for Xvfb to start up
    sleep 3
    vnc-start >/dev/null 2>&1 &
fi

exec tini -g -- "$@"
