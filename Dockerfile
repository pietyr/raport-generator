FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-impress \
    fonts-liberation \
    fonts-dejavu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

RUN npm install

COPY frontend ./frontend
COPY backend ./backend

RUN npm run build -w frontend && npm run build -w backend

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["node", "backend/dist/index.js"]
