FROM node:18-alpine as builder

# Install ffmpeg
RUN apk add --no-cache ffmpeg

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Create production image
FROM node:18-alpine

# Install ffmpeg (required for file conversion)
RUN apk add --no-cache ffmpeg

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --production

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Add execution permissions
RUN chmod +x ./dist/index.js

# Default command
CMD ["node", "dist/index.js"]