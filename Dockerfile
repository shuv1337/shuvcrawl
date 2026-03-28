# Production Dockerfile for shuvcrawl
# Based on the patchright-bpc spike findings

FROM oven/bun:1.2 AS base

# Install Chromium system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
  chromium \
  ca-certificates \
  curl \
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
  # Xvfb needed if MV3 extensions require headed mode
  xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Install Patchright Chromium
RUN bunx patchright install chromium

# Copy application source
COPY . .

# Copy BPC extension into the image
COPY bpc-chrome/ ./bpc-chrome/

# Create output directory
RUN mkdir -p /app/output /root/.shuvcrawl

# Environment configuration
ENV NODE_ENV=production
ENV SHUVCRAWL_BROWSER_EXECUTABLE=/usr/bin/chromium
ENV SHUVCRAWL_BROWSER_HEADLESS=true

# Expose API port
EXPOSE 3777

# Default command runs the API server
# Use xvfb-run if MV3 extensions require headed mode, otherwise direct bun
CMD ["bun", "run", "src/server.ts"]
