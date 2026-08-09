FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Cloud Run injects PORT (usually 8080); config.js already reads process.env.PORT.
ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/index.js"]
