# HyperFrames for StartOS.
#
# Follows upstream's own render image (packages/cli/src/docker/Dockerfile.render
# in heygen-com/hyperframes): Debian bookworm, one pinned static FFmpeg, the Chromium shared
# libraries and fonts, a pinned chrome-headless-shell for deterministic
# BeginFrame capture, and the published `hyperframes` npm package. On top of
# that it adds the agent API + MCP server from ./server and the skills library.
#
# HYPERFRAMES_VERSION must match `version` in startos/versions/current.ts and
# the `hyperframes` submodule tag. See UPDATING.md.
FROM node:22.23.3-bookworm-slim AS base

ARG HYPERFRAMES_VERSION=0.8.162
# Set by `docker buildx build --platform`; picks the headless-shell source.
ARG TARGETARCH=amd64
# chrome-for-testing publishes no linux-arm64 build; Playwright ships a pinned
# arm64 headless shell (Google's build). Same pins as upstream.
ARG PLAYWRIGHT_VERSION=1.61.1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip xz-utils chromium \
    libgbm1 libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 \
    libxdamage1 libxrandr2 libcups2 libasound2 libpangocairo-1.0-0 \
    libxshmfence1 libgtk-3-0 \
    fonts-liberation fonts-noto-color-emoji fonts-noto-cjk fonts-noto-core \
    fonts-noto-extra fonts-noto-ui-core fonts-freefont-ttf fonts-dejavu-core \
    fontconfig tini \
    && rm -rf /var/lib/apt/lists/* && apt-get clean && fc-cache -fv

# One pinned static FFmpeg build (BtbN n8.0.1, per arch) instead of Debian's apt
# ffmpeg, the same pin as upstream's Dockerfile.render, so renders here match
# upstream's regression baselines. Bump the URLs and sha256s together.
ARG FFMPEG_RELEASE=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-02-28-12-59
ARG FFMPEG_BUILD=ffmpeg-n8.0.1-66-g27b8d1a017
ARG FFMPEG_SHA256_AMD64=26d2ecd0cefba99f9d1ea92252a3a4f743a58df4c1c3cf9f8bbaaa40b1fca5b0
ARG FFMPEG_SHA256_ARM64=d72cc324cb65dd92a9ffe699cc95ccbacfef4def8d3ad9fe2b5164a6a71b9595
RUN case "$TARGETARCH" in \
      amd64) FF_ARCH=linux64; FF_SHA256="$FFMPEG_SHA256_AMD64" ;; \
      arm64) FF_ARCH=linuxarm64; FF_SHA256="$FFMPEG_SHA256_ARM64" ;; \
      *) echo "unsupported TARGETARCH '$TARGETARCH'" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/ffmpeg.tar.xz "$FFMPEG_RELEASE/$FFMPEG_BUILD-$FF_ARCH-gpl-8.0.tar.xz" \
    && echo "$FF_SHA256  /tmp/ffmpeg.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /usr/local/bin --strip-components=2 --wildcards '*/bin/ffmpeg' '*/bin/ffprobe' \
    && rm /tmp/ffmpeg.tar.xz \
    && ffmpeg -version | grep -F "ffmpeg version ${FFMPEG_BUILD#ffmpeg-}" \
    && ffprobe -version | grep -F "ffprobe version ${FFMPEG_BUILD#ffmpeg-}"

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CONTAINER=true
ENV HYPERFRAMES_VERSION=${HYPERFRAMES_VERSION}

# chrome-headless-shell unlocks BeginFrame capture (deterministic, faster).
RUN if [ "$TARGETARCH" = "amd64" ]; then \
      npx --yes @puppeteer/browsers install chrome-headless-shell@stable \
        --path /opt/chrome-cache; \
    else \
      PLAYWRIGHT_BROWSERS_PATH=/opt/chrome-cache \
        npx --yes playwright-core@${PLAYWRIGHT_VERSION} install chromium-headless-shell; \
    fi \
    && SHELL_PATH=$(find /opt/chrome-cache \
         \( -name "chrome-headless-shell" -o -name "headless_shell" \) -type f 2>/dev/null | head -1) \
    && if [ -z "$SHELL_PATH" ]; then \
         echo "ERROR: chrome-headless-shell not found for ${TARGETARCH}" >&2; exit 1; \
       fi \
    && mkdir -p /opt/chrome && ln -s "$SHELL_PATH" /opt/chrome/chrome-headless-shell \
    && chmod -R a+rX /opt/chrome-cache \
    && /opt/chrome/chrome-headless-shell --version

ENV PRODUCER_HEADLESS_SHELL_PATH=/opt/chrome/chrome-headless-shell
ENV HYPERFRAMES_CHROME_PATH=/opt/chrome/chrome-headless-shell

RUN npm install -g hyperframes@${HYPERFRAMES_VERSION} && npm cache clean --force \
    && hyperframes --version

# ── Agent API and MCP server ────────────────────────────────────────────────
FROM base AS server-build
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

# ── Runtime image ───────────────────────────────────────────────────────────
FROM base
COPY --from=server-build /build/server/dist /opt/hyperframes-startos/server/dist
COPY --from=server-build /build/server/node_modules /opt/hyperframes-startos/server/node_modules
COPY --from=server-build /build/server/package.json /opt/hyperframes-startos/server/package.json

# Four skill roots, each skill packaged once. Community sources stay pinned;
# the two history-film SKILL.md files receive documented deployment overlays.
# Scripts/assets remain unchanged and execute on the agent host, not here.
# Served by the API (/skills) and as MCP resources.
COPY hyperframes/skills /opt/hyperframes/skills
COPY skills /opt/hyperframes-startos/skills
COPY hyperframes/LICENSE /opt/hyperframes/LICENSE
COPY heygen-skills/skills /opt/heygen-skills/skills
COPY heygen-skills/LICENSE /opt/heygen-skills/LICENSE
COPY community-skills/skills /opt/hyperframes-community/skills
COPY community-adaptations/day-in-my-life.SKILL.md /opt/hyperframes-community/skills/day-in-my-life/SKILL.md
COPY community-adaptations/session-story.SKILL.md /opt/hyperframes-community/skills/session-story/SKILL.md
COPY community-skills/LICENSE /opt/hyperframes-community/LICENSE

# Studio on a phone: upstream's dock needs 600 px, so phones get a bar and a
# compact layout from assets/studio-mobile.*. patch-studio.mjs links them from
# the built Studio and fails the build if the controls it drives are gone.
COPY assets/patch-studio.mjs assets/studio-mobile.css assets/studio-mobile.js /opt/hyperframes-startos/studio-mobile/
RUN node /opt/hyperframes-startos/studio-mobile/patch-studio.mjs \
      "$(npm root -g)/hyperframes/dist/studio" /opt/hyperframes-startos/studio-mobile

COPY assets/hf-studio assets/hf-server /usr/local/bin/
RUN chmod +x /usr/local/bin/hf-studio /usr/local/bin/hf-server

ENV HF_SKILLS_DIRS=/opt/hyperframes/skills:/opt/hyperframes-startos/skills:/opt/hyperframes-community/skills:/opt/heygen-skills/skills
ENV HF_SERVER_VERSION=0.2.1
ENV HOME=/data/home
ENV HYPERFRAMES_PROJECTS_DIR=/data/projects
ENV HF_STATE_DIR=/data/startos
ENV HF_STUDIO_FILE=/data/startos/studio.json
ENV HYPERFRAMES_NO_TELEMETRY=1
ENV HYPERFRAMES_NO_UPDATE_CHECK=1

WORKDIR /data
EXPOSE 3002 3100
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["hf-server"]
