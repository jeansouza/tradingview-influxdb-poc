# Technical Context: TradingView InfluxDB POC

## Technologies Used

### Frontend

1. **TradingView Charting Library**
   - Proprietary JavaScript library for financial charts
   - Requires license from TradingView
   - Supports candlestick charts, indicators, and custom timeframes
   - Integrated via custom datafeed implementation

2. **Vanilla JavaScript**
   - No frontend framework used (intentional simplicity for POC)
   - DOM manipulation for UI controls
   - Custom event handling
   - Fetch API for data retrieval

3. **HTML5 & CSS3**
   - Responsive layout
   - Flexbox for component positioning
   - CSS variables for theming
   - Media queries for mobile responsiveness

### Backend

1. **Node.js**
   - JavaScript runtime environment
   - Version 22.14.0 required
   - Asynchronous, event-driven architecture
   - Used with increased memory limits for large dataset processing

2. **Express.js**
   - Web application framework for Node.js
   - Routing for API endpoints
   - Middleware for request processing
   - Error handling

3. **InfluxDB**
   - Time-series database (version 2.0 or higher)
   - Flux query language for data manipulation
   - Task system for scheduled operations
   - Optimized for high write and read throughput

4. **InfluxDB Client Libraries**
   - @influxdata/influxdb-client for core operations
   - @influxdata/influxdb-client-apis for administrative operations
   - Configured with retry mechanisms and timeout handling

### Development Tools

1. **Nodemon**
   - Monitors for changes and automatically restarts server
   - Used in development mode

2. **dotenv**
   - Environment variable management
   - Configuration separation from code

## Development Setup

### Prerequisites

1. **Node.js (v22.14.0)**
   - Runtime environment for JavaScript
   - Required for running the application

2. **InfluxDB (v2.0 or higher)**
   - Time-series database
   - Can be installed via Homebrew (macOS) or Docker

3. **TradingView Charting Library**
   - Proprietary library (requires license)
   - Must be downloaded separately and installed via setup script

### Installation Steps

1. **InfluxDB Setup**
   ```bash
   # Using Homebrew (macOS)
   brew update
   brew install influxdb
   brew services start influxdb
   influx setup  # Follow prompts to create user, org, and bucket
   
   # Using Docker
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

2. **Application Setup**
   ```bash
   # Clone repository
   git clone https://github.com/jeansouza/tradingview-influxdb-poc.git
   cd tradingview-influxdb-poc
   
   # Install dependencies
   npm install
   
   # Configure environment
   cp .env.example .env
   # Edit .env with your InfluxDB details
   
   # Set up TradingView Charting Library
   node setup-tradingview.js
   # Follow prompts to provide path to library files
   ```

3. **Running the Application**
   ```bash
   # Development mode
   npm run dev
   
   # Development mode with high memory (for large datasets)
   npm run dev:high-memory
   
   # Production mode
   npm start
   
   # Production mode with high memory
   npm run start:high-memory
   ```

## Technical Constraints

### InfluxDB Constraints

1. **Query Complexity**
   - Complex queries with multiple aggregations can be resource-intensive
   - Queries over large time ranges may timeout
   - Fallback strategies implemented for handling timeouts

2. **Memory Usage**
   - Processing large datasets requires careful memory management
   - Batch processing implemented to avoid out-of-memory errors
   - High-memory mode available for generating large datasets

3. **Task Limitations**
   - Tasks run in the InfluxDB server environment
   - Limited visibility into task execution details
   - Custom status tracking implemented to monitor progress

### TradingView Library Constraints

1. **Licensing Requirements**
   - Requires commercial license from TradingView
   - Cannot be distributed with the application
   - Setup script provided to install after obtaining license

2. **Integration Complexity**
   - Custom datafeed implementation required
   - Specific data format expected by the library
   - Limited documentation for advanced customization

### Performance Constraints

1. **Data Volume**
   - System designed to handle 50M+ records
   - Performance degrades with extremely large datasets
   - Downsampling and resolution mapping implemented to mitigate

2. **Query Response Time**
   - Target response time: < 1 second for typical queries
   - Larger time ranges may take longer
   - Automatic resolution adjustment for very large ranges

## Dependencies

### Production Dependencies

```json
{
  "@influxdata/influxdb-client": "^1.35.0",
  "@influxdata/influxdb-client-apis": "^1.35.0",
  "cors": "^2.8.5",
  "dotenv": "^16.4.7",
  "express": "^4.21.2"
}
```

### Development Dependencies

```json
{
  "nodemon": "^3.1.9"
}
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| PORT | Server port | 3000 |
| INFLUXDB_URL | InfluxDB server URL | http://localhost:8086 |
| INFLUXDB_TOKEN | Authentication token | your_influxdb_token |
| INFLUXDB_ORG | Organization name | my-org |
| INFLUXDB_BUCKET | Bucket name for trade data | trades |

## Data Models

### Trade Data

```
Measurement: trade
Tags:
  - symbol: Trading pair (e.g., BTCUSD)
  - side: Buy or sell
Fields:
  - price: Trade price
  - amount: Trade amount
Timestamp: Trade execution time
```

### Downsampled OHLC Data

```
Measurement: trade_ohlc_{resolution}  (e.g., trade_ohlc_1m)
Tags:
  - symbol: Trading pair
Fields:
  - open: Opening price
  - high: Highest price
  - low: Lowest price
  - close: Closing price
  - volume: Total volume
Timestamp: Candle start time
```

### Task Status Data

```
Measurement: task_status
Tags:
  - task_name: Name of the downsampling task
Fields:
  - status: Current status (running/completed)
Timestamp: Status update time
```

### Downsampling Progress

```
Measurement: downsampling_progress
Tags:
  - resolution: Resolution being processed
Fields:
  - last_processed: Timestamp of last processed data
Timestamp: Progress update time
```

## API Endpoints

| Endpoint | Method | Description | Parameters |
|----------|--------|-------------|------------|
| /api/trades | GET | Get trades for a symbol and time range | symbol, start, end |
| /api/trades | POST | Create a new trade | symbol, side, price, amount, timestamp |
| /api/trades/generate | GET | Generate fake trades | symbol, count |
| /api/trades/ohlc | GET | Get OHLC data for charting | symbol, start, end, resolution |
| /api/symbols | GET | Get available symbols | none |
