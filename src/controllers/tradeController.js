const { influxDB, writeApi, queryApi, config } = require('../config/influxdb');
const { Point } = require('@influxdata/influxdb-client');

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

// Get OHLC data for charting
const getOHLC = async (req, res) => {
  try {
    const { symbol, start, end, resolution } = req.query;

    if (!symbol || !start || !end || !resolution) {
      return res.status(400).json({ error: 'Symbol, start, end, and resolution parameters are required' });
    }

    console.log(`Generating OHLC data for ${symbol} from ${start} to ${end} with resolution ${resolution}`);

    // Validate date range to prevent timeouts
    const startDate = new Date(start);
    const endDate = new Date(end);
    const timeRangeMs = endDate.getTime() - startDate.getTime();
    const maxRangeMs = 30 * 24 * 60 * 60 * 1000; // 30 days max
    
    if (timeRangeMs > maxRangeMs) {
      console.warn(`Date range too large (${timeRangeMs}ms). Limiting to ${maxRangeMs}ms.`);
      // Adjust the start date to limit the range
      const newStartDate = new Date(endDate.getTime() - maxRangeMs);
      console.log(`Adjusted start date from ${startDate.toISOString()} to ${newStartDate.toISOString()}`);
      startDate.setTime(newStartDate.getTime());
    }

    const resolutionMs = parseResolutionToMs(resolution);
    const windowPeriod = `${resolutionMs / 1000}s`;

    console.log(`Using window period: ${windowPeriod}`);

    try {
      // Set a timeout for the query
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Query timed out after 30 seconds')), 30000);
      });
      
      // Get trades using the queryTrades function with timeout
      const tradesPromise = queryTrades(symbol, startDate.toISOString(), endDate.toISOString());
      
      // Race the query against the timeout
      const trades = await Promise.race([tradesPromise, timeoutPromise]);
      
      console.log(`Retrieved ${trades.length} trades for OHLC calculation`);

      if (trades.length === 0) {
        return res.json([]);
      }

      // Group trades by time bucket based on resolution
      const ohlcMap = new Map();

      trades.forEach(trade => {
        const timestamp = new Date(trade.time).getTime();
        const bucketTime = Math.floor(timestamp / resolutionMs) * resolutionMs;

        if (!ohlcMap.has(bucketTime)) {
          ohlcMap.set(bucketTime, {
            time: bucketTime,
            open: trade.price,
            high: trade.price,
            low: trade.price,
            close: trade.price,
            volume: trade.amount || 0
          });
        } else {
          const candle = ohlcMap.get(bucketTime);
          candle.high = Math.max(candle.high, trade.price);
          candle.low = Math.min(candle.low, trade.price);
          candle.close = trade.price;
          candle.volume += (trade.amount || 0);
        }
      });

      // Convert map to array and sort by time
      const ohlcData = Array.from(ohlcMap.values()).sort((a, b) => a.time - b.time);

      console.log(`Generated ${ohlcData.length} OHLC candles`);
      return res.json(ohlcData);
    } catch (error) {
      console.error('Error generating OHLC data:', error);
      if (error.message === 'Query timed out after 30 seconds') {
        return res.status(504).json({ error: 'Query timed out. Try a smaller date range.' });
      }
      return res.status(500).json({ error: `Failed to generate OHLC data: ${error.message}` });
    }
  } catch (error) {
    console.error('Error fetching OHLC data:', error);
    return res.status(500).json({ error: `Failed to fetch OHLC data: ${error.message}` });
  }
};

// Helper function to convert resolution string to milliseconds
function parseResolutionToMs(resolution) {
  const unit = resolution.slice(-1);
  const value = parseInt(resolution.slice(0, -1));

  switch (unit) {
    case 'S': // Seconds
      return value * 1000;
    case 'M': // Minutes
      return value * 60 * 1000;
    case 'H': // Hours
      return value * 60 * 60 * 1000;
    case 'D': // Days
      return value * 24 * 60 * 60 * 1000;
    default:
      // If no unit specified, assume minutes
      return parseInt(resolution) * 60 * 1000;
  }
}

module.exports = {
  getTrades,
  createTrade,
  generateFakeTrades,
  getOHLC
};
