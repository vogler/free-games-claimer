#!/bin/sh

# Start VNC in a background process:
x11vnc -display "$DISPLAY" -forever -shared -rfbport "${VNC_PORT:-5900}" \
    -passwd "${VNC_PASSWORD:-secret}" &

# Execute the given command:
exec "$@"
