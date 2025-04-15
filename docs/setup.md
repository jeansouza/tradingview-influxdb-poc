# Setup Guide

This document provides detailed instructions for setting up the TradingView InfluxDB POC. It covers installation, configuration, and troubleshooting common issues.

## Prerequisites

Before you begin, ensure you have the following installed:

1. **Node.js (v22.14.0 or higher)**
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify installation with `node --version`

2. **InfluxDB (v2.0 or higher)**
   - See installation options below
   - Required for storing time-series data

3. **TradingView Charting Library**
   - Requires a license from TradingView
   - Not included in this repository due to licensing restrictions

## Installing InfluxDB

Choose one of the following methods to install InfluxDB:

### Option 1: Using Homebrew (macOS)

```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install InfluxDB
brew update
brew install influxdb

# Start InfluxDB service
brew services start influxdb
```

### Option 2: Using Docker

```bash
# Pull the InfluxDB image
docker pull influxdb:latest

# Run InfluxDB container
docker run -d -p 8086:8086 \
  --name influxdb \
  -v influxdb-storage:/var/lib/influxdb2 \
  -v influxdb-config:/etc/influxdb2 \
  -e DOCKER_INFLUXDB_INIT_MODE=setup \
  -e DOCKER_INFLUXDB_INIT_USERNAME=admin \
  -e DOCKER_INFLUXDB_INIT_PASSWORD=password123 \
  -e DOCKER_INFLUXDB_INIT_ORG=my-org \
  -e DOCKER_INFLUXDB_INIT_BUCKET=trades \
  -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=my-super-secret-token \
  influxdb:latest
```

### Option 3: Direct Installation

1. Download the appropriate package for your platform from the [InfluxDB downloads page](https://portal.influxdata.com/downloads/).
2. Follow the installation instructions for your platform.

## Setting Up InfluxDB

After installing InfluxDB, you need to set it up:

### If Using Homebrew or Direct Installation

1. Open a terminal and run the setup command:

```bash
influx setup
```

2. Follow the prompts to:
   - Enter a username (e.g., `admin`)
   - Enter a password
   - Confirm the password
   - Enter an organization name (e.g., `my-org`)
   - Enter a bucket name (use `trades` for this project)
   - Confirm retention period (press Enter for infinite)

3. This will display your API tokens. Copy the token with read/write access.

### If Using Docker

If you used the Docker command above, InfluxDB is already set up with the provided environment variables. Your token is the value you set for `DOCKER_INFLUXDB_INIT_ADMIN_TOKEN`.

## Accessing InfluxDB UI

You can access the InfluxDB UI at http://localhost:8086

- Username: The username you created during setup
- Password: The password you created during setup

## Installing the Application

1. Clone the repository:

```bash
git clone https://github.com/jeansouza/tradingview-influxdb-poc.git
cd tradingview-influxdb-poc
```

2. Install dependencies:

```bash
npm install
```

3. Configure environment variables:

```bash
cp .env.example .env
```

4. Edit the `.env` file with your InfluxDB details:

```
PORT=3000
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=your_influxdb_token  # The token you copied earlier
INFLUXDB_ORG=my-org                 # The org name you provided during setup
INFLUXDB_BUCKET=trades              # The bucket name you created
```

## Setting Up TradingView Charting Library

The TradingView Charting Library requires a license from TradingView and is not included in this repository. Follow these steps to set it up:

1. Download the TradingView Charting Library from your TradingView account or contact TradingView for access.
2. Extract the downloaded zip file.
3. Run the setup script:

```bash
node setup-tradingview.js
```

4. Follow the prompts to provide the path to the extracted library files.

## Running the Application

### Standard Mode

Start the development server:

```bash
npm run dev
```

Or for production:

```bash
npm start
```

### High Memory Mode

For generating large datasets (millions of trades), use the high memory mode:

```bash
npm run dev:high-memory
```

Or for production:

```bash
npm run start:high-memory
```

This mode allocates 8GB of memory to Node.js, which helps prevent "JavaScript heap out of memory" errors when generating large amounts of data.

The application will be available at http://localhost:3000 in both modes.

## Generating Test Data

To generate fake trades for testing:

1. Start the application
2. Use the API endpoint:

```bash
curl "http://localhost:3000/api/trades/generate?symbol=BTCUSD&count=100000"
```

You can adjust the count parameter to generate more or fewer trades. For large datasets (millions of records), use the high-memory mode.

## Setting Up Downsampling Tasks

After generating test data, you need to set up the downsampling tasks:

```bash
node src/scripts/setupDownsamplingTasks.js
```

This script:
1. Creates the `task_status` bucket if it doesn't exist
2. Creates or updates the downsampling tasks for each resolution
3. Creates initial status points for each task

## Running Downsampling Tasks

You can manually trigger the downsampling tasks:

```bash
# Run a specific task
node src/scripts/runDownsamplingTask.js Downsample_Trades_1m

# Run all tasks
node src/scripts/runDownsamplingTask.js all
```

The tasks will process the raw trade data and generate OHLC candles for different resolutions.

## Verifying the Setup

You can verify that everything is set up correctly:

```bash
# Check if InfluxDB is running
node src/scripts/checkInfluxDBStatus.js

# Verify downsampling tasks
node src/scripts/verifyDownsamplingTasks.js

# Count trades in the database
node src/scripts/countTrades.js

# Check downsampled data
node src/scripts/checkDownsampledData.js
```

## Project Structure

```
tradingview-influxdb-poc/
├── docs/                  # Documentation
├── public/                # Frontend assets
│   ├── charting_library/  # TradingView Charting Library
│   ├── css/               # CSS files
│   ├── js/                # JavaScript files
│   └── index.html         # Main HTML file
├── src/                   # Backend source code
│   ├── config/            # Configuration files
│   ├── controllers/       # API controllers
│   ├── routes/            # API routes
│   ├── scripts/           # Utility scripts
│   └── server.js          # Main server file
├── .env.example           # Example environment variables
├── package.json           # Node.js dependencies
├── setup-tradingview.js   # Script to set up TradingView library
└── start-server.js        # Script to start server with high memory
```

## Common Issues and Troubleshooting

### InfluxDB Connection Issues

If you encounter connection issues with InfluxDB:

1. Verify that InfluxDB is running:
   ```bash
   # For Homebrew installation
   brew services list
   
   # For Docker installation
   docker ps
   ```

2. Check your `.env` file to ensure the InfluxDB URL, token, organization, and bucket are correct.

3. Try running the InfluxDB status check:
   ```bash
   node src/scripts/checkInfluxDBStatus.js
   ```

### TradingView Library Not Found

If you see a message that the TradingView Charting Library is not installed:

1. Make sure you have downloaded the library from your TradingView account.
2. Run the setup script again:
   ```bash
   node setup-tradingview.js
   ```
3. Verify that the `public/charting_library` directory exists and contains the library files.

### Out of Memory Errors

If you encounter "JavaScript heap out of memory" errors when generating large datasets:

1. Use the high-memory mode:
   ```bash
   npm run dev:high-memory
   ```

2. Reduce the batch size when generating data:
   ```bash
   curl "http://localhost:3000/api/trades/generate?symbol=BTCUSD&count=100000&batch=10000"
   ```

### Downsampling Tasks Not Running

If downsampling tasks are not running or not producing data:

1. Verify that the tasks exist:
   ```bash
   node src/scripts/verifyDownsamplingTasks.js
   ```

2. Check if any tasks are stuck in the "running" state. If so, force run them:
   ```bash
   node src/scripts/runDownsamplingTask.js Downsample_Trades_1m --force
   ```

3. Check the InfluxDB task logs in the InfluxDB UI.

### Query Timeouts

If you encounter query timeouts when retrieving OHLC data:

1. Try a smaller date range.
2. Use a larger resolution (e.g., 1h instead of 1m).
3. Check if downsampled data exists for the requested resolution:
   ```bash
   node src/scripts/checkDownsampledData.js
   ```

## Performance Tuning

### InfluxDB Configuration

For better performance with large datasets, consider adjusting the InfluxDB configuration:

1. Increase memory limits
2. Optimize storage settings
3. Adjust query concurrency

Refer to the [InfluxDB documentation](https://docs.influxdata.com/influxdb/v2.0/reference/config-options/) for detailed configuration options.

### Application Configuration

You can adjust the following parameters for better performance:

1. Batch size for data generation (default: 100,000)
2. Chunk size for downsampling tasks (configured in `src/scripts/setupDownsamplingTasks.js`)
3. Memory allocation for Node.js (configured in `package.json` scripts)

## Advanced Setup

### Running with Docker Compose

For a complete Docker setup including both InfluxDB and the application, you can create a `docker-compose.yml` file:

```yaml
version: '3'
services:
  influxdb:
    image: influxdb:latest
    ports:
      - "8086:8086"
    volumes:
      - influxdb-storage:/var/lib/influxdb2
      - influxdb-config:/etc/influxdb2
    environment:
      - DOCKER_INFLUXDB_INIT_MODE=setup
      - DOCKER_INFLUXDB_INIT_USERNAME=admin
      - DOCKER_INFLUXDB_INIT_PASSWORD=password123
      - DOCKER_INFLUXDB_INIT_ORG=my-org
      - DOCKER_INFLUXDB_INIT_BUCKET=trades
      - DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=my-super-secret-token

  app:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - influxdb
    environment:
      - PORT=3000
      - INFLUXDB_URL=http://influxdb:8086
      - INFLUXDB_TOKEN=my-super-secret-token
      - INFLUXDB_ORG=my-org
      - INFLUXDB_BUCKET=trades

volumes:
  influxdb-storage:
  influxdb-config:
```

You would also need to create a `Dockerfile` for the application:

```dockerfile
FROM node:22

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Note: This doesn't include the TradingView library
# You would need to add it separately

CMD ["npm", "start"]
```

Then run:

```bash
docker-compose up -d
```

### Setting Up for Production

For a production setup, consider:

1. Using a process manager like PM2:
   ```bash
   npm install -g pm2
   pm2 start src/server.js --name tradingview-influxdb-poc
   ```

2. Setting up a reverse proxy with Nginx or Apache

3. Implementing proper authentication and security measures

4. Setting up monitoring and alerting

## Conclusion

You should now have a fully functional TradingView InfluxDB POC running. You can generate test data, run downsampling tasks, and visualize the data using the TradingView charting library.

For more information, refer to the other documentation files:

- [API Documentation](api.md)
- [Downsampling System Documentation](downsampling.md)
- [Performance Testing Results](performance.md)
