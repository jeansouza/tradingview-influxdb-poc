# API Documentation

This document provides detailed information about the API endpoints available in the TradingView InfluxDB POC. These endpoints allow you to interact with the system, retrieve data, and generate test data.

## Base URL

All API endpoints are relative to the base URL of the server. By default, the server runs on:

```
http://localhost:3000
```

## Authentication

The API does not currently implement authentication. In a production environment, you would want to add appropriate authentication mechanisms.

## API Endpoints

### Get Trades

Retrieves raw trade data for a specific symbol and time range.

**Endpoint:** `GET /api/trades`

**Query Parameters:**

| Parameter | Type   | Required | Description                                      |
|-----------|--------|----------|--------------------------------------------------|
| symbol    | string | Yes      | Trading symbol (e.g., BTCUSD)                    |
| start     | string | Yes      | Start time in ISO 8601 format                    |
| end       | string | Yes      | End time in ISO 8601 format                      |

**Response:**

```json
[
  {
    "time": "2022-01-01T00:00:00.000Z",
    "price": 46785.23,
    "amount": 0.5432,
    "side": "buy",
    "symbol": "BTCUSD"
  },
  {
    "time": "2022-01-01T00:00:05.000Z",
    "price": 46790.15,
    "amount": 0.1234,
    "side": "sell",
    "symbol": "BTCUSD"
  }
]
```

**Example:**

```bash
curl "http://localhost:3000/api/trades?symbol=BTCUSD&start=2022-01-01T00:00:00Z&end=2022-01-02T00:00:00Z"
```

**Error Responses:**

| Status Code | Description                                                |
|-------------|------------------------------------------------------------|
| 400         | Missing required parameters                                |
| 500         | Server error (e.g., database connection issue)             |

---

### Create Trade

Creates a new trade record.

**Endpoint:** `POST /api/trades`

**Request Body:**

```json
{
  "symbol": "BTCUSD",
  "side": "buy",
  "price": 46785.23,
  "amount": 0.5432,
  "timestamp": "2022-01-01T00:00:00.000Z" // Optional, defaults to current time
}
```

**Response:**

```json
{
  "message": "Trade created successfully",
  "trade": {
    "symbol": "BTCUSD",
    "side": "buy",
    "price": 46785.23,
    "amount": 0.5432,
    "timestamp": "2022-01-01T00:00:00.000Z"
  }
}
```

**Example:**

```bash
curl -X POST "http://localhost:3000/api/trades" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSD","side":"buy","price":46785.23,"amount":0.5432}'
```

**Error Responses:**

| Status Code | Description                                                |
|-------------|------------------------------------------------------------|
| 400         | Missing required fields or invalid data                    |
| 500         | Server error (e.g., database connection issue)             |

---

### Generate Fake Trades

Generates fake trade data for testing purposes. This endpoint is particularly useful for performance testing and populating the database with realistic data.

**Endpoint:** `GET /api/trades/generate`

**Query Parameters:**

| Parameter | Type   | Required | Description                                      |
|-----------|--------|----------|--------------------------------------------------|
| symbol    | string | No       | Trading symbol (default: BTCUSD)                 |
| count     | number | No       | Number of trades to generate (default: 10000)    |

**Response:**

The response is streamed as plain text, providing progress updates as trades are generated and written to the database.

```
Starting to generate 10000 fake trades for BTCUSD with 2-second intervals starting from 2022-01-01T00:00:00Z...
Processing batch of 10000 trades (0 to 10000)
Successfully wrote batch of 10000 trades
Generated 10000 of 10000 trades (100%)

Completed generating 10000 fake trades in 3.45 seconds.
```

**Example:**

```bash
curl "http://localhost:3000/api/trades/generate?symbol=BTCUSD&count=10000"
```

**Notes:**

- For large datasets (millions of records), use the high-memory mode of the application.
- The generation process uses a random walk algorithm to create realistic price movements.
- Trades are generated with timestamps starting from January 1, 2022, with 2-second intervals.
- If trades already exist for the symbol, new trades will continue from the latest timestamp.

---

### Get OHLC Data

Retrieves OHLC (Open, High, Low, Close) data for charting. This endpoint is used by the TradingView library to render candlestick charts.

**Endpoint:** `GET /api/trades/ohlc`

**Query Parameters:**

| Parameter  | Type   | Required | Description                                      |
|------------|--------|----------|--------------------------------------------------|
| symbol     | string | Yes      | Trading symbol (e.g., BTCUSD)                    |
| resolution | string | Yes      | Chart resolution (e.g., 1, 5, 15, 60, D)         |
| start      | string | Yes      | Start time in ISO 8601 format                    |
| end        | string | Yes      | End time in ISO 8601 format                      |

**Response:**

```json
[
  {
    "time": 1641024000000,
    "open": 46785.23,
    "high": 46890.15,
    "low": 46750.45,
    "close": 46830.78,
    "volume": 12.3456
  },
  {
    "time": 1641027600000,
    "open": 46830.78,
    "high": 46950.20,
    "low": 46800.10,
    "close": 46920.55,
    "volume": 15.6789
  }
]
```

**Example:**

```bash
curl "http://localhost:3000/api/trades/ohlc?symbol=BTCUSD&resolution=60&start=2022-01-01T00:00:00Z&end=2022-01-02T00:00:00Z"
```

**Notes:**

- The `resolution` parameter accepts various formats:
  - Numeric values: 1, 5, 15, 30, 60, 120, 240, 360, 720
  - Letter formats: D (day)
- The system automatically maps requested resolutions to available downsampled data:
  - 30 → 15m (uses 15m data for 30m requests)
  - 120 → 1h (uses 1h data for 2h requests)
  - etc.
- For very large date ranges, the system automatically selects a larger resolution to improve performance:
  - Date range > 365 days: Forces 1d resolution
  - Date range > 90 days: Forces 1h resolution for smaller requests
  - Date range > 30 days: Forces 15m resolution for 1m requests
- The `time` field in the response is in milliseconds since the Unix epoch.

**Error Responses:**

| Status Code | Description                                                |
|-------------|------------------------------------------------------------|
| 400         | Missing required parameters                                |
| 500         | Server error (e.g., database connection issue)             |
| 504         | Query timeout (try a smaller date range or larger resolution) |

---

### Get Symbols

Retrieves available trading symbols.

**Endpoint:** `GET /api/symbols`

**Response:**

```json
[
  {
    "symbol": "BTCUSD",
    "description": "BTC/USD",
    "exchange": "InfluxDB",
    "type": "crypto"
  },
  {
    "symbol": "ETHUSD",
    "description": "ETH/USD",
    "exchange": "InfluxDB",
    "type": "crypto"
  },
  {
    "symbol": "LTCUSD",
    "description": "LTC/USD",
    "exchange": "InfluxDB",
    "type": "crypto"
  }
]
```

**Example:**

```bash
curl "http://localhost:3000/api/symbols"
```

## Resolution Mapping

The system maps user-requested resolutions to available downsampled data to optimize storage while providing accurate visualization:

| Requested Resolution | Used Downsampled Resolution |
|----------------------|-----------------------------|
| 1                    | 1m                          |
| 5                    | 5m                          |
| 15                   | 15m                         |
| 30                   | 15m                         |
| 60                   | 1h                          |
| 120                  | 1h                          |
| 240                  | 4h                          |
| 360                  | 4h                          |
| 720                  | 4h                          |
| D                    | 1d                          |

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

## Performance Considerations

1. **Large Date Ranges**: For very large date ranges, the system automatically selects a larger resolution to improve performance. If you need to query a large date range with a small resolution, consider breaking it into smaller chunks.

2. **Query Timeouts**: Queries over very large date ranges may timeout. If you encounter a timeout, try reducing the date range or increasing the resolution.

3. **Batch Processing**: When generating large amounts of data, the system processes it in batches to manage memory usage. The default batch size is 100,000 trades.

4. **Pre-Downsampled Data**: The system uses pre-downsampled data for OHLC queries, which significantly improves performance compared to calculating OHLC data on-the-fly.

## Error Handling

The API returns standard HTTP status codes to indicate the success or failure of a request:

- 200 OK: The request was successful.
- 400 Bad Request: The request was invalid or missing required parameters.
- 500 Internal Server Error: An error occurred on the server.
- 504 Gateway Timeout: The query timed out.

Error responses include a JSON object with an `error` field containing a description of the error:

```json
{
  "error": "Symbol, start, and end parameters are required"
}
```

## Examples

### Generate Test Data and Query OHLC

1. Generate 1 million trades for BTCUSD:

```bash
curl "http://localhost:3000/api/trades/generate?symbol=BTCUSD&count=1000000"
```

2. Run downsampling tasks to create OHLC data:

```bash
node src/scripts/runDownsamplingTask.js all
```

3. Query OHLC data for a 1-day period with 1-hour resolution:

```bash
curl "http://localhost:3000/api/trades/ohlc?symbol=BTCUSD&resolution=60&start=2022-01-01T00:00:00Z&end=2022-01-02T00:00:00Z"
```

### Create a Trade and Retrieve It

1. Create a new trade:

```bash
curl -X POST "http://localhost:3000/api/trades" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSD","side":"buy","price":46785.23,"amount":0.5432}'
```

2. Retrieve trades for the last hour:

```bash
curl "http://localhost:3000/api/trades?symbol=BTCUSD&start=$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)&end=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

## Conclusion

The API provides a comprehensive set of endpoints for interacting with the TradingView InfluxDB POC. It allows you to retrieve raw trade data, generate test data, and query OHLC data for charting.

The system is designed to handle large volumes of data efficiently, with features like automatic resolution selection and pre-downsampling to optimize performance.
