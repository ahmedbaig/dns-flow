FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.html ./
COPY server ./server
COPY src ./src
COPY data ./data
ENV PORT=8787 DATA_DIR=/data NODE_ENV=production
USER node
EXPOSE 8787
CMD ["node", "server/index.mjs"]
