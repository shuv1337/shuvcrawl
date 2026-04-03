#!/bin/sh
# Start Xvfb on display :99 for headed Chromium with MV3 extensions
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &
sleep 1
export DISPLAY=:99
exec bun run src/server.ts
