FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY index.html game.mjs game-core.mjs server.mjs ./
ENV HOST=0.0.0.0 PORT=8123 DATA_DIR=/app/data
EXPOSE 8123
CMD ["node", "server.mjs"]
