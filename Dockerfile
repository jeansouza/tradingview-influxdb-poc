FROM node:22-alpine

# Create app directory
WORKDIR /app

# Install curl for healthchecks
RUN apk --no-cache add curl

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Bundle app source
COPY . .

# Create directories if they don't exist
RUN mkdir -p public/charting_library public/datafeeds

# Note: The TradingView Charting Library is not included
# It requires a license from TradingView and must be added separately
# The docker-compose.yml file mounts the public directory as a volume,
# so you can add the library files to your local public directory

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["node", "src/server.js"]

# For high-memory mode, use:
# CMD ["node", "--max-old-space-size=8192", "start-server.js"]
