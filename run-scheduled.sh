#!/usr/bin/env bash

# Daily scheduler for free-games-claimer.
# Runs the claim scripts immediately on start, then every day at SCHEDULE_HOUR (default: 7).
# Set SCHEDULE_HOUR=7 (env) to change the daily run time.
# Set SCRIPTS env to override which scripts run, e.g. SCRIPTS="node epic-games; node gog"

set -eo pipefail

SCHEDULE_HOUR="${SCHEDULE_HOUR:-7}"
SCRIPTS="${SCRIPTS:-node epic-games; node prime-gaming; node gog}"

echo "Scheduler started. Will run daily at ${SCHEDULE_HOUR}:00."
echo "Scripts: ${SCRIPTS}"

while true; do
  echo ""
  echo "=== Run started at $(date) ==="
  eval "$SCRIPTS" || true  # || true so one failure doesn't stop the others
  # Update healthcheck sentinel
  mkdir -p /fgc/data 2>/dev/null || true
  date -Iseconds > /fgc/data/lastrun.json 2>/dev/null || true
  echo "=== Run finished at $(date) ==="

  # Calculate seconds until next SCHEDULE_HOUR:00
  now=$(date +%s)
  next=$(date -d "today ${SCHEDULE_HOUR}:00" +%s 2>/dev/null || date -v "${SCHEDULE_HOUR}H" -v 0M -v 0S +%s)
  if [ "$next" -le "$now" ]; then
    next=$(date -d "tomorrow ${SCHEDULE_HOUR}:00" +%s 2>/dev/null || date -v +1d -v "${SCHEDULE_HOUR}H" -v 0M -v 0S +%s)
  fi
  sleep_sec=$((next - now))
  sleep_hr=$(echo "scale=1; $sleep_sec/3600" | bc)
  echo "Next run in ${sleep_hr}h (at $(date -d "@${next}" 2>/dev/null || date -r "${next}") )"
  sleep "$sleep_sec"
done
