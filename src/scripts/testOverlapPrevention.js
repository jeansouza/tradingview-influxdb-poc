require('dotenv').config();
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const { TasksAPI } = require('@influxdata/influxdb-client-apis');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * This script tests the overlap prevention mechanism for downsampling tasks.
 * It will:
 * 1. Run a task
 * 2. Try to run it again immediately (should be skipped by the runDownsamplingTask.js script)
 * 3. Force run it with --force flag (should be skipped by the Flux script)
 * 4. Check the task logs to verify the overlap prevention is working
 * 
 * Usage:
 * node src/scripts/testOverlapPrevention.js [resolution]
 * 
 * Examples:
 * node src/scripts/testOverlapPrevention.js 1m
 * node src/scripts/testOverlapPrevention.js 1d
 */

async function testOverlapPrevention() {
  // Get resolution from command line arguments
  const resolution = process.argv[2] || '1m';
  
  // Get configuration from environment variables
  const config = {
    url: process.env.INFLUXDB_URL,
    token: process.env.INFLUXDB_TOKEN,
    org: process.env.INFLUXDB_ORG,
    bucket: process.env.INFLUXDB_BUCKET,
    statusBucket: 'task_status'
  };

  console.log('Connecting to InfluxDB at:', config.url);
  console.log('Using organization:', config.org);
  console.log('Using bucket:', config.bucket);
  console.log('Using status bucket:', config.statusBucket);
  console.log(`Testing overlap prevention for resolution: ${resolution}`);

  // Create InfluxDB client
  const influxDB = new InfluxDB({
    url: config.url,
    token: config.token
  });

  // Create Tasks API client
  const tasksApi = new TasksAPI(influxDB);
  
  // Create Query API
  const queryApi = influxDB.getQueryApi(config.org);

  try {
    // Step 1: Run the task
    console.log(`\nStep 1: Running task Downsample_Trades_${resolution}...`);
    await execPromise(`node src/scripts/runDownsamplingTask.js Downsample_Trades_${resolution}`);
    console.log('Task triggered successfully.');
    
    // Wait a moment for the task to start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check if the task is running
    const statusQuery = `
      from(bucket: "${config.statusBucket}")
        |> range(start: -1h)
        |> filter(fn: (r) => r._measurement == "task_status")
        |> filter(fn: (r) => r.task_name == "Downsample_Trades_${resolution}")
        |> filter(fn: (r) => r._field == "status")
        |> last()
    `;
    
    const statusResult = await queryApi.collectRows(statusQuery);
    
    if (statusResult.length === 0 || statusResult[0]._value !== 'running') {
      console.log('Task is not running. Skipping overlap prevention test.');
      return;
    }
    
    console.log('Task is now running.');
    
    // Step 2: Try to run it again (should be skipped by the runDownsamplingTask.js script)
    console.log(`\nStep 2: Trying to run task Downsample_Trades_${resolution} again...`);
    const result2 = await execPromise(`node src/scripts/runDownsamplingTask.js Downsample_Trades_${resolution}`);
    console.log('Result:');
    console.log(result2.stdout);
    
    // Step 3: Force run it with --force flag (should be skipped by the Flux script)
    console.log(`\nStep 3: Force running task Downsample_Trades_${resolution}...`);
    await execPromise(`node src/scripts/runDownsamplingTask.js Downsample_Trades_${resolution} --force`);
    console.log('Task force triggered successfully.');
    
    // Wait a moment for the task to run
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 4: Check the task logs to verify the overlap prevention is working
    console.log(`\nStep 4: Checking task logs for overlap prevention...`);
    const logsQuery = `
      from(bucket: "${config.bucket}")
        |> range(start: -1h)
        |> filter(fn: (r) => r._measurement == "task_logs")
        |> filter(fn: (r) => r.task == "Downsample_Trades_${resolution}")
        |> filter(fn: (r) => r._value == "Task is already running, skipping this run")
        |> last()
    `;
    
    const logsResult = await queryApi.collectRows(logsQuery);
    
    if (logsResult.length > 0) {
      console.log('✅ Overlap prevention is working!');
      console.log(`Found log: "${logsResult[0]._value}" at ${new Date(logsResult[0]._time).toISOString()}`);
    } else {
      console.log('❌ No overlap prevention logs found. The mechanism might not be working correctly.');
    }
    
    console.log('\nTest completed.');
  } catch (error) {
    console.error('Error testing overlap prevention:', error);
  }
}

// Execute the test function
testOverlapPrevention()
  .then(() => console.log('Overlap prevention test completed.'))
  .catch(error => console.error('Error testing overlap prevention:', error));
