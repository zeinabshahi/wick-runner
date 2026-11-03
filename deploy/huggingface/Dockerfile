# Free hosting on a Hugging Face Space (Docker). The Space holds only this file; the build pulls the game from GitHub.
# Space secrets/variables: VERIFIER_KEY (secret), PUBLIC_ORIGIN = https://<user>-<space>.hf.space
# To ship a new version: Space -> Settings -> Factory rebuild.
FROM mcr.microsoft.com/playwright:v1.58.2-noble
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
ARG REPO=https://github.com/zeinabshahi/wick-runner
RUN git clone --depth 1 $REPO /app && chown -R 1000:1000 /app
WORKDIR /app
RUN npm ci --omit=dev --no-audit --no-fund
# Spaces run as uid 1000 and forget files on restart; that's fine: records and the leaderboard live on-chain.
ENV HOST=0.0.0.0 PORT=7860 DATA_DIR=/tmp/wick
USER 1000
EXPOSE 7860
CMD ["node", "server.mjs"]
