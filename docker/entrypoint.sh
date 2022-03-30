#!/bin/sh

if [ "$VNC_ENABLED" = true ]; then
    set -- vnc-start "$@"
fi

if [ "$EXPOSE_X11" = true ]; then
    set -- --listen-tcp "$@"
fi

# 6000+SERVERNUM is the TCP port Xvfb is listening on:
SERVERNUM=$(echo "$DISPLAY" | sed 's/:\([0-9][0-9]*\).*/\1/')

# Options passed directly to the Xvfb server:
# -ac disables host-based access control mechanisms
# −screen NUM WxHxD creates the screen and sets its width, height, and depth
SERVERARGS="-ac -screen 0 ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}"

exec tini -g -- \
    xvfb-run --server-num "$SERVERNUM" --server-args "$SERVERARGS" "$@"
