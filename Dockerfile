# Use Node.js LTS as the base image
FROM node:20-slim AS builder

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the package
RUN npm run build

# Install package globally
RUN npm link

# Minimal image for runtime
FROM node:20-slim

# Copy built package from builder stage
COPY scripts/notion-openapi.json /usr/local/scripts/
COPY --from=builder /usr/local/lib/node_modules/@notionhq/notion-mcp-server /usr/local/lib/node_modules/@notionhq/notion-mcp-server
COPY --from=builder /usr/local/bin/notion-mcp-server /usr/local/bin/notion-mcp-server

# Set default environment variables
ENV OPENAPI_MCP_HEADERS="{}"

# Set entrypoint
ENTRYPOINT ["notion-mcp-server"] 