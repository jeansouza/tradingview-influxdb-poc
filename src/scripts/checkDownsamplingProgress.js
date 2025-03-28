require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');

/**
 * This script checks the progress of downsampling tasks.
 * It queries the downsampling_progress measurement to see how far each task has processed.
 * 
 * Usage:
 * node src/scripts/checkDownsamplingProgress.js
 */

async function checkDownsamplingProgress() {
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

  // Define resolutions for downsampling
  const resolutions = [
    { name: '1m', seconds: 60, flux: '1m', every: '5m', chunkDays: 1 },
    { name: '5m', seconds: 300, flux: '5m', every: '15m', chunkDays: 3 },
    { name: '15m', seconds: 900, flux: '15m', every: '30m', chunkDays: 7 },
    { name: '1h', seconds: 3600, flux: '1h', every: '1h', chunkDays: 14 },
    { name: '4h', seconds: 14400, flux: '4h', every: '4h', chunkDays: 30 },
    { name: '1d', seconds: 86400, flux: '1d', every: '6h', chunkDays: 90 }
  ];

  try {
    console.log('\nChecking downsampling progress...');

    // Query to get the latest progress for each resolution
    const progressQuery = `
      from(bucket: "${config.bucket}")
        |> range(start: 0)
        |> filter(fn: (r) => r._measurement == "downsampling_progress")
        |> filter(fn: (r) => r._field == "last_processed")
        |> group(columns: ["resolution"])
        |> last()
    `;
    
    // Execute the query
    const progressResult = await queryApi.collectRows(progressQuery);
    
    if (progressResult.length > 0) {
      console.log('\nProgress of downsampling tasks:');
      
      // Create a map of resolution to progress
      const progressMap = new Map();
      progressResult.forEach(row => {
        progressMap.set(row.resolution, {
          timestamp: row._value,
          recordTime: new Date(row._time).toISOString()
        });
      });
      
      // Display progress for each resolution
      for (const resolution of resolutions) {
        const progress = progressMap.get(resolution.name);
        if (progress) {
          console.log(`\n${resolution.name} resolution:`);
          console.log(`  - Last processed up to: ${progress.timestamp}`);
          console.log(`  - Progress recorded at: ${progress.recordTime}`);
          
          // Calculate how far behind real-time
          const lastProcessedTime = new Date(progress.timestamp);
          const now = new Date();
          const behindMs = now.getTime() - lastProcessedTime.getTime();
          const behindHours = behindMs / (1000 * 60 * 60);
          const behindDays = behindHours / 24;
          
          console.log(`  - Behind real-time: ${behindHours.toFixed(2)} hours (${behindDays.toFixed(2)} days)`);
          
          // Check if the task is keeping up
          if (behindHours < 1) {
            console.log(`  - Status: ✅ Up to date (less than 1 hour behind)`);
          } else if (behindHours < 24) {
            console.log(`  - Status: ⚠️ Slightly behind (${behindHours.toFixed(2)} hours)`);
          } else {
            console.log(`  - Status: ❌ Significantly behind (${behindDays.toFixed(2)} days)`);
          }
          
          // Calculate estimated completion time based on chunk size
          const chunkDays = resolution.chunkDays;
          const estimatedRuns = Math.ceil(behindDays / chunkDays);
          console.log(`  - Estimated runs needed to catch up: ${estimatedRuns}`);
          
          // Calculate estimated time to completion based on task frequency
          const taskFrequency = resolution.every.match(/(\d+)([mh])/);
          if (taskFrequency) {
            const freqValue = parseInt(taskFrequency[1]);
            const freqUnit = taskFrequency[2];
            let freqHours = freqValue / 60; // Default to minutes
            
            if (freqUnit === 'h') {
              freqHours = freqValue;
            }
            
            const estimatedHours = estimatedRuns * freqHours;
            console.log(`  - Estimated time to catch up: ${estimatedHours.toFixed(2)} hours`);
            
            if (estimatedHours < 24) {
              console.log(`  - Catch-up ETA: ${estimatedHours.toFixed(2)} hours`);
            } else {
              console.log(`  - Catch-up ETA: ${(estimatedHours / 24).toFixed(2)} days`);
            }
          }
        } else {
          console.log(`\n${resolution.name} resolution:`);
          console.log(`  - Status: ❓ No progress recorded yet`);
          console.log(`  - The task may not have run or completed a chunk yet.`);
          console.log(`  - Try running the task manually:`);
          console.log(`    node src/scripts/runDownsamplingTask.js Downsample_Trades_${resolution.name}`);
        }
      }
    } else {
      console.log('\nNo downsampling progress recorded yet.');
      console.log('The tasks may not have run or completed a chunk yet.');
      console.log('Try running the tasks manually:');
      console.log('node src/scripts/runDownsamplingTask.js all');
    }
    
    // Check if there's any trade data to process
    console.log('\nChecking trade data time range...');
    
    try {
      // Get the earliest and latest trade timestamps
      const tradeRangeQuery = `
        from(bucket: "${config.bucket}")
          |> range(start: 0)
          |> filter(fn: (r) => r._measurement == "trade")
          |> first()
          |> yield(name: "first")
          
        from(bucket: "${config.bucket}")
          |> range(start: 0)
          |> filter(fn: (r) => r._measurement == "trade")
          |> last()
          |> yield(name: "last")
      `;
      
      const tradeRangeResult = await queryApi.collectRows(tradeRangeQuery);
      
      let firstTradeTime = null;
      let lastTradeTime = null;
      
      for (const row of tradeRangeResult) {
        if (row.result === 'first') {
          firstTradeTime = new Date(row._time);
        } else if (row.result === 'last') {
          lastTradeTime = new Date(row._time);
        }
      }
      
      if (firstTradeTime && lastTradeTime) {
        console.log(`Trade data range: ${firstTradeTime.toISOString()} to ${lastTradeTime.toISOString()}`);
        
        const totalDays = (lastTradeTime.getTime() - firstTradeTime.getTime()) / (1000 * 60 * 60 * 24);
        console.log(`Total time span: ${totalDays.toFixed(2)} days`);
        
        // Count trades
        const countQuery = `
          from(bucket: "${config.bucket}")
            |> range(start: 0)
            |> filter(fn: (r) => r._measurement == "trade")
            |> filter(fn: (r) => r._field == "price")
            |> count()
        `;
        
        const countResult = await queryApi.collectRows(countQuery);
        
        if (countResult.length > 0) {
          console.log(`Total trades: ${countResult[0]._value.toLocaleString()}`);
        }
      } else {
        console.log('No trade data found.');
        console.log('Generate some trade data first:');
        console.log('curl "http://localhost:3000/api/trades/generate?symbol=BTCUSD&count=100000"');
      }
    } catch (error) {
      console.error('Error checking trade data:', error.message);
    }
    
    console.log('\nNext steps:');
    console.log('1. If tasks are behind, you can run them manually to catch up faster:');
    console.log('   node src/scripts/runDownsamplingTask.js all');
    console.log('2. To check detailed task logs:');
    console.log('   node src/scripts/checkTaskLogs.js');
    console.log('3. To verify all aspects of the downsampling setup:');
    console.log('   node src/scripts/verifyDownsamplingTasks.js');
  } catch (error) {
    console.error('Error checking downsampling progress:', error);
  }
}

// Execute the check function
checkDownsamplingProgress()
  .then(() => console.log('\nProgress check completed.'))
  .catch(error => console.error('Error checking progress:', error));
