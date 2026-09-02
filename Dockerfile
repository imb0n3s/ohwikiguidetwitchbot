FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY *.js ./
ENV NODE_ENV=production DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "index.js"]
