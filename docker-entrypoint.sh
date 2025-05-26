#!/usr/bin/env bash

set -eo pipefail # exit on error, error on any fail in pipe (not just last cmd); add -x to print each cmd; see gist bash_strict_mode.md

echo "Version: https://github.com/vogler/free-games-claimer/tree/${COMMIT}"
[ -n "$BRANCH" ] && [ "$BRANCH" != "main" ] && echo "Branch: ${BRANCH}"
echo "Build: $NOW"

BROWSER="${BROWSER_DIR:-data/browser}"

# Remove chromium profile lock.
# When running in docker and then killing it, on the next run chromium displayed a dialog to unlock the profile which made the script time out.
# Maybe due to changed hostname of container or due to how the docker container kills playwright - didn't check.
# https://bugs.chromium.org/p/chromium/issues/detail?id=367048
rm -f "/fgc/$BROWSER/SingletonLock"

# Remove X server display lock, fix for `docker compose up` which reuses container which made it fail after initial run, https://github.com/vogler/free-games-claimer/issues/31
# Maybe no longer needed after adding #478's -nolisten unix below
rm -f /tmp/.X1-lock

# 6000+SERVERNUM is the TCP port Xvfb is listening on:
# SERVERNUM=$(echo "$DISPLAY" | sed 's/:\([0-9][0-9]*\).*/\1/')

# Options passed directly to the Xvfb server:
# -ac disables host-based access control mechanisms
# −screen NUM WxHxD creates the screen and sets its width, height, and depth
# -nolisten unix tells the server not to use Unix domain sockets, thus avoiding the need to create /tmp/.X11-unix

export DISPLAY=:1 # need to export this, otherwise playwright complains with 'Looks like you launched a headed browser without having a XServer running.'
Xvfb $DISPLAY -ac -screen 0 "${WIDTH}x${HEIGHT}x${DEPTH}" &
echo "Xvfb display server created screen with resolution ${WIDTH}x${HEIGHT} -nolisten unix"
if [ -z "$VNC_PASSWORD" ]; then
	pw="-nopw"
	pwt="no password!"
else
	pw="-passwd $VNC_PASSWORD"
	pwt="with password"
fi
x11vnc -display $DISPLAY -forever -shared -rfbport "$VNC_PORT" -bg "$pw" 2>/dev/null 1>&2
echo "VNC is running on port $VNC_PORT ($pwt)"
websockify -D --web "/usr/share/novnc/" "$NOVNC_PORT" "localhost:$VNC_PORT" 2>/dev/null 1>&2 &
echo "noVNC (VNC via browser) is running on http://localhost:$NOVNC_PORT"
echo
exec tini -g -- "$@" # https://github.com/krallin/tini/issues/8 node/playwright respond to signals like ctrl-c, but unsure about zombie processes
