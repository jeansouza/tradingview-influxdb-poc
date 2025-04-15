const { influxDB, writeApi, queryApi, config } = require('../config/influxdb');
const { Point } = require('@influxdata/influxdb-client');

// Helper function to convert resolution to InfluxDB format
const getDownsampledResolution = (resolution) => {
  // Map the requested resolution to the closest available downsampled resolution
  // This is the single source of truth for resolution mapping
  const resolutionMapping = {
    // Numeric formats (from frontend)
    '1': '1m',
    '5': '5m',
    '15': '15m',
    '30': '15m', // Use 15m for 30m requests
    '45': '45m', // 45 minute resolution
    '60': '1h',
    '120': '1h',  // Use 1h for 2h requests
    '180': '3h',  // 3 hour resolution
    '240': '4h',
    '360': '4h',  // Use 4h for 6h requests
    '720': '4h', // Use 4h for 12h requests
    
    // Letter formats (uppercase)
    'D': '1d',
    '1D': '1d',
    'W': '1w',
    '1W': '1w',
    'MO': '1M',
    '1MO': '1M',
    
    // Letter formats with units (uppercase)
    '1S': '1s',
    '1M': '1m',
    '5M': '5m',
    '15M': '15m',
    '30M': '15m',
    '45M': '45m',
    '60M': '1h',
    '120M': '1h',
    '180M': '3h',
    '240M': '4h',
    '1H': '1h',
    '2H': '1h',
    '3H': '3h',
    '4H': '4h',
    '6H': '4h',
    '12H': '4h',
    '1D': '1d',
    '1W': '1w',
    '1MO': '1M',
    
    // Letter formats with units (lowercase)
    '1s': '1s',
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '15m',
    '45m': '45m',
    '60m': '1h',
    '120m': '1h',
    '180m': '3h',
    '240m': '4h',
    '1h': '1h',
    '2h': '1h',
    '3h': '3h',
    '4h': '4h',
    '6h': '4h',
    '12h': '4h',
    '1d': '1d',
    '1w': '1w',
    '1M': '1M'
  };
  
  // Try direct lookup first
  if (resolutionMapping[resolution]) {
    return resolutionMapping[resolution];
  }
  
  // Try uppercase version
  if (resolutionMapping[resolution.toUpperCase()]) {
    return resolutionMapping[resolution.toUpperCase()];
  }
  
  // Default to 5m if no match found
  console.log(`No direct mapping for resolution ${resolution}, defaulting to 5m`);
  return '5m';
};

// Function to write a single trade point
const writeTrade = async (trade) => {
  try {
    console.log('Writing single trade:', trade.symbol, trade.price);

    // Create a dedicated write API for this single trade to ensure proper flushing
    const singleTradeWriteApi = influxDB.getWriteApi(config.org, config.bucket, 'ns', {
      defaultTags: { source: 'tradingview-poc' },
      maxRetries: 15,
      retryJitter: 500,
      minRetryDelay: 1000,
      maxRetryDelay: 20000,
      exponentialBase: 2,
      maxRetryTime: 600000, // 10 minutes
      maxBufferLines: 10, // Small buffer for single trade
      flushInterval: 1000 // 1 second
    });

    const point = new Point('trade')
      .tag('symbol', trade.symbol)
      .tag('side', trade.side)
      .floatField('price', trade.price)
      .floatField('amount', trade.amount)
      .timestamp(trade.timestamp || new Date());

    singleTradeWriteApi.writePoint(point);

    console.log('Flushing single trade...');
    await singleTradeWriteApi.flush();
    console.log('Single trade flushed successfully');
    
    // Close the write API
    await singleTradeWriteApi.close();
    console.log('Single trade write API closed successfully');

    return Promise.resolve();
  } catch (error) {
    console.error('Error writing single trade:', error);
    throw error;
  }
};

// Function to write multiple trade points in batch
const writeTrades = async (trades) => {
  if (!trades || trades.length === 0) {
    console.log('No trades to write');
    return Promise.resolve();
  }

  console.log(`Writing ${trades.length} trades to InfluxDB...`);

  // Use larger batch sizes for better performance
  const BATCH_SIZE = 10000;

  try {
    // Split trades into smaller batches
    for (let i = 0; i < trades.length; i += BATCH_SIZE) {
      const batch = trades.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${i/BATCH_SIZE + 1} of ${Math.ceil(trades.length/BATCH_SIZE)} (${batch.length} trades)`);

      // Create a new write API for each batch to ensure proper flushing and closing
      const batchWriteApi = influxDB.getWriteApi(config.org, config.bucket, 'ns', {
        defaultTags: { source: 'tradingview-poc' },
        maxRetries: 15, // Increased from 10
        retryJitter: 500,
        minRetryDelay: 1000,
        maxRetryDelay: 20000, // Increased from 15000
        exponentialBase: 2,
        maxRetryTime: 600000, // 10 minutes (increased from 5 minutes)
        maxBufferLines: 2000, // Increased from 1000
        flushInterval: 1000 // Reduced from 2000 ms
      });

      // Add points to the write API
      batch.forEach(trade => {
        const point = new Point('trade')
          .tag('symbol', trade.symbol)
          .tag('side', trade.side)
          .floatField('price', trade.price)
          .floatField('amount', trade.amount)
          .timestamp(trade.timestamp || new Date());

        batchWriteApi.writePoint(point);
      });

      console.log(`Batch ${i/BATCH_SIZE + 1}: Points added to write buffer, flushing...`);

      // Flush the write API
      await batchWriteApi.flush();
      console.log(`Batch ${i/BATCH_SIZE + 1}: Flush completed successfully`);

      // Close the write API
      await batchWriteApi.close();
      console.log(`Batch ${i/BATCH_SIZE + 1}: Write API closed successfully`);

      // No delay between batches for faster processing
      if (i + BATCH_SIZE < trades.length) {
        console.log('Processing next batch...');
      }
    }

    console.log('All batches processed successfully');
    return Promise.resolve();
  } catch (error) {
    console.error('Error writing trades:', error);
    throw error;
  }
};

// Function to query trades by symbol and time range
const queryTrades = async (symbol, start, end) => {
  console.log(`Querying trades for ${symbol} from ${start} to ${end}`);

  // Query to fetch trades
  const fluxQuery = `
    from(bucket: "${config.bucket}")
      |> range(start: ${start}, stop: ${end})
      |> filter(fn: (r) => r._measurement == "trade")
      |> filter(fn: (r) => r.symbol == "${symbol}")
      |> pivot(rowKey:["_time", "symbol", "side"], columnKey: ["_field"], valueColumn: "_value")
      |> drop(columns: ["_start", "_stop", "_measurement"])
  `;

  console.log('Executing query:', fluxQuery);

  const result = [];
  try {
    for await (const { values, tableMeta } of queryApi.iterateRows(fluxQuery)) {
      const o = tableMeta.toObject(values);
      result.push({
        time: o._time,
        price: o.price,
        amount: o.amount,
        side: o.side,
        symbol: o.symbol
      });
    }

    console.log(`Query returned ${result.length} trades`);
    return result;
  } catch (error) {
    console.error('Error querying trades:', error);
    throw error;
  }
};

// Get trades for a specific symbol and time range
const getTrades = async (req, res) => {
  try {
    const { symbol, start, end } = req.query;

    if (!symbol || !start || !end) {
      return res.status(400).json({ error: 'Symbol, start, and end parameters are required' });
    }

    const trades = await queryTrades(symbol, start, end);
    return res.json(trades);
  } catch (error) {
    console.error('Error fetching trades:', error);
    return res.status(500).json({ error: 'Failed to fetch trades' });
  }
};

// Create a single trade
const createTrade = async (req, res) => {
  try {
    const { symbol, side, price, amount, timestamp } = req.body;

    if (!symbol || !side || !price || !amount) {
      return res.status(400).json({ error: 'Symbol, side, price, and amount are required' });
    }

    const trade = {
      symbol,
      side,
      price: parseFloat(price),
      amount: parseFloat(amount),
      timestamp: timestamp ? new Date(timestamp) : new Date()
    };

    await writeTrade(trade);
    return res.status(201).json({ message: 'Trade created successfully', trade });
  } catch (error) {
    console.error('Error creating trade:', error);
    return res.status(500).json({ error: 'Failed to create trade' });
  }
};

// Function to get the latest trade timestamp for a symbol
const getLatestTradeTimestamp = async (symbol) => {
  console.log(`Finding latest trade timestamp for ${symbol}`);
  
  // Query to fetch the latest trade timestamp
  const fluxQuery = `
    from(bucket: "${config.bucket}")
      |> range(start: 0)
      |> filter(fn: (r) => r._measurement == "trade")
      |> filter(fn: (r) => r.symbol == "${symbol}")
      |> filter(fn: (r) => r._field == "price")
      |> last()
  `;

  try {
    let latestTimestamp = null;
    
    for await (const { values, tableMeta } of queryApi.iterateRows(fluxQuery)) {
      const o = tableMeta.toObject(values);
      latestTimestamp = new Date(o._time);
    }
    
    if (latestTimestamp) {
      console.log(`Latest trade timestamp for ${symbol}: ${latestTimestamp}`);
      return latestTimestamp.getTime();
    } else {
      console.log(`No existing trades found for ${symbol}, using default start date`);
      return null;
    }
  } catch (error) {
    console.error('Error querying latest trade timestamp:', error);
    return null;
  }
};

// Generate fake trades for testing
const generateFakeTrades = async (req, res) => {
  try {
    // No cap on the number of trades that can be generated
    const { symbol = 'BTCUSD', count: requestedCount = 10000 } = req.query;
    const count = parseInt(requestedCount); // No cap, generate as many as requested

    // Use a larger batch size for better performance
    const batchSize = 100000; // Increased as requested
    let processedCount = 0;

    // Send initial response
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked'
    });

    // Get the latest trade timestamp for the symbol
    const latestTimestamp = await getLatestTradeTimestamp(symbol);
    
    // Default start date: January 1, 2022
    const defaultBaseTimestamp = new Date('2022-01-01T00:00:00Z').getTime();
    
    // If we have existing trades, start from the latest timestamp + interval
    // Otherwise, use the default start date
    const baseTimestamp = latestTimestamp 
      ? latestTimestamp + 2000 // Add 2 seconds to the latest timestamp
      : defaultBaseTimestamp;
    
    const timeInterval = 2000; // 2 seconds in milliseconds
    
    // Format the start date for display
    const startDateStr = new Date(baseTimestamp).toISOString();
    
    if (latestTimestamp) {
      res.write(`Starting to generate ${count} fake trades for ${symbol} with 2-second intervals continuing from ${startDateStr}...\n`);
    } else {
      res.write(`Starting to generate ${count} fake trades for ${symbol} with 2-second intervals starting from ${startDateStr}...\n`);
    }

    const startTime = Date.now();
    
    // If we have existing trades, try to continue with a similar price
    // Otherwise, use a random starting price
    let startPrice;
    
    if (latestTimestamp) {
      // Query to fetch the latest trade price
      const fluxQuery = `
        from(bucket: "${config.bucket}")
          |> range(start: 0)
          |> filter(fn: (r) => r._measurement == "trade")
          |> filter(fn: (r) => r.symbol == "${symbol}")
          |> filter(fn: (r) => r._field == "price")
          |> last()
      `;
      
      try {
        let latestPrice = null;
        
        for await (const { values, tableMeta } of queryApi.iterateRows(fluxQuery)) {
          const o = tableMeta.toObject(values);
          latestPrice = o._value;
        }
        
        if (latestPrice) {
          startPrice = latestPrice;
          console.log(`Using latest price for ${symbol}: ${startPrice}`);
        } else {
          startPrice = 30000 + Math.random() * 10000; // Random starting price around 30-40k
        }
      } catch (error) {
        console.error('Error querying latest trade price:', error);
        startPrice = 30000 + Math.random() * 10000; // Random starting price around 30-40k
      }
    } else {
      startPrice = 30000 + Math.random() * 10000; // Random starting price around 30-40k
    }

    // Use a generator function to create trades on-demand
    // This prevents storing large arrays in memory
    function* tradeGenerator(batchCount, currentProcessedCount) {
      // Keep track of the last price to create a more realistic random walk
      let lastPrice = startPrice;
      
      // Base price to calculate the allowed range (30% variation)
      const basePrice = startPrice;
      const minPrice = basePrice * 0.85; // 15% below base price
      const maxPrice = basePrice * 1.15; // 15% above base price
      
      // Maximum percentage change per trade (0.5% = 0.005)
      const maxPercentChange = 0.005;
      
      for (let i = 0; i < batchCount; i++) {
        // Generate realistic price movement (random walk with no bias)
        // Random value between -1.0 and 1.0
        const randomFactor = (Math.random() * 2) - 1.0;
        
        // Calculate price change as a percentage of the last price
        const priceChange = lastPrice * maxPercentChange * randomFactor;
        
        // Update the price with the change
        let currentPrice = lastPrice + priceChange;
        
        // Ensure price stays within the allowed range (30% variation)
        if (currentPrice < minPrice) {
          // If price would go below minimum, bounce it back up
          currentPrice = minPrice + Math.random() * (lastPrice - minPrice);
        } else if (currentPrice > maxPrice) {
          // If price would go above maximum, bounce it back down
          currentPrice = maxPrice - Math.random() * (maxPrice - lastPrice);
        }
        
        // Save this price for the next iteration
        lastPrice = currentPrice;

        // Random trade size between 0.001 and 2 BTC
        const amount = 0.001 + Math.random() * 1.999;

        // Random side (buy/sell)
        const side = Math.random() > 0.5 ? 'buy' : 'sell';

        // Timestamp with 2-second progression from 2022
        const timestamp = new Date(baseTimestamp + ((currentProcessedCount + i) * timeInterval));

        yield {
          symbol,
          side,
          price: currentPrice,
          amount,
          timestamp
        };
      }
    }

    // Process in batches with delays to allow garbage collection
    while (processedCount < count) {
      // Calculate batch size for this iteration
      const batchCount = Math.min(batchSize, count - processedCount);

      console.log(`Processing batch of ${batchCount} trades (${processedCount} to ${processedCount + batchCount})`);
      res.write(`Processing batch of ${batchCount} trades (${processedCount} to ${processedCount + batchCount})\n`);

      // Create a generator for this batch
      const batchGenerator = tradeGenerator(batchCount, processedCount);

      // Collect trades for this batch
      const batchTrades = Array.from(batchGenerator);

      try {
        // Write trades to InfluxDB
        await writeTrades(batchTrades);
        console.log(`Successfully wrote batch of ${batchCount} trades`);
        res.write(`Successfully wrote batch of ${batchCount} trades\n`);
      } catch (error) {
        console.error('Error writing trades to InfluxDB:', error);
        res.write(`Error writing trades: ${error.message}\n`);
        throw error;
      }

      processedCount += batchCount;

      // Update progress
      const progressMessage = `Generated ${processedCount} of ${count} trades (${Math.round(processedCount/count*100)}%)`;
      res.write(`${progressMessage}\n`);
      console.log(progressMessage);

      // No delay between batches for faster processing
      if (processedCount < count) {
        console.log('Processing next batch...');
        res.write('Processing next batch...\n');
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    res.write(`\nCompleted generating ${count} fake trades in ${duration.toFixed(2)} seconds.\n`);
    res.end();
  } catch (error) {
    console.error('Error generating fake trades:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to generate fake trades' });
    } else {
      res.write(`\nError: ${error.message}\n`);
      res.end();
    }
  }
};

// Get OHLC data for charting - using pre-downsampled data
const getOHLC = async (req, res) => {
  try {
    const { symbol, start, end, resolution } = req.query;

    if (!symbol || !start || !end || !resolution) {
      return res.status(400).json({ error: 'Symbol, start, end, and resolution parameters are required' });
    }

    console.log(`Generating OHLC data for ${symbol} from ${start} to ${end} with resolution ${resolution}`);

    // Parse dates and calculate time range
    const startDate = new Date(start);
    const endDate = new Date(end);
    const timeRangeMs = endDate.getTime() - startDate.getTime();
    const dateRangeDays = timeRangeMs / (24 * 60 * 60 * 1000);
    
    console.log(`Date range for OHLC: ${timeRangeMs}ms (${dateRangeDays.toFixed(2)} days)`);

    // Use the unified getDownsampledResolution function to get the appropriate resolution
    let downsampledResolution = getDownsampledResolution(resolution);
    
    console.log(`Initial downsampled resolution mapping: ${resolution} -> ${downsampledResolution}`);

    // For very large date ranges, force a larger resolution to improve performance
    // This ensures we use the best fitting downsampled data based on the date range
    if (dateRangeDays > 365 && downsampledResolution !== '1d') {
      console.log(`Date range is over a year, forcing 1d resolution instead of ${downsampledResolution}`);
      downsampledResolution = '1d';
    } else if (dateRangeDays > 90 && ['1m', '5m'].includes(downsampledResolution)) {
      console.log(`Date range is over 90 days, forcing 1h resolution instead of ${downsampledResolution}`);
      downsampledResolution = '1h';
    } else if (dateRangeDays > 30 && downsampledResolution === '1m') {
      console.log(`Date range is over 30 days, forcing 15m resolution instead of ${downsampledResolution}`);
      downsampledResolution = '15m';
    }

    console.log(`Using downsampled resolution: ${downsampledResolution}`);

    // Set a reasonable limit on the number of data points to return
    const MAX_DATA_POINTS = 5000;
    
    // Calculate if we need to further downsample the data
    const resolutionMs = parseResolutionToMs(resolution);
    const expectedDataPoints = timeRangeMs / resolutionMs;
    
    console.log(`Expected data points at ${resolution} resolution: ~${Math.ceil(expectedDataPoints)}`);
    
    let aggregateWindow = null;
    
    // If we expect too many data points, add an additional aggregation step
    if (expectedDataPoints > MAX_DATA_POINTS) {
      const aggregateFactor = Math.ceil(expectedDataPoints / MAX_DATA_POINTS);
      aggregateWindow = `${Math.ceil(aggregateFactor * resolutionMs / 1000)}s`;
      console.log(`Too many data points, adding aggregation window of ${aggregateWindow} to limit to ~${MAX_DATA_POINTS} points`);
    }

    try {
      // Query the pre-downsampled data from the appropriate measurement
      // This is much more efficient than calculating OHLC from raw trade data
      let fluxQuery = `
        // Query pre-downsampled data from the appropriate measurement
        from(bucket: "${config.bucket}")
          |> range(start: ${startDate.toISOString()}, stop: ${endDate.toISOString()})
          |> filter(fn: (r) => r._measurement == "trade_ohlc_${downsampledResolution}")
          |> filter(fn: (r) => r.symbol == "${symbol}")
      `;
      
      // If we need to further aggregate the data to reduce the number of points
      if (aggregateWindow) {
        // For large datasets, use a simpler approach with separate queries for each field
        // This avoids complex nested operations that can cause errors
        
        // Get open values (first value in each window)
        const openQuery = `
          from(bucket: "${config.bucket}")
            |> range(start: ${startDate.toISOString()}, stop: ${endDate.toISOString()})
            |> filter(fn: (r) => r._measurement == "trade_ohlc_${downsampledResolution}")
            |> filter(fn: (r) => r.symbol == "${symbol}")
            |> filter(fn: (r) => r._field == "open")
            |> aggregateWindow(every: ${aggregateWindow}, fn: first, createEmpty: false)
        `;
        
        // Get high values (max value in each window)
        const highQuery = `
          from(bucket: "${config.bucket}")
            |> range(start: ${startDate.toISOString()}, stop: ${endDate.toISOString()})
            |> filter(fn: (r) => r._measurement == "trade_ohlc_${downsampledResolution}")
            |> filter(fn: (r) => r.symbol == "${symbol}")
            |> filter(fn: (r) => r._field == "high")
            |> aggregateWindow(every: ${aggregateWindow}, fn: max, createEmpty: false)
        `;
        
        // Get low values (min value in each window)
        const lowQuery = `
          from(bucket: "${config.bucket}")
            |> range(start: ${startDate.toISOString()}, stop: ${endDate.toISOString()})
            |> filter(fn: (r) => r._measurement == "trade_ohlc_${downsampledResolution}")
            |> filter(fn: (r) => r.symbol == "${symbol}")
            |> filter(fn: (r) => r._field == "low")
            |> aggregateWindow(every: ${aggregateWindow}, fn: min, createEmpty: false)
        `;
        
        // Get close values (last value in each window)
        const closeQuery = `
          from(bucket: "${config.bucket}")
            |> range(start: ${startDate.toISOString()}, stop: ${endDate.toISOString()})
            |> filter(fn: (r) => r._measurement == "trade_ohlc_${downsampledResolution}")
            |> filter(fn: (r) => r.symbol == "${symbol}")
            |> filter(fn: (r) => r._field == "close")
            |> aggregateWindow(every: ${aggregateWindow}, fn: last, createEmpty: false)
        `;
        
        // Get volume values (sum in each window)
        const volumeQuery = `
          from(bucket: "${config.bucket}")
            |> range(start: ${startDate.toISOString()}, stop: ${endDate.toISOString()})
            |> filter(fn: (r) => r._measurement == "trade_ohlc_${downsampledResolution}")
            |> filter(fn: (r) => r.symbol == "${symbol}")
            |> filter(fn: (r) => r._field == "volume")
            |> aggregateWindow(every: ${aggregateWindow}, fn: sum, createEmpty: false)
        `;
        
        console.log('Executing separate queries for each OHLC component');
        
        // Execute all queries in parallel
        const [openRows, highRows, lowRows, closeRows, volumeRows] = await Promise.all([
          queryApi.collectRows(openQuery),
          queryApi.collectRows(highQuery),
          queryApi.collectRows(lowQuery),
          queryApi.collectRows(closeQuery),
          queryApi.collectRows(volumeQuery)
        ]);
        
        // Create a map of time to OHLC data
        const timeMap = new Map();
        
        // Process open values
        openRows.forEach(row => {
          const time = new Date(row._time).getTime();
          if (!timeMap.has(time)) {
            timeMap.set(time, { time });
          }
          timeMap.get(time).open = row._value;
        });
        
        // Process high values
        highRows.forEach(row => {
          const time = new Date(row._time).getTime();
          if (!timeMap.has(time)) {
            timeMap.set(time, { time });
          }
          timeMap.get(time).high = row._value;
        });
        
        // Process low values
        lowRows.forEach(row => {
          const time = new Date(row._time).getTime();
          if (!timeMap.has(time)) {
            timeMap.set(time, { time });
          }
          timeMap.get(time).low = row._value;
        });
        
        // Process close values
        closeRows.forEach(row => {
          const time = new Date(row._time).getTime();
          if (!timeMap.has(time)) {
            timeMap.set(time, { time });
          }
          timeMap.get(time).close = row._value;
        });
        
        // Process volume values
        volumeRows.forEach(row => {
          const time = new Date(row._time).getTime();
          if (!timeMap.has(time)) {
            timeMap.set(time, { time });
          }
          timeMap.get(time).volume = row._value || 0;
        });
        
        // Convert map to array and filter out incomplete candles
        const result = Array.from(timeMap.values())
          .filter(candle => 
            candle.open !== undefined && 
            candle.high !== undefined && 
            candle.low !== undefined && 
            candle.close !== undefined
          )
          .sort((a, b) => a.time - b.time);
        
        console.log(`Generated ${result.length} OHLC candles from pre-downsampled data using separate queries`);
        return res.json(result);
      } else {
        // If no additional aggregation is needed, just pivot the data
        fluxQuery += `
          |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
        `;
        
        console.log('Executing simple pivot query on pre-downsampled data');
        
        // Process the query results
        const rows = await queryApi.collectRows(fluxQuery);
        
        // Process the rows
        const ohlcData = rows
          .filter(row => 
            row.open !== undefined && 
            row.high !== undefined && 
            row.low !== undefined && 
            row.close !== undefined
          )
          .map(row => ({
            time: new Date(row._time).getTime(),
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            volume: row.volume || 0
          }))
          .sort((a, b) => a.time - b.time);
        
        console.log(`Generated ${ohlcData.length} OHLC candles from pre-downsampled data`);
        return res.json(ohlcData);
      }
      
      console.log('Executing query on pre-downsampled data');
      
      // Set a timeout for the query
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Query timed out after 30 seconds')), 30000);
      });
      
      // Process the query results
      const ohlcData = [];
      
      // Create a promise for the query execution
      const queryPromise = new Promise(async (resolve, reject) => {
        try {
          // Use collectRows instead of iterateRows for better performance with large datasets
          const rows = await queryApi.collectRows(fluxQuery);
          
          // Process the rows
          for (const row of rows) {
            // Only include candles with all required fields
            if (row.open !== undefined && row.high !== undefined && 
                row.low !== undefined && row.close !== undefined) {
              ohlcData.push({
                time: new Date(row._time).getTime(),
                open: row.open,
                high: row.high,
                low: row.low,
                close: row.close,
                volume: row.volume || 0
              });
            }
          }
          
          resolve(ohlcData);
        } catch (error) {
          reject(error);
        }
      });
      
      // Race the query against the timeout
      const result = await Promise.race([queryPromise, timeoutPromise]);
      
      // Sort by time
      result.sort((a, b) => a.time - b.time);
      
      console.log(`Generated ${result.length} OHLC candles from pre-downsampled data`);
      return res.json(result);
    } catch (error) {
      console.error('Error generating OHLC data from pre-downsampled data:', error);
      
      if (error.message.includes('Query timed out')) {
        return res.status(504).json({ 
          error: 'Query timed out. Try a smaller date range or a larger resolution.' 
        });
      }
      
      // If the downsampled data query fails, try a more aggressive approach with a larger resolution
      console.log('Query on pre-downsampled data failed, trying with a larger resolution');
      
      // Choose a larger resolution based on the current one
      let largerResolution;
      if (downsampledResolution === '1m') largerResolution = '15m';
      else if (downsampledResolution === '5m') largerResolution = '1h';
      else if (downsampledResolution === '15m') largerResolution = '4h';
      else if (downsampledResolution === '1h') largerResolution = '1d';
      else largerResolution = '1d'; // Default to daily
      
      console.log(`Trying with larger resolution: ${largerResolution}`);
      
      try {
        // Query with the larger resolution
        const fallbackQuery = `
          from(bucket: "${config.bucket}")
            |> range(start: ${startDate.toISOString()}, stop: ${endDate.toISOString()})
            |> filter(fn: (r) => r._measurement == "trade_ohlc_${largerResolution}")
            |> filter(fn: (r) => r.symbol == "${symbol}")
            |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
        `;
        
        console.log('Executing fallback query with larger resolution');
        
        // Set a shorter timeout for the fallback query
        const fallbackTimeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Fallback query timed out after 15 seconds')), 15000);
        });
        
        // Process the query results
        const fallbackQueryPromise = new Promise(async (resolve, reject) => {
          try {
            const rows = await queryApi.collectRows(fallbackQuery);
            
            const ohlcData = rows
              .filter(row => row.open !== undefined && row.high !== undefined && 
                      row.low !== undefined && row.close !== undefined)
              .map(row => ({
                time: new Date(row._time).getTime(),
                open: row.open,
                high: row.high,
                low: row.low,
                close: row.close,
                volume: row.volume || 0
              }))
              .sort((a, b) => a.time - b.time);
            
            resolve(ohlcData);
          } catch (error) {
            reject(error);
          }
        });
        
        // Race the fallback query against the timeout
        const fallbackResult = await Promise.race([fallbackQueryPromise, fallbackTimeoutPromise]);
        
        console.log(`Generated ${fallbackResult.length} OHLC candles using fallback larger resolution`);
        return res.json(fallbackResult);
      } catch (fallbackError) {
        console.error('Error in fallback query:', fallbackError);
        
        if (fallbackError.message.includes('timed out')) {
          return res.status(504).json({ 
            error: 'Query timed out even with larger resolution. Try a much smaller date range.' 
          });
        }
        
        // Last resort: try to get just a small sample of data
        try {
          console.log('Trying last resort: getting a limited sample of data');
          
          const lastResortQuery = `
            from(bucket: "${config.bucket}")
              |> range(start: ${startDate.toISOString()}, stop: ${endDate.toISOString()})
              |> filter(fn: (r) => r._measurement == "trade_ohlc_1d")
              |> filter(fn: (r) => r.symbol == "${symbol}")
              |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
              |> limit(n: 100)
          `;
          
          const sampleRows = await queryApi.collectRows(lastResortQuery);
          
          const sampleData = sampleRows
            .filter(row => row.open !== undefined && row.high !== undefined && 
                    row.low !== undefined && row.close !== undefined)
            .map(row => ({
              time: new Date(row._time).getTime(),
              open: row.open,
              high: row.high,
              low: row.low,
              close: row.close,
              volume: row.volume || 0
            }))
            .sort((a, b) => a.time - b.time);
          
          console.log(`Generated ${sampleData.length} sample OHLC candles as last resort`);
          return res.json(sampleData);
        } catch (lastResortError) {
          console.error('Error in last resort query:', lastResortError);
          return res.status(500).json({ 
            error: `Failed to generate OHLC data: The database contains too much data for the requested time range. Please use a much smaller date range or a larger resolution.` 
          });
        }
      }
    }
  } catch (error) {
    console.error('Error fetching OHLC data:', error);
    return res.status(500).json({ error: `Failed to fetch OHLC data: ${error.message}` });
  }
};

// Helper function to convert resolution string to milliseconds
function parseResolutionToMs(resolution) {
  // Handle special case for month (MO) to avoid confusion with minutes (M)
  if (resolution.endsWith('MO')) {
    const value = parseInt(resolution.slice(0, -2));
    return value * 30 * 24 * 60 * 60 * 1000; // Approximate month as 30 days
  }

  const unit = resolution.slice(-1);
  const value = parseInt(resolution.slice(0, -1));

  switch (unit) {
    case 'S': // Seconds
    case 's':
      return value * 1000;
    case 'M': // Minutes
    case 'm':
      return value * 60 * 1000;
    case 'H': // Hours
    case 'h':
      return value * 60 * 60 * 1000;
    case 'D': // Days
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    case 'W': // Weeks
    case 'w':
      return value * 7 * 24 * 60 * 60 * 1000;
    case 'O': // Months (if using 'MO' format but only 'O' is the last character)
      console.log('Warning: Unexpected resolution format. Use "MO" for months.');
      return value * 30 * 24 * 60 * 60 * 1000;
    default:
      // If no unit specified, assume minutes
      return parseInt(resolution) * 60 * 1000;
  }
}

// Get available symbols
const getSymbols = (req, res) => {
  // For this POC, we'll just return our predefined symbols
  const symbols = [
    {
      symbol: 'BTCUSD',
      description: 'BTC/USD',
      exchange: 'InfluxDB',
      type: 'crypto'
    },
    {
      symbol: 'ETHUSD',
      description: 'ETH/USD',
      exchange: 'InfluxDB',
      type: 'crypto'
    },
    {
      symbol: 'LTCUSD',
      description: 'LTC/USD',
      exchange: 'InfluxDB',
      type: 'crypto'
    }
  ];
  
  res.json(symbols);
};

module.exports = {
  getTrades,
  createTrade,
  generateFakeTrades,
  getOHLC,
  getSymbols
};
