require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');

/**
 * This script checks the downsampled data in InfluxDB.
 * It verifies that the pre-aggregated OHLC data is being generated correctly.
 * 
 * Usage:
 * node src/scripts/checkDownsampledData.js [resolution]
 * 
 * If resolution is not provided, it will check all resolutions.
 * 
 * Examples:
 * node src/scripts/checkDownsampledData.js
 * node src/scripts/checkDownsampledData.js 1m
 */

async function checkDownsampledData() {
  // Get resolution from command line arguments
  const requestedResolution = process.argv[2];
  
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

  // Create InfluxDB client
  const influxDB = new InfluxDB({
    url: config.url,
    token: config.token
  });

  // Create Query API
  const queryApi = influxDB.getQueryApi(config.org);

  // Define resolutions to check
  const resolutions = requestedResolution 
    ? [requestedResolution] 
    : ['1m', '5m', '15m', '1h', '4h', '1d'];

  // Check each resolution
  for (const resolution of resolutions) {
    try {
      console.log(`\nChecking downsampled data for resolution: ${resolution}`);
      
      // Query to check if the measurement exists and count points
      const countQuery = `
        from(bucket: "${config.bucket}")
          |> range(start: 0)
          |> filter(fn: (r) => r._measurement == "trade_ohlc_${resolution}")
          |> group()
          |> count()
          |> yield(name: "count")
      `;
      
      console.log('Executing count query...');
      
      // Execute the query
      const countResult = await queryApi.collectRows(countQuery);
      
      if (countResult.length > 0 && countResult[0]._value > 0) {
        const count = countResult[0]._value;
        console.log(`✅ Found ${count.toLocaleString()} data points for resolution ${resolution}`);
        
        // Get the time range of the data
        const timeRangeQuery = `
          from(bucket: "${config.bucket}")
            |> range(start: 0)
            |> filter(fn: (r) => r._measurement == "trade_ohlc_${resolution}")
            |> filter(fn: (r) => r._field == "open")
            |> first()
            |> yield(name: "first")
            
          from(bucket: "${config.bucket}")
            |> range(start: 0)
            |> filter(fn: (r) => r._measurement == "trade_ohlc_${resolution}")
            |> filter(fn: (r) => r._field == "open")
            |> last()
            |> yield(name: "last")
        `;
        
        console.log('Getting time range...');
        
        // Execute the query
        const timeRangeResult = await queryApi.collectRows(timeRangeQuery);
        
        if (timeRangeResult.length >= 2) {
          // Find the first and last timestamps
          let firstTime, lastTime;
          
          for (const row of timeRangeResult) {
            if (row.result === 'first') {
              firstTime = new Date(row._time);
            } else if (row.result === 'last') {
              lastTime = new Date(row._time);
            }
          }
          
          if (firstTime && lastTime) {
            console.log(`   First data point: ${firstTime.toISOString()}`);
            console.log(`   Last data point:  ${lastTime.toISOString()}`);
            
            // Calculate time range
            const timeRangeMs = lastTime.getTime() - firstTime.getTime();
            const timeRangeDays = timeRangeMs / (24 * 60 * 60 * 1000);
            console.log(`   Time range: ${timeRangeDays.toFixed(2)} days`);
          }
        }
        
        // Get sample data
        const sampleQuery = `
          from(bucket: "${config.bucket}")
            |> range(start: 0)
            |> filter(fn: (r) => r._measurement == "trade_ohlc_${resolution}")
            |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
            |> limit(n: 5)
        `;
        
        console.log('Getting sample data...');
        
        // Execute the query
        const sampleResult = await queryApi.collectRows(sampleQuery);
        
        if (sampleResult.length > 0) {
          console.log('   Sample data:');
          sampleResult.forEach((row, index) => {
            console.log(`   ${index + 1}. Time: ${new Date(row._time).toISOString()}`);
            console.log(`      Symbol: ${row.symbol}`);
            console.log(`      OHLC: ${row.open.toFixed(2)} / ${row.high.toFixed(2)} / ${row.low.toFixed(2)} / ${row.close.toFixed(2)}`);
            console.log(`      Volume: ${row.volume ? row.volume.toFixed(4) : 'N/A'}`);
          });
        }
        
        // Get symbols
        const symbolsQuery = `
          from(bucket: "${config.bucket}")
            |> range(start: 0)
            |> filter(fn: (r) => r._measurement == "trade_ohlc_${resolution}")
            |> group(columns: ["symbol"])
            |> distinct(column: "symbol")
        `;
        
        console.log('Getting available symbols...');
        
        // Execute the query
        const symbolsResult = await queryApi.collectRows(symbolsQuery);
        
        if (symbolsResult.length > 0) {
          const symbols = symbolsResult.map(row => row._value);
          console.log(`   Available symbols: ${symbols.join(', ')}`);
        }
        
      } else {
        console.log(`❌ No data found for resolution ${resolution}`);
        
        // Check if the measurement exists
        const measurementQuery = `
          import "influxdata/influxdb/schema"
          
          schema.measurements(bucket: "${config.bucket}")
        `;
        
        console.log('Checking if measurement exists...');
        
        // Execute the query
        const measurementResult = await queryApi.collectRows(measurementQuery);
        
        const measurements = measurementResult.map(row => row._value);
        
        if (measurements.includes(`trade_ohlc_${resolution}`)) {
          console.log(`   Measurement 'trade_ohlc_${resolution}' exists but contains no data.`);
        } else {
          console.log(`   Measurement 'trade_ohlc_${resolution}' does not exist yet.`);
          console.log('   Run the downsampling tasks to create it:');
          console.log(`   node src/scripts/runDownsamplingTask.js Downsample_Trades_${resolution}`);
        }
      }
    } catch (error) {
      console.error(`Error checking resolution ${resolution}:`, error);
    }
  }
  
  // Check original trade data for comparison
  try {
    console.log('\nChecking original trade data for comparison:');
    
    // Query to count original trade data
    const tradeCountQuery = `
      from(bucket: "${config.bucket}")
        |> range(start: 0)
        |> filter(fn: (r) => r._measurement == "trade")
        |> filter(fn: (r) => r._field == "price")
        |> group()
        |> count()
        |> yield(name: "count")
    `;
    
    console.log('Executing trade count query...');
    
    // Execute the query
    const tradeCountResult = await queryApi.collectRows(tradeCountQuery);
    
    if (tradeCountResult.length > 0) {
      const count = tradeCountResult[0]._value;
      console.log(`✅ Found ${count.toLocaleString()} original trade data points`);
      
      // Get the time range of the data
      const timeRangeQuery = `
        from(bucket: "${config.bucket}")
          |> range(start: 0)
          |> filter(fn: (r) => r._measurement == "trade")
          |> filter(fn: (r) => r._field == "price")
          |> first()
          |> yield(name: "first")
          
        from(bucket: "${config.bucket}")
          |> range(start: 0)
          |> filter(fn: (r) => r._measurement == "trade")
          |> filter(fn: (r) => r._field == "price")
          |> last()
          |> yield(name: "last")
      `;
      
      console.log('Getting time range...');
      
      // Execute the query
      const timeRangeResult = await queryApi.collectRows(timeRangeQuery);
      
      if (timeRangeResult.length >= 2) {
        // Find the first and last timestamps
        let firstTime, lastTime;
        
        for (const row of timeRangeResult) {
          if (row.result === 'first') {
            firstTime = new Date(row._time);
          } else if (row.result === 'last') {
            lastTime = new Date(row._time);
          }
        }
        
        if (firstTime && lastTime) {
          console.log(`   First trade: ${firstTime.toISOString()}`);
          console.log(`   Last trade:  ${lastTime.toISOString()}`);
          
          // Calculate time range
          const timeRangeMs = lastTime.getTime() - firstTime.getTime();
          const timeRangeDays = timeRangeMs / (24 * 60 * 60 * 1000);
          console.log(`   Time range: ${timeRangeDays.toFixed(2)} days`);
        }
      }
      
      // Get symbols
      const symbolsQuery = `
        from(bucket: "${config.bucket}")
          |> range(start: 0)
          |> filter(fn: (r) => r._measurement == "trade")
          |> group(columns: ["symbol"])
          |> distinct(column: "symbol")
      `;
      
      console.log('Getting available symbols...');
      
      // Execute the query
      const symbolsResult = await queryApi.collectRows(symbolsQuery);
      
      if (symbolsResult.length > 0) {
        const symbols = symbolsResult.map(row => row._value);
        console.log(`   Available symbols: ${symbols.join(', ')}`);
      }
    } else {
      console.log('❌ No trade data found');
      console.log('   Generate some trade data first:');
      console.log('   curl "http://localhost:3000/api/trades/generate?symbol=BTCUSD&count=100000"');
    }
  } catch (error) {
    console.error('Error checking trade data:', error);
  }
  
  console.log('\nSummary:');
  console.log('1. If no downsampled data is found, run the setup script:');
  console.log('   node src/scripts/setupDownsamplingTasks.js');
  console.log('2. Then trigger the downsampling tasks to process data:');
  console.log('   node src/scripts/runDownsamplingTask.js all');
  console.log('   or for a specific resolution:');
  console.log('   node src/scripts/runDownsamplingTask.js Downsample_Trades_1m');
  console.log('3. To monitor progress, use the verification script:');
  console.log('   node src/scripts/verifyDownsamplingTasks.js');
  console.log('4. The tasks will process data in chunks and run incrementally');
  console.log('   until all historical data is processed.');
}

// Execute the check function
checkDownsampledData()
  .then(() => console.log('\nCheck completed.'))
  .catch(error => console.error('Error checking downsampled data:', error));
