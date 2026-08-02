FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json* ./
RUN npm install

# Copy prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source
COPY . .

EXPOSE 4000

# On startup: migrate → seed → dev server (see package.json start:docker)
CMD ["npm", "run", "start:docker"]
