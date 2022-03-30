#!/bin/sh

# Disable fbsetbg and start fluxbox in a background process:
mkdir -p ~/.fluxbox && echo 'background: unset' >>~/.fluxbox/overlay
fluxbox -display "$DISPLAY" &

# Start VNC in a background process:
x11vnc -display "$DISPLAY" -forever -shared -rfbport "${VNC_PORT:-5900}" \
    -passwd "${VNC_PASSWORD:-secret}" &

# Execute the given command:
exec "$@"
