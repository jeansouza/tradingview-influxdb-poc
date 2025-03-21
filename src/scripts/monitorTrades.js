require('dotenv').config();
const { InfluxDB, flux } = require('@influxdata/influxdb-client');

async function checkTradeProgress() {
  const { url, token, org, bucket } = {
    url: process.env.INFLUXDB_URL,
    token: process.env.INFLUXDB_TOKEN,
    org: process.env.INFLUXDB_ORG,
    bucket: process.env.INFLUXDB_BUCKET
  };

  // Create InfluxDB client
  const influxDB = new InfluxDB({ url, token });
  const queryApi = influxDB.getQueryApi(org);
  
  // Query to count trades
  const countQuery = flux`
    from(bucket: "${bucket}")
      |> range(start: 2022-01-01T00:00:00Z)
      |> filter(fn: (r) => r._measurement == "trade")
      |> count()
      |> yield(name: "count")
  `;
  
  // Query to get the latest trade timestamp
  const latestQuery = flux`
    from(bucket: "${bucket}")
      |> range(start: 2022-01-01T00:00:00Z)
      |> filter(fn: (r) => r._measurement == "trade")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: 1)
  `;
  
  // Query to get the first trade timestamp
  const firstQuery = flux`
    from(bucket: "${bucket}")
      |> range(start: 2022-01-01T00:00:00Z)
      |> filter(fn: (r) => r._measurement == "trade")
      |> sort(columns: ["_time"], desc: false)
      |> limit(n: 1)
  `;
  
  try {
    // Get total count
    const countResult = await queryApi.collectRows(countQuery);
    let totalTrades = 0;
    
    if (countResult.length > 0) {
      totalTrades = countResult[0]._value;
      console.log(`Total trades in database: ${totalTrades.toLocaleString()}`);
    } else {
      console.log('No trades found in the database.');
      return;
    }
    
    // Get latest trade timestamp
    const latestResult = await queryApi.collectRows(latestQuery);
    if (latestResult.length > 0) {
      const latestTime = new Date(latestResult[0]._time);
      console.log(`Latest trade timestamp: ${latestTime.toISOString()}`);
    }
    
    // Get first trade timestamp
    const firstResult = await queryApi.collectRows(firstQuery);
    if (firstResult.length > 0) {
      const firstTime = new Date(firstResult[0]._time);
      console.log(`First trade timestamp: ${firstTime.toISOString()}`);
    }
    
    // Calculate progress based on timestamps
    if (latestResult.length > 0 && firstResult.length > 0) {
      const firstTime = new Date(firstResult[0]._time);
      const latestTime = new Date(latestResult[0]._time);
      const startTime = new Date('2022-01-01T00:00:00Z');
      
      // Calculate total time range (from 2022-01-01 to now)
      const totalTimeRange = 400000000 * 2000; // 400M trades * 2 seconds per trade in milliseconds
      const endTime = new Date(startTime.getTime() + totalTimeRange);
      
      // Calculate progress
      const elapsedTime = latestTime.getTime() - startTime.getTime();
      const progressPercent = (elapsedTime / totalTimeRange) * 100;
      
      console.log(`Progress: ${progressPercent.toFixed(2)}% (based on timestamps)`);
      console.log(`Expected completion time: ${endTime.toISOString()}`);
      
      // Calculate trades per second
      const tradeTimeRange = latestTime.getTime() - firstTime.getTime();
      const tradesPerSecond = (totalTrades / (tradeTimeRange / 1000)).toFixed(2);
      console.log(`Generation rate: ${tradesPerSecond} trades per second`);
      
      // Estimate time remaining
      const remainingTrades = 400000000 - totalTrades;
      const secondsRemaining = remainingTrades / tradesPerSecond;
      const estimatedCompletion = new Date(Date.now() + (secondsRemaining * 1000));
      console.log(`Estimated completion time: ${estimatedCompletion.toISOString()}`);
    }
  } catch (error) {
    console.error('Error checking trade progress:', error);
  }
}

// Run the check every 10 seconds
console.log('Starting trade progress monitor...');
console.log('Press Ctrl+C to stop monitoring.');
console.log('-------------------------------------------');

// Run immediately
checkTradeProgress();

// Then run every 10 seconds
setInterval(checkTradeProgress, 10000);
