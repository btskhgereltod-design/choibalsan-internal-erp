FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY migrations ./migrations
COPY scripts ./scripts
COPY src ./src

RUN addgroup -S erp && adduser -S erp -G erp \
    && mkdir -p /app/uploads \
    && chown -R erp:erp /app

USER erp
EXPOSE 4100
CMD ["node", "scripts/start.js"]

