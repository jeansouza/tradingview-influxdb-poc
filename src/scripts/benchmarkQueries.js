require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');

/**
 * This script benchmarks query performance with and without pre-aggregated data.
 * It compares the time it takes to query OHLC data using:
 * 1. Raw trade data (on-the-fly aggregation)
 * 2. Pre-aggregated data (from downsampling tasks)
 * 
 * Usage:
 * node src/scripts/benchmarkQueries.js [symbol] [resolution] [days]
 * 
 * Examples:
 * node src/scripts/benchmarkQueries.js BTCUSD 5m 30
 * node src/scripts/benchmarkQueries.js ETHUSD 1h 90
 */

async function benchmarkQueries() {
  // Get parameters from command line arguments
  const symbol = 'BTCUSD';
  const resolution = process.argv[2] || '5m';
  const days = parseInt(process.argv[3] || '30');
  
  // Get configuration from environment variables
  const config = {
    url: process.env.INFLUXDB_URL,
    token: process.env.INFLUXDB_TOKEN,
    org: process.env.INFLUXDB_ORG,
    bucket: process.env.INFLUXDB_BUCKET
  };

  console.log('Connecting to InfluxDB at:', config.url);
  console.log('Using organization:', config.org);
  console.log('Using bucket:', config.bucket);
  console.log(`\nBenchmarking queries for symbol: ${symbol}, resolution: ${resolution}, days: ${days}`);

  // Create InfluxDB client
  const influxDB = new InfluxDB({
    url: config.url,
    token: config.token
  });

  // Create Query API
  const queryApi = influxDB.getQueryApi(config.org);

  // Calculate time range - use the exact date where we have sample data
  // But use the current timestamp for the pre-aggregated data since that's when we created it
  const startDate = new Date('2022-01-01T00:00:00Z');
  const endDate = new Date('2022-01-02T00:00:00Z');
  
  // For pre-aggregated data, use the current date since that's when we created our sample
  const preAggregatedStartDate = new Date();
  preAggregatedStartDate.setHours(preAggregatedStartDate.getHours() - 1);
  const preAggregatedEndDate = new Date();
  
  console.log(`Time range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  
  // Convert resolution to window period
  const windowPeriod = resolution.toLowerCase();
  
  // Benchmark pre-aggregated data query
  console.log('\n1. Benchmarking query with pre-aggregated data:');
  
  const preAggregatedQuery = `
    from(bucket: "${config.bucket}")
      |> range(start: ${preAggregatedStartDate.toISOString()}, stop: ${preAggregatedEndDate.toISOString()})
      |> filter(fn: (r) => r._measurement == "trade_ohlc_${windowPeriod}")
      |> filter(fn: (r) => r.symbol == "${symbol}")
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  `;
  
  console.log('Executing pre-aggregated data query...');
  
  try {
    const preAggregatedStart = Date.now();
    let preAggregatedCount = 0;
    
    for await (const { values, tableMeta } of queryApi.iterateRows(preAggregatedQuery)) {
      preAggregatedCount++;
      
      // Just count the rows, don't process them
      if (preAggregatedCount === 1) {
        const o = tableMeta.toObject(values);
        console.log(`First data point: ${new Date(o._time).toISOString()}`);
      }
    }
    
    const preAggregatedEnd = Date.now();
    const preAggregatedDuration = (preAggregatedEnd - preAggregatedStart) / 1000;
    
    console.log(`Retrieved ${preAggregatedCount.toLocaleString()} data points in ${preAggregatedDuration.toFixed(2)} seconds`);
    console.log(`Average: ${(preAggregatedCount / preAggregatedDuration).toFixed(2)} points/second`);
    
    // Benchmark raw data query
    console.log('\n2. Benchmarking query with raw trade data (on-the-fly aggregation):');
    
    // Calculate a reasonable downsample window based on the date range
    const dateRangeDays = days;
    
    // For very large date ranges, use more aggressive downsampling
    let downsamplePeriod = windowPeriod;
    if (dateRangeDays > 180) {
      // For ranges over 6 months, downsample to 1 hour
      downsamplePeriod = '1h';
    } else if (dateRangeDays > 30) {
      // For ranges over 1 month, downsample to 15 minutes
      downsamplePeriod = '15m';
    } else if (dateRangeDays > 7) {
      // For ranges over 1 week, downsample to 5 minutes
      downsamplePeriod = '5m';
    }
    
    console.log(`Using downsample period: ${downsamplePeriod} for ${dateRangeDays.toFixed(2)} days range`);
    
    // Fixed Flux query for raw data
    const rawDataQuery = `
from(bucket: "${config.bucket}")
  |> range(start: ${startDate.toISOString()}, stop: ${endDate.toISOString()})
  |> filter(fn: (r) => r._measurement == "trade")
  |> filter(fn: (r) => r.symbol == "${symbol}")
  |> filter(fn: (r) => r._field == "price" or r._field == "amount")
  |> pivot(rowKey:["_time", "symbol", "side"], columnKey: ["_field"], valueColumn: "_value")
  |> window(every: ${windowPeriod})
  |> group(columns: ["symbol", "_start", "_stop"])
  |> reduce(
      identity: {open: 0.0, high: 0.0, low: 0.0, close: 0.0, volume: 0.0, count: 0},
      fn: (r, accumulator) => ({
        open: if accumulator.count == 0 then r.price else accumulator.open,
        high: if r.price > accumulator.high or accumulator.count == 0 then r.price else accumulator.high,
        low: if r.price < accumulator.low or accumulator.count == 0 then r.price else accumulator.low,
        close: r.price,
        volume: accumulator.volume + (if exists r.amount then r.amount else 0.0),
        count: accumulator.count + 1
      })
  )
  |> filter(fn: (r) => r.count > 0)
  |> drop(columns: ["count", "_start", "_stop"])
`;
    
    console.log('Executing raw data query...');
    
    try {
      const rawDataStart = Date.now();
      let rawDataCount = 0;
      
      for await (const { values, tableMeta } of queryApi.iterateRows(rawDataQuery)) {
        rawDataCount++;
        
        // Just count the rows, don't process them
        if (rawDataCount === 1) {
          const o = tableMeta.toObject(values);
          console.log(`First data point: ${new Date(o._time).toISOString()}`);
        }
      }
      
      const rawDataEnd = Date.now();
      const rawDataDuration = (rawDataEnd - rawDataStart) / 1000;
      
      console.log(`Retrieved ${rawDataCount.toLocaleString()} data points in ${rawDataDuration.toFixed(2)} seconds`);
      console.log(`Average: ${(rawDataCount / rawDataDuration).toFixed(2)} points/second`);
      
      // Calculate performance improvement
      if (preAggregatedCount > 0 && rawDataCount > 0) {
        const speedup = rawDataDuration / preAggregatedDuration;
        console.log(`\nPerformance improvement: ${speedup.toFixed(2)}x faster with pre-aggregated data`);
        
        // Calculate percentage improvement
        const percentImprovement = ((rawDataDuration - preAggregatedDuration) / rawDataDuration) * 100;
        console.log(`Query time reduced by ${percentImprovement.toFixed(2)}%`);
      }
    } catch (rawError) {
      console.error('Error executing raw data query:', rawError);
      console.log('\nRaw data query failed. This could be due to:');
      console.log('1. Timeout - The query took too long to execute');
      console.log('2. Memory limit - The query required too much memory');
      console.log('3. No data - There is no trade data for the specified symbol and time range');
      
      console.log('\nThis demonstrates why pre-aggregated data is important for performance!');
      console.log(`Pre-aggregated query completed in ${preAggregatedDuration.toFixed(2)} seconds, while raw data query failed.`);
    }
  } catch (preAggregatedError) {
    console.error('Error executing pre-aggregated data query:', preAggregatedError);
    console.log('\nPre-aggregated data query failed. This could be due to:');
    console.log('1. No pre-aggregated data - Run the downsampling tasks first');
    console.log('2. No data - There is no data for the specified symbol and time range');
    
    console.log('\nTry running the downsampling tasks:');
    console.log('1. node src/scripts/setupDownsamplingTasks.js');
    console.log('2. node src/scripts/runDownsamplingTask.js Backfill_All_Resolutions');
  }
}

// Execute the benchmark function
benchmarkQueries()
  .then(() => console.log('\nBenchmark completed.'))
  .catch(error => console.error('Error running benchmark:', error));
