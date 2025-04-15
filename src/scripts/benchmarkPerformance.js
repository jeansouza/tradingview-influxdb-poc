require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');
const fs = require('fs');
const path = require('path');

/**
 * This script performs comprehensive performance benchmarking for the TradingView InfluxDB POC.
 * It tests query performance across different resolutions and date ranges,
 * and generates a detailed report of the results.
 * 
 * Usage:
 * node src/scripts/benchmarkPerformance.js [--output=results.json] [--runs=3] [--symbol=BTCUSD]
 * 
 * Options:
 * --output: Output file for the benchmark results (default: benchmark-results.json)
 * --runs: Number of runs for each test to get average performance (default: 3)
 * --symbol: Symbol to use for testing (default: BTCUSD)
 */

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.split('=');
  if (key && value) {
    acc[key.replace(/^--/, '')] = value;
  }
  return acc;
}, {});

// Configuration
const config = {
  outputFile: args.output || 'benchmark-results.json',
  runs: parseInt(args.runs || '3', 10),
  symbol: args.symbol || 'BTCUSD',
  influxdb: {
    url: process.env.INFLUXDB_URL,
    token: process.env.INFLUXDB_TOKEN,
    org: process.env.INFLUXDB_ORG,
    bucket: process.env.INFLUXDB_BUCKET
  }
};

// Test scenarios
const scenarios = [
  // Different resolutions with fixed date range (1 week)
  { name: '1m resolution - 1 week', resolution: '1m', days: 7 },
  { name: '5m resolution - 1 week', resolution: '5m', days: 7 },
  { name: '15m resolution - 1 week', resolution: '15m', days: 7 },
  { name: '1h resolution - 1 week', resolution: '1h', days: 7 },
  { name: '4h resolution - 1 week', resolution: '4h', days: 7 },
  { name: '1d resolution - 1 week', resolution: '1d', days: 7 },
  
  // Fixed resolution (1h) with different date ranges
  { name: '1h resolution - 1 day', resolution: '1h', days: 1 },
  { name: '1h resolution - 1 month', resolution: '1h', days: 30 },
  { name: '1h resolution - 3 months', resolution: '1h', days: 90 },
  { name: '1h resolution - 6 months', resolution: '1h', days: 180 },
  { name: '1h resolution - 1 year', resolution: '1h', days: 365 },
  
  // Edge cases
  { name: '1m resolution - 1 month', resolution: '1m', days: 30 },
  { name: '1d resolution - 1 year', resolution: '1d', days: 365 }
];

// Main benchmark function
async function runBenchmark() {
  console.log('=== TradingView InfluxDB POC - Performance Benchmark ===\n');
  
  // Validate configuration
  if (!config.influxdb.url || !config.influxdb.token || 
      !config.influxdb.org || !config.influxdb.bucket) {
    console.error('Error: Missing InfluxDB configuration. Please check your .env file.');
    process.exit(1);
  }
  
  console.log('Configuration:');
  console.log(`- Symbol: ${config.symbol}`);
  console.log(`- Runs per test: ${config.runs}`);
  console.log(`- Output file: ${config.outputFile}`);
  console.log(`- InfluxDB URL: ${config.influxdb.url}`);
  console.log(`- InfluxDB Bucket: ${config.influxdb.bucket}`);
  console.log();
  
  // Create InfluxDB client
  const influxDB = new InfluxDB({
    url: config.influxdb.url,
    token: config.influxdb.token
  });
  
  // Create Query API
  const queryApi = influxDB.getQueryApi(config.influxdb.org);
  
  // Check if we have data
  try {
    console.log('Checking data availability...');
    
    // Check for raw trade data
    const tradeCountQuery = `
      from(bucket: "${config.influxdb.bucket}")
        |> range(start: 0)
        |> filter(fn: (r) => r._measurement == "trade")
        |> filter(fn: (r) => r.symbol == "${config.symbol}")
        |> count()
        |> yield(name: "count")
    `;
    
    const tradeCountResult = await queryApi.collectRows(tradeCountQuery);
    
    if (tradeCountResult.length === 0 || tradeCountResult[0]._value === 0) {
      console.error('Error: No trade data found for symbol', config.symbol);
      console.log('Please generate test data first using:');
      console.log(`curl "http://localhost:3000/api/trades/generate?symbol=${config.symbol}&count=1000000"`);
      process.exit(1);
    }
    
    const tradeCount = tradeCountResult[0]._value;
    console.log(`Found ${tradeCount.toLocaleString()} trades for ${config.symbol}`);
    
    // Check for downsampled data
    let hasDownsampledData = false;
    for (const resolution of ['1m', '5m', '15m', '1h', '4h', '1d']) {
      const downsampledCountQuery = `
        from(bucket: "${config.influxdb.bucket}")
          |> range(start: 0)
          |> filter(fn: (r) => r._measurement == "trade_ohlc_${resolution}")
          |> filter(fn: (r) => r.symbol == "${config.symbol}")
          |> count()
          |> yield(name: "count")
      `;
      
      const downsampledCountResult = await queryApi.collectRows(downsampledCountQuery);
      
      if (downsampledCountResult.length > 0 && downsampledCountResult[0]._value > 0) {
        hasDownsampledData = true;
        break;
      }
    }
    
    if (!hasDownsampledData) {
      console.error('Error: No downsampled data found.');
      console.log('Please run the downsampling tasks first:');
      console.log('node src/scripts/runDownsamplingTask.js all');
      process.exit(1);
    }
    
    console.log('Downsampled data is available.');
    
    // Get the time range of available data
    const timeRangeQuery = `
      from(bucket: "${config.influxdb.bucket}")
        |> range(start: 0)
        |> filter(fn: (r) => r._measurement == "trade")
        |> filter(fn: (r) => r.symbol == "${config.symbol}")
        |> first()
        |> yield(name: "first")
        
      from(bucket: "${config.influxdb.bucket}")
        |> range(start: 0)
        |> filter(fn: (r) => r._measurement == "trade")
        |> filter(fn: (r) => r.symbol == "${config.symbol}")
        |> last()
        |> yield(name: "last")
    `;
    
    const timeRangeResult = await queryApi.collectRows(timeRangeQuery);
    
    let firstTime = null;
    let lastTime = null;
    
    for (const row of timeRangeResult) {
      if (row.result === 'first') {
        firstTime = new Date(row._time);
      } else if (row.result === 'last') {
        lastTime = new Date(row._time);
      }
    }
    
    if (firstTime && lastTime) {
      const daysDiff = Math.floor((lastTime - firstTime) / (1000 * 60 * 60 * 24));
      console.log(`Data spans ${daysDiff} days (${firstTime.toISOString()} to ${lastTime.toISOString()})`);
      
      if (daysDiff < 365) {
        console.log(`⚠️ Warning: Data spans less than a year. Some benchmark scenarios may not have enough data.`);
      }
    }
  } catch (error) {
    console.error('Error checking data availability:', error.message);
    process.exit(1);
  }
  
  // Run the benchmark tests
  console.log('\nRunning benchmark tests...');
  
  const results = [];
  
  for (const scenario of scenarios) {
    console.log(`\nScenario: ${scenario.name}`);
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - scenario.days);
    
    console.log(`- Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    console.log(`- Resolution: ${scenario.resolution}`);
    
    // Run multiple times to get average
    const runResults = [];
    
    for (let run = 1; run <= config.runs; run++) {
      console.log(`  Run ${run}/${config.runs}...`);
      
      try {
        const startTime = Date.now();
        
        // Create the URL with the query parameters (similar to what the frontend would do)
        const url = new URL('/api/trades/ohlc', 'http://localhost');
        url.searchParams.append('symbol', config.symbol);
        url.searchParams.append('resolution', scenario.resolution);
        url.searchParams.append('start', startDate.toISOString());
        url.searchParams.append('end', endDate.toISOString());
        
        // Build the query based on the controller logic
        const downsampledResolution = getDownsampledResolution(scenario.resolution);
        
        // Determine if we need to force a larger resolution based on date range
        const dateRangeDays = scenario.days;
        let finalResolution = downsampledResolution;
        
        if (dateRangeDays > 365 && downsampledResolution !== '1d') {
          finalResolution = '1d';
        } else if (dateRangeDays > 90 && ['1m', '5m'].includes(downsampledResolution)) {
          finalResolution = '1h';
        } else if (dateRangeDays > 30 && downsampledResolution === '1m') {
          finalResolution = '15m';
        }
        
        // Build the query
        const query = `
          from(bucket: "${config.influxdb.bucket}")
            |> range(start: ${startDate.toISOString()}, stop: ${endDate.toISOString()})
            |> filter(fn: (r) => r._measurement == "trade_ohlc_${finalResolution}")
            |> filter(fn: (r) => r.symbol == "${config.symbol}")
            |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
        `;
        
        // Execute the query
        const rows = await queryApi.collectRows(query);
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        runResults.push({
          run,
          duration,
          rowCount: rows.length,
          resolution: scenario.resolution,
          downsampledResolution: finalResolution,
          dateRangeDays: scenario.days
        });
        
        console.log(`  ✅ Query returned ${rows.length} rows in ${duration}ms`);
      } catch (error) {
        console.error(`  ❌ Error executing query:`, error.message);
        
        runResults.push({
          run,
          duration: null,
          rowCount: 0,
          resolution: scenario.resolution,
          downsampledResolution: getDownsampledResolution(scenario.resolution),
          dateRangeDays: scenario.days,
          error: error.message
        });
      }
    }
    
    // Calculate average duration
    const successfulRuns = runResults.filter(r => r.duration !== null);
    const avgDuration = successfulRuns.length > 0
      ? successfulRuns.reduce((sum, r) => sum + r.duration, 0) / successfulRuns.length
      : null;
    
    // Add to results
    results.push({
      scenario: scenario.name,
      resolution: scenario.resolution,
      dateRangeDays: scenario.days,
      avgDuration,
      runs: runResults,
      success: successfulRuns.length === config.runs
    });
    
    if (avgDuration !== null) {
      console.log(`✅ Average duration: ${avgDuration.toFixed(2)}ms`);
    } else {
      console.log(`❌ All runs failed`);
    }
  }
  
  // Generate report
  const report = {
    timestamp: new Date().toISOString(),
    config: {
      symbol: config.symbol,
      runs: config.runs,
      influxdb: {
        url: config.influxdb.url,
        bucket: config.influxdb.bucket
      }
    },
    results
  };
  
  // Save report to file
  fs.writeFileSync(config.outputFile, JSON.stringify(report, null, 2));
  console.log(`\nBenchmark results saved to ${config.outputFile}`);
  
  // Print summary
  console.log('\n=== Benchmark Summary ===');
  console.log('Resolution performance (1 week date range):');
  
  const resolutionResults = results.filter(r => r.dateRangeDays === 7);
  resolutionResults.sort((a, b) => (a.avgDuration || Infinity) - (b.avgDuration || Infinity));
  
  for (const result of resolutionResults) {
    if (result.avgDuration !== null) {
      console.log(`- ${result.resolution}: ${result.avgDuration.toFixed(2)}ms`);
    } else {
      console.log(`- ${result.resolution}: Failed`);
    }
  }
  
  console.log('\nDate range performance (1h resolution):');
  
  const dateRangeResults = results.filter(r => r.resolution === '1h');
  dateRangeResults.sort((a, b) => a.dateRangeDays - b.dateRangeDays);
  
  for (const result of dateRangeResults) {
    if (result.avgDuration !== null) {
      console.log(`- ${result.dateRangeDays} days: ${result.avgDuration.toFixed(2)}ms`);
    } else {
      console.log(`- ${result.dateRangeDays} days: Failed`);
    }
  }
  
  console.log('\nRecommendations:');
  
  // Find the fastest resolution
  const fastestResolution = resolutionResults.find(r => r.avgDuration !== null);
  if (fastestResolution) {
    console.log(`- Fastest resolution: ${fastestResolution.resolution} (${fastestResolution.avgDuration.toFixed(2)}ms)`);
  }
  
  // Find any failed scenarios
  const failedScenarios = results.filter(r => !r.success);
  if (failedScenarios.length > 0) {
    console.log(`- ${failedScenarios.length} scenarios failed. Check the results file for details.`);
  }
  
  // Check for performance degradation with larger date ranges
  const smallDateRange = dateRangeResults.find(r => r.dateRangeDays === 1);
  const largeDateRange = dateRangeResults.find(r => r.dateRangeDays === 365);
  
  if (smallDateRange && largeDateRange && smallDateRange.avgDuration !== null && largeDateRange.avgDuration !== null) {
    const ratio = largeDateRange.avgDuration / smallDateRange.avgDuration;
    console.log(`- Performance ratio (1 year vs 1 day): ${ratio.toFixed(2)}x`);
    
    if (ratio > 10) {
      console.log('  ⚠️ Significant performance degradation with larger date ranges.');
      console.log('  Consider optimizing queries for large date ranges or implementing caching.');
    } else {
      console.log('  ✅ Good scaling with larger date ranges.');
    }
  }
}

// Helper function to convert resolution to InfluxDB format (simplified version from tradeController.js)
function getDownsampledResolution(resolution) {
  // Normalize the resolution string to lowercase for consistent processing
  const normalizedResolution = resolution.toString().toLowerCase();
  
  // Core mapping of standard resolutions to their downsampled equivalents
  const coreMapping = {
    // Minutes
    '1': '1m',
    '5': '5m',
    '15': '15m',
    '30': '15m', // Use 15m for 30m requests
    
    // Hours
    '60': '1h',
    '120': '1h', // Use 1h for 2h requests
    '240': '4h',
    '360': '4h', // Use 4h for 6h requests
    '720': '4h', // Use 4h for 12h requests
    
    // Days
    'd': '1d',
    
    // Letter formats
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '15m',
    '1h': '1h',
    '2h': '1h',
    '4h': '4h',
    '1d': '1d'
  };
  
  return coreMapping[normalizedResolution] || '5m';
}

// Execute the benchmark function
runBenchmark()
  .then(() => console.log('\nBenchmark completed.'))
  .catch(error => console.error('Error during benchmark:', error));
