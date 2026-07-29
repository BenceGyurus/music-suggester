# Stage 1: Build the frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the backend and serve the app
FROM node:18-alpine
WORKDIR /app/backend

# We need sqlite3 which sometimes needs build tools on alpine, 
# but prebuilt binaries usually work for node 18 alpine.
# Just in case, add basic build tools, then remove them after install.
RUN apk add --no-cache python3 make g++ 

COPY backend/package*.json ./
RUN npm install --production

# Remove build tools to save space
RUN apk del python3 make g++

COPY backend/ ./
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Expose port and start
EXPOSE 3001
ENV PORT=3001
CMD ["npm", "start"]
