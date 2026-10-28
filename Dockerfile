# Contextual Ad Studio — container for Render (or any Docker host)
# Playwright image = Node + Chromium with all system deps, version-matched to package.json
FROM mcr.microsoft.com/playwright:v1.64.0-noble
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip fonts-noto-core fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*
# Python helpers: cut-outs and logo keying (numpy, OpenCV, Pillow) and clean article text (Trafilatura), pinned to the
# versions the app is tested with
RUN pip3 install --no-cache-dir --break-system-packages numpy==2.5.4 opencv-python-headless==5.0.0.93 pillow==12.3.0 trafilatura==2.3.1
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
ENV NODE_ENV=production OUT_DIR=/app/output CAPTURE_PARALLEL=2
EXPOSE 10000
CMD ["node", "server.mjs"]
