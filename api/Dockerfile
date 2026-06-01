FROM node:18-alpine
WORKDIR /app
COPY api/package.json ./
RUN npm install
COPY api/ ./
EXPOSE 3000
CMD ["node", "-e", "console.log('test'); require('./server')"]