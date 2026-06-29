FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY server.js ./
COPY public ./public
COPY .env* ./

EXPOSE 3000

CMD ["node", "server.js"]
