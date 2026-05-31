FROM node:18-alpine
WORKDIR /app
COPY api/package.json ./
RUN npm install
COPY api/ ./
CMD ["node", "server.js"]