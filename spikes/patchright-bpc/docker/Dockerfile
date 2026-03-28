FROM oven/bun:1 AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
  chromium \
  xvfb \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnss3 \
  libnspr4 \
  libpango-1.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxrandr2 \
  libxrender1 \
  libxshmfence1 \
  libxss1 \
  libxtst6 \
  xdg-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app
WORKDIR /app/spikes/patchright-bpc
RUN bun install

ENV SPIKE_BROWSER_EXECUTABLE=/usr/bin/chromium
ENV SPIKE_SCENARIO=docker-headless
ENV SPIKE_HEADLESS=1

CMD ["bash", "-lc", "if [ \"${SPIKE_HEADLESS}\" = \"0\" ]; then Xvfb :99 -screen 0 1440x960x24 & export DISPLAY=:99; fi; bun run spike:patchright-bpc --scenario ${SPIKE_SCENARIO}"]
