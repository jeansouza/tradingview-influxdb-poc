# TradingView InfluxDB POC

A proof of concept application that demonstrates the integration of TradingView's charting library with InfluxDB for storing and visualizing trade data.

## Features

- Node.js and Express backend
- InfluxDB for time-series trade data storage
- TradingView Lightweight Charts for data visualization
- API endpoint to generate 3 million fake trades for testing
- Interactive UI for data management and visualization

## Prerequisites

- Node.js (v14 or higher)
- InfluxDB (v2.0 or higher)

## Setup

### 1. Install and Set Up InfluxDB on macOS

#### Using Homebrew (Recommended)

1. Install Homebrew if you don't have it already:
   ```
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. Install InfluxDB:
   ```
   brew update
   brew install influxdb
   ```

3. Start InfluxDB service:
   ```
   brew services start influxdb
   ```

4. Set up InfluxDB:
   ```
   influx setup
   ```
   
   This will prompt you to:
   - Enter a username (e.g., `admin`)
   - Enter a password
   - Confirm the password
   - Enter an organization name (e.g., `my-org`)
   - Enter a bucket name (use `trades` for this project)
   - Enter a retention period (or press Enter for infinite)

5. Get your API token:
   ```
   influx auth list
   ```
   
   This will display your API tokens. Copy the token with read/write access.

#### Using Docker

Alternatively, you can use Docker:

1. Pull the InfluxDB image:
   ```
   docker pull influxdb:latest
   ```

2. Run InfluxDB container:
   ```
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

   Replace the username, password, org, and token with your preferred values.

3. Access the InfluxDB UI at http://localhost:8086

### 2. Clone the Repository

```
git clone https://github.com/yourusername/tradingview-influxdb-poc.git
cd tradingview-influxdb-poc
```

### 3. Install Dependencies

```
npm install
```

### 4. Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```

2. Update the values in `.env` with your InfluxDB configuration:
   ```
   PORT=3000
   INFLUXDB_URL=http://localhost:8086
   INFLUXDB_TOKEN=your_influxdb_token  # The token you copied earlier
   INFLUXDB_ORG=my-org                 # The org name you provided during setup
   INFLUXDB_BUCKET=trades              # The bucket name you created
   ```

## Running the Application

### Standard Mode

Start the development server:

```
npm run dev
```

Or for production:

```
npm start
```

### High Memory Mode (Recommended for Generating Large Datasets)

For generating large datasets (400 million trades), use the high memory mode:

```
npm run dev:high-memory
```

Or for production:

```
npm run start:high-memory
```

This mode allocates 8GB of memory to Node.js, which helps prevent "JavaScript heap out of memory" errors when generating large amounts of data.

The application will be available at http://localhost:3000 in both modes.

## API Endpoints

- `GET /api/trades` - Get trades for a specific symbol and time range
- `POST /api/trades` - Create a new trade
- `GET /api/trades/generate` - Generate fake trades for testing
- `GET /api/trades/ohlc` - Get OHLC (Open, High, Low, Close) data for charting

## Generating Test Data

To generate 3 million fake trades for testing:

1. Start the application
2. Navigate to http://localhost:3000
3. In the "Generate Test Data" section, select the symbol and count
4. Click "Generate Trades"

Alternatively, you can use the API directly:

```
GET /api/trades/generate?symbol=BTCUSD&count=3000000
```

## Performance Considerations

- The application processes trade generation in batches to avoid memory issues
- For large datasets, consider adjusting the batch size in the controller
- InfluxDB is optimized for time-series data and should handle millions of trades efficiently

## License

This project is licensed under the GNU General Public License v3.0 - see the LICENSE file for details.
