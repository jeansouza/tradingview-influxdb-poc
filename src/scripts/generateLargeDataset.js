require('dotenv').config();
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const readline = require('readline');

/**
 * This script generates a large dataset for performance testing.
 * It creates multiple batches of trade data across different symbols and time periods.
 * 
 * Usage:
 * node src/scripts/generateLargeDataset.js [--count=50000000] [--symbols=BTCUSD,ETHUSD,LTCUSD] [--years=2]
 * 
 * Options:
 * --count: Total number of trades to generate (default: 50000000)
 * --symbols: Comma-separated list of symbols (default: BTCUSD,ETHUSD,LTCUSD)
 * --years: Number of years of data to generate (default: 2)
 * --batch-size: Batch size for writing trades (default: 100000)
 * --confirm: Skip confirmation prompt (default: false)
 * 
 * Note: This script requires high memory. Run with:
 * node --max-old-space-size=8192 src/scripts/generateLargeDataset.js
 */

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.split('=');
  if (key && value) {
    acc[key.replace(/^--/, '')] = value;
  } else if (key === '--confirm') {
    acc.confirm = true;
  }
  return acc;
}, {});

// Configuration
const config = {
  totalCount: parseInt(args.count || '50000000', 10),
  symbols: (args.symbols || 'BTCUSD,ETHUSD,LTCUSD').split(','),
  years: parseInt(args.years || '2', 10),
  batchSize: parseInt(args['batch-size'] || '100000', 10),
  skipConfirmation: args.confirm || false,
  influxdb: {
    url: process.env.INFLUXDB_URL,
    token: process.env.INFLUXDB_TOKEN,
    org: process.env.INFLUXDB_ORG,
    bucket: process.env.INFLUXDB_BUCKET
  }
};

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Main function
async function generateLargeDataset() {
  console.log('=== TradingView InfluxDB POC - Large Dataset Generator ===\n');
  
  // Validate configuration
  if (!config.influxdb.url || !config.influxdb.token || 
      !config.influxdb.org || !config.influxdb.bucket) {
    console.error('Error: Missing InfluxDB configuration. Please check your .env file.');
    process.exit(1);
  }
  
  console.log('Configuration:');
  console.log(`- Total trades to generate: ${config.totalCount.toLocaleString()}`);
  console.log(`- Symbols: ${config.symbols.join(', ')}`);
  console.log(`- Years of data: ${config.years}`);
  console.log(`- Batch size: ${config.batchSize.toLocaleString()}`);
  console.log(`- InfluxDB URL: ${config.influxdb.url}`);
  console.log(`- InfluxDB Bucket: ${config.influxdb.bucket}`);
  console.log();
  
  // Calculate trades per symbol
  const tradesPerSymbol = Math.floor(config.totalCount / config.symbols.length);
  console.log(`Generating approximately ${tradesPerSymbol.toLocaleString()} trades per symbol.`);
  
  // Calculate time range
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setFullYear(startDate.getFullYear() - config.years);
  
  console.log(`Time range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  console.log(`Total time span: ${config.years} years (${config.years * 365} days)`);
  
  // Calculate average trades per day
  const totalDays = config.years * 365;
  const tradesPerDay = Math.floor(config.totalCount / totalDays);
  console.log(`Average trades per day: ${tradesPerDay.toLocaleString()}`);
  console.log(`Average trades per day per symbol: ${Math.floor(tradesPerDay / config.symbols.length).toLocaleString()}`);
  
  // Calculate estimated time
  const estimatedTimeMs = config.totalCount * 0.1; // Rough estimate: 0.1ms per trade
  const estimatedTimeMinutes = Math.ceil(estimatedTimeMs / 1000 / 60);
  console.log(`Estimated time to complete: ~${estimatedTimeMinutes} minutes`);
  
  // Calculate memory usage
  const estimatedMemoryMB = Math.ceil((config.batchSize * 200) / (1024 * 1024)); // Rough estimate: 200 bytes per trade
  console.log(`Estimated peak memory usage: ~${estimatedMemoryMB}MB per batch`);
  
  // Warn about potential issues
  if (config.totalCount > 100000000) {
    console.log('\n⚠️ Warning: Generating more than 100M trades may take a very long time and require significant resources.');
  }
  
  if (config.batchSize > 500000) {
    console.log('\n⚠️ Warning: Large batch sizes may cause memory issues. Consider reducing the batch size.');
  }
  
  // Confirm with user
  if (!config.skipConfirmation) {
    await new Promise((resolve) => {
      rl.question('\nThis will generate a large amount of data. Continue? (y/n) ', (answer) => {
        if (answer.toLowerCase() !== 'y') {
          console.log('Operation cancelled.');
          process.exit(0);
        }
        resolve();
      });
    });
  }
  
  // Create InfluxDB client
  const influxDB = new InfluxDB({
    url: config.influxdb.url,
    token: config.influxdb.token
  });
  
  // Check if we already have data
  const queryApi = influxDB.getQueryApi(config.influxdb.org);
  
  try {
    console.log('\nChecking existing data...');
    
    const tradeCountQuery = `
      from(bucket: "${config.influxdb.bucket}")
        |> range(start: 0)
        |> filter(fn: (r) => r._measurement == "trade")
        |> count()
        |> yield(name: "count")
    `;
    
    const tradeCountResult = await queryApi.collectRows(tradeCountQuery);
    
    if (tradeCountResult.length > 0 && tradeCountResult[0]._value > 0) {
      const existingCount = tradeCountResult[0]._value;
      console.log(`Found ${existingCount.toLocaleString()} existing trade records.`);
      
      if (existingCount > 1000000) {
        await new Promise((resolve) => {
          rl.question(`You already have ${existingCount.toLocaleString()} trades. Do you want to add more? (y/n) `, (answer) => {
            if (answer.toLowerCase() !== 'y') {
              console.log('Operation cancelled.');
              process.exit(0);
            }
            resolve();
          });
        });
      }
    } else {
      console.log('No existing trade data found.');
    }
  } catch (error) {
    console.error('Error checking existing data:', error.message);
  }
  
  // Start generating data
  console.log('\nGenerating data...');
  
  // Track progress
  const startTime = Date.now();
  let totalGenerated = 0;
  
  // Generate data for each symbol
  for (const symbol of config.symbols) {
    console.log(`\nGenerating data for ${symbol}...`);
    
    // Get the latest trade timestamp for the symbol if it exists
    let latestTimestamp = null;
    try {
      const latestTradeQuery = `
        from(bucket: "${config.influxdb.bucket}")
          |> range(start: 0)
          |> filter(fn: (r) => r._measurement == "trade")
          |> filter(fn: (r) => r.symbol == "${symbol}")
          |> filter(fn: (r) => r._field == "price")
          |> last()
      `;
      
      const latestTradeResult = await queryApi.collectRows(latestTradeQuery);
      
      if (latestTradeResult.length > 0) {
        latestTimestamp = new Date(latestTradeResult[0]._time);
        console.log(`Found latest trade for ${symbol} at ${latestTimestamp.toISOString()}`);
      }
    } catch (error) {
      console.error(`Error getting latest trade for ${symbol}:`, error.message);
    }
    
    // Set the start timestamp based on latest trade or default start date
    const symbolStartDate = latestTimestamp || startDate;
    const symbolEndDate = endDate;
    
    // Calculate the time range for this symbol
    const timeRangeMs = symbolEndDate.getTime() - symbolStartDate.getTime();
    
    // Calculate trades to generate for this symbol
    const symbolTotalTrades = Math.floor(tradesPerSymbol);
    
    // Calculate the time interval between trades
    const timeInterval = Math.max(1000, Math.floor(timeRangeMs / symbolTotalTrades)); // At least 1 second
    
    console.log(`Generating ${symbolTotalTrades.toLocaleString()} trades for ${symbol}`);
    console.log(`Time range: ${symbolStartDate.toISOString()} to ${symbolEndDate.toISOString()}`);
    console.log(`Average time between trades: ${timeInterval}ms`);
    
    // Generate trades in batches
    let symbolGenerated = 0;
    let lastPrice = 30000 + (Math.random() * 10000); // Random starting price around 30-40k
    
    // Base price to calculate the allowed range (30% variation)
    const basePrice = lastPrice;
    const minPrice = basePrice * 0.85; // 15% below base price
    const maxPrice = basePrice * 1.15; // 15% above base price
    
    // Maximum percentage change per trade (0.5% = 0.005)
    const maxPercentChange = 0.005;
    
    while (symbolGenerated < symbolTotalTrades) {
      // Calculate batch size for this iteration
      const batchSize = Math.min(config.batchSize, symbolTotalTrades - symbolGenerated);
      
      console.log(`Processing batch of ${batchSize.toLocaleString()} trades (${symbolGenerated.toLocaleString()} to ${(symbolGenerated + batchSize).toLocaleString()})`);
      
      // Create a dedicated write API for this batch
      const writeApi = influxDB.getWriteApi(config.influxdb.org, config.influxdb.bucket, 'ns', {
        defaultTags: { source: 'tradingview-poc' },
        maxRetries: 15,
        retryJitter: 500,
        minRetryDelay: 1000,
        maxRetryDelay: 20000,
        exponentialBase: 2,
        maxRetryTime: 600000, // 10 minutes
        maxBufferLines: 10000,
        flushInterval: 5000 // 5 seconds
      });
      
      // Generate batch of trades
      const batchStartTime = Date.now();
      
      for (let i = 0; i < batchSize; i++) {
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
        
        // Timestamp with interval progression
        const timestamp = new Date(symbolStartDate.getTime() + (symbolGenerated + i) * timeInterval);
        
        // Create point
        const point = new Point('trade')
          .tag('symbol', symbol)
          .tag('side', side)
          .floatField('price', currentPrice)
          .floatField('amount', amount)
          .timestamp(timestamp);
        
        // Write point
        writeApi.writePoint(point);
      }
      
      try {
        // Flush and close the write API
        await writeApi.flush();
        await writeApi.close();
        
        const batchEndTime = Date.now();
        const batchDuration = batchEndTime - batchStartTime;
        
        symbolGenerated += batchSize;
        totalGenerated += batchSize;
        
        const percentComplete = (totalGenerated / config.totalCount) * 100;
        const elapsedSeconds = (Date.now() - startTime) / 1000;
        const tradesPerSecond = Math.floor(totalGenerated / elapsedSeconds);
        
        console.log(`Batch completed in ${batchDuration}ms (${tradesPerSecond.toLocaleString()} trades/sec)`);
        console.log(`Progress: ${totalGenerated.toLocaleString()} / ${config.totalCount.toLocaleString()} trades (${percentComplete.toFixed(2)}%)`);
        
        // Estimate remaining time
        const remainingTrades = config.totalCount - totalGenerated;
        const estimatedRemainingSeconds = remainingTrades / tradesPerSecond;
        const estimatedRemainingMinutes = Math.ceil(estimatedRemainingSeconds / 60);
        
        console.log(`Estimated time remaining: ~${estimatedRemainingMinutes} minutes`);
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      } catch (error) {
        console.error('Error writing batch:', error.message);
        
        // Try to close the write API even if there's an error
        try {
          await writeApi.close();
        } catch (closeError) {
          console.error('Error closing write API:', closeError.message);
        }
      }
    }
    
    console.log(`Completed generating ${symbolGenerated.toLocaleString()} trades for ${symbol}`);
  }
  
  const endTime = Date.now();
  const totalDuration = (endTime - startTime) / 1000;
  const finalTradesPerSecond = Math.floor(totalGenerated / totalDuration);
  
  console.log(`\nData generation completed!`);
  console.log(`Generated ${totalGenerated.toLocaleString()} trades in ${totalDuration.toFixed(2)} seconds`);
  console.log(`Average speed: ${finalTradesPerSecond.toLocaleString()} trades/sec`);
  
  // Suggest next steps
  console.log('\nNext steps:');
  console.log('1. Run the downsampling tasks to create OHLC data:');
  console.log('   node src/scripts/runDownsamplingTask.js all');
  console.log('2. Run the benchmark script to test performance:');
  console.log('   node src/scripts/benchmarkPerformance.js');
  
  rl.close();
}

// Execute the main function
generateLargeDataset()
  .then(() => console.log('\nLarge dataset generation completed.'))
  .catch(error => {
    console.error('Error generating large dataset:', error);
    rl.close();
    process.exit(1);
  });
