require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');
const { TasksAPI } = require('@influxdata/influxdb-client-apis');

/**
 * This script verifies that the downsampling tasks are properly set up and running.
 * It checks the task configurations, runs, and downsampling progress.
 * 
 * Usage:
 * node src/scripts/verifyDownsamplingTasks.js
 */

async function verifyDownsamplingTasks() {
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

  // Create Tasks API client
  const tasksApi = new TasksAPI(influxDB);

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
    // Get all tasks
    console.log('\nFetching all tasks...');
    const allTasks = await tasksApi.getTasks();
    
    if (!allTasks || !allTasks.tasks || allTasks.tasks.length === 0) {
      console.error('No tasks found. Run the setupDownsamplingTasks.js script first.');
      return;
    }
    
    console.log(`Found ${allTasks.tasks.length} tasks.`);
    
    // Check for each expected task
    console.log('\nVerifying downsampling tasks:');
    
    // Check downsampling tasks
    for (const resolution of resolutions) {
      const taskName = `Downsample_Trades_${resolution.name}`;
      const task = allTasks.tasks.find(t => t.name === taskName);
      
      if (task) {
        console.log(`✅ Task '${taskName}' exists (ID: ${task.id}, Status: ${task.status})`);
        
        // Check if the task has runs
        try {
          const runs = await tasksApi.getTasksIDRuns({ taskID: task.id });
          
          if (runs && runs.runs && runs.runs.length > 0) {
            console.log(`   - Task has ${runs.runs.length} runs`);
            
            // Get the latest run
            const latestRun = runs.runs[0];
            console.log(`   - Latest run: ${latestRun.status} at ${new Date(latestRun.scheduledFor).toISOString()}`);
          } else {
            console.log(`   - Task has no runs yet`);
            console.log(`   - Trigger the task manually to start processing:`);
            console.log(`     node src/scripts/runDownsamplingTask.js ${taskName}`);
          }
        } catch (error) {
          console.error(`   - Error fetching runs for task '${taskName}':`, error.message);
        }
        
        // Check the task script to ensure it's using the new format
        try {
          const taskDetails = await tasksApi.getTasksID({ taskID: task.id });
          
          if (taskDetails && taskDetails.flux) {
            // Check if the script includes the key components of our new approach
            const hasIncrementalProcessing = taskDetails.flux.includes('downsampling_progress') && 
                                            taskDetails.flux.includes('last_processed') &&
                                            taskDetails.flux.includes('start_time') &&
                                            taskDetails.flux.includes('final_end_time');
            const hasWindowAggregation = taskDetails.flux.includes('window(every:');
            const hasOHLCVFields = taskDetails.flux.includes('open') && 
                                  taskDetails.flux.includes('high') && 
                                  taskDetails.flux.includes('low') && 
                                  taskDetails.flux.includes('close') && 
                                  taskDetails.flux.includes('volume');
            
            if (hasIncrementalProcessing && hasWindowAggregation && hasOHLCVFields) {
              console.log(`   - ✅ Task script is using the optimized format`);
            } else {
              console.log(`   - ⚠️ Task script may not be using the latest optimized format`);
              console.log(`     Run setupDownsamplingTasks.js again to update the task.`);
            }
          }
        } catch (error) {
          console.error(`   - Error fetching task details:`, error.message);
        }
      } else {
        console.error(`❌ Task '${taskName}' not found`);
        console.log(`   Run setupDownsamplingTasks.js to create it.`);
      }
    }
    
    // Check for downsampling progress
    console.log('\nChecking downsampling progress:');
    
    try {
      // Query to get the latest progress for each resolution
      const progressQuery = `
        from(bucket: "${config.bucket}")
          |> range(start: -7d)
          |> filter(fn: (r) => r._measurement == "downsampling_progress")
          |> filter(fn: (r) => r._field == "last_processed")
          |> group(columns: ["resolution"])
          |> last()
      `;
      
      // Execute the query
      const progressResult = await queryApi.collectRows(progressQuery);
      
      if (progressResult.length > 0) {
        console.log('Progress of downsampling tasks:');
        
        // Create a map of resolution to progress
        const progressMap = new Map();
        progressResult.forEach(row => {
          progressMap.set(row.resolution, row._value);
        });
        
        // Display progress for each resolution
        for (const resolution of resolutions) {
          const progress = progressMap.get(resolution.name);
          if (progress) {
            console.log(`   - ${resolution.name}: Last processed up to ${progress}`);
          } else {
            console.log(`   - ${resolution.name}: No progress recorded yet`);
          }
        }
      } else {
        console.log('No downsampling progress recorded yet. Tasks may not have run or completed a chunk.');
      }
    } catch (error) {
      console.error('Error checking downsampling progress:', error.message);
    }
    
    // Check if downsampled data exists
    console.log('\nChecking for downsampled data:');
    
    for (const resolution of resolutions) {
      try {
        // Query to check if the measurement exists and count points
        const countQuery = `
          from(bucket: "${config.bucket}")
            |> range(start: 0)
            |> filter(fn: (r) => r._measurement == "trade_ohlc_${resolution.name}")
            |> group()
            |> count()
            |> yield(name: "count")
        `;
        
        // Execute the query
        const countResult = await queryApi.collectRows(countQuery);
        
        if (countResult.length > 0 && countResult[0]._value > 0) {
          const count = countResult[0]._value;
          console.log(`✅ Found ${count.toLocaleString()} data points for resolution ${resolution.name}`);
          
          // Get the time range of the downsampled data
          const rangeQuery = `
            from(bucket: "${config.bucket}")
              |> range(start: 0)
              |> filter(fn: (r) => r._measurement == "trade_ohlc_${resolution.name}")
              |> filter(fn: (r) => r._field == "close")
              |> first()
              |> yield(name: "first")
              
            from(bucket: "${config.bucket}")
              |> range(start: 0)
              |> filter(fn: (r) => r._measurement == "trade_ohlc_${resolution.name}")
              |> filter(fn: (r) => r._field == "close")
              |> last()
              |> yield(name: "last")
          `;
          
          const rangeResult = await queryApi.collectRows(rangeQuery);
          
          let firstTime = null;
          let lastTime = null;
          
          for (const row of rangeResult) {
            if (row.result === 'first') {
              firstTime = new Date(row._time);
            } else if (row.result === 'last') {
              lastTime = new Date(row._time);
            }
          }
          
          if (firstTime && lastTime) {
            console.log(`   - Time range: ${firstTime.toISOString()} to ${lastTime.toISOString()}`);
            
            // Calculate coverage percentage
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
                const totalTradeTimeMs = lastTradeTime.getTime() - firstTradeTime.getTime();
                const downsampledTimeMs = lastTime.getTime() - firstTime.getTime();
                const coveragePercent = (downsampledTimeMs / totalTradeTimeMs) * 100;
                
                console.log(`   - Coverage: ${coveragePercent.toFixed(2)}% of total trade history`);
                
                if (coveragePercent < 95) {
                  console.log(`   - ⚠️ Downsampling is not complete. Tasks are still processing.`);
                } else {
                  console.log(`   - ✅ Downsampling is nearly complete.`);
                }
              }
            } catch (error) {
              console.error(`   - Error calculating coverage:`, error.message);
            }
          }
        } else {
          console.log(`❌ No data found for resolution ${resolution.name}`);
        }
      } catch (error) {
        console.error(`Error checking data for resolution ${resolution.name}:`, error.message);
      }
    }
    
    // Check task logs
    console.log('\nChecking recent task logs:');
    
    try {
      const logsQuery = `
        from(bucket: "${config.bucket}")
          |> range(start: -1d)
          |> filter(fn: (r) => r._measurement == "task_logs")
          |> filter(fn: (r) => r._field == "message")
          |> sort(columns: ["_time"], desc: true)
          |> limit(n: 10)
      `;
      
      const logsResult = await queryApi.collectRows(logsQuery);
      
      if (logsResult.length > 0) {
        console.log('Recent task logs:');
        for (const log of logsResult) {
          console.log(`   - [${new Date(log._time).toISOString()}] ${log.task || 'unknown'}: ${log._value}`);
        }
      } else {
        console.log('No recent task logs found.');
      }
    } catch (error) {
      console.error('Error fetching task logs:', error.message);
    }
    
    console.log('\nSummary:');
    console.log('1. If tasks exist but have no runs, trigger them manually:');
    console.log('   node src/scripts/runDownsamplingTask.js Downsample_Trades_<resolution>');
    console.log('2. Each task processes data in chunks for better performance.');
    console.log('   It may take multiple runs to process the entire history.');
    console.log('3. If no downsampled data is found, check if you have trade data:');
    console.log('   node src/scripts/countTrades.js');
    console.log('4. Generate trade data if needed:');
    console.log('   curl "http://localhost:3000/api/trades/generate?symbol=BTCUSD&count=100000"');
    console.log('5. To monitor progress, run this verification script periodically.');
  } catch (error) {
    console.error('Error verifying downsampling tasks:', error);
  }
}

// Execute the verification function
verifyDownsamplingTasks()
  .then(() => console.log('\nVerification completed.'))
  .catch(error => console.error('Error during verification:', error));
