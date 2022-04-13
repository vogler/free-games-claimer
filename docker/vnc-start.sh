#!/bin/sh
set -e
# Start VNC in a background process:
x11vnc -display "$DISPLAY" -forever -shared -rfbport "${VNC_PORT:-5900}" \
    -passwd "${VNC_PASSWORD:-secret}" -bg
NOVNC_HOME=/usr/share/novnc
# ln -s $NOVNC_HOME/vnc_auto.html $NOVNC_HOME/index.html
websockify -D --web "$NOVNC_HOME" "$NOVNC_PORT" "localhost:$VNC_PORT" &

# Execute the given command:
exec "$@"
