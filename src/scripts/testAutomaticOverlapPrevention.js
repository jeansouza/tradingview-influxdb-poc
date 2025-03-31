require('dotenv').config();
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const { TasksAPI } = require('@influxdata/influxdb-client-apis');

/**
 * This script tests the overlap prevention mechanism for automatically scheduled tasks.
 * It will:
 * 1. Modify a task to run very frequently (every 5 seconds)
 * 2. Make the task process a larger chunk of data (to ensure it takes longer than 5 seconds)
 * 3. Wait for multiple scheduled runs to occur
 * 4. Check the logs to see if the overlap prevention mechanism is working
 * 
 * Usage:
 * node src/scripts/testAutomaticOverlapPrevention.js [resolution]
 * 
 * Examples:
 * node src/scripts/testAutomaticOverlapPrevention.js 1m
 * node src/scripts/testAutomaticOverlapPrevention.js 1d
 */

async function testAutomaticOverlapPrevention() {
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
  console.log(`Testing automatic overlap prevention for resolution: ${resolution}`);

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
    // Step 1: Get the task
    console.log(`\nStep 1: Getting task Downsample_Trades_${resolution}...`);
    const tasks = await tasksApi.getTasks({
      name: `Downsample_Trades_${resolution}`
    });
    
    if (!tasks || !tasks.tasks || tasks.tasks.length === 0) {
      console.error(`Task Downsample_Trades_${resolution} not found.`);
      return;
    }
    
    const task = tasks.tasks[0];
    console.log(`Found task with ID: ${task.id}`);
    
    // Step 2: Modify the task to run every 5 seconds and process a larger chunk
    console.log(`\nStep 2: Modifying task to run every 5 seconds...`);
    
    // Create a modified Flux script
    const modifiedFlux = createModifiedFluxScript(config.bucket, config.statusBucket, resolution);
    
    // Update the task
    await tasksApi.patchTasksID({
      taskID: task.id,
      body: {
        flux: modifiedFlux,
        every: '5s'
      }
    });
    
    console.log('Task modified successfully.');
    
    // Step 3: Wait for multiple scheduled runs to occur
    console.log(`\nStep 3: Waiting for multiple scheduled runs to occur...`);
    console.log('This will take about 30 seconds...');
    
    // Wait for 30 seconds to allow multiple scheduled runs
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Step 4: Check the logs to see if the overlap prevention mechanism is working
    console.log(`\nStep 4: Checking task logs for overlap prevention...`);
    const logsQuery = `
      from(bucket: "${config.bucket}")
        |> range(start: -1h)
        |> filter(fn: (r) => r._measurement == "task_logs")
        |> filter(fn: (r) => r.task == "Downsample_Trades_${resolution}")
        |> filter(fn: (r) => r._value == "Task is already running, skipping this run")
    `;
    
    const logsResult = await queryApi.collectRows(logsQuery);
    
    if (logsResult.length > 0) {
      console.log('✅ Automatic overlap prevention is working!');
      console.log(`Found ${logsResult.length} skip logs:`);
      
      // Sort logs by time
      logsResult.sort((a, b) => new Date(a._time) - new Date(b._time));
      
      // Display the logs
      logsResult.forEach(log => {
        console.log(`- ${new Date(log._time).toISOString()}: "${log._value}"`);
      });
    } else {
      console.log('❌ No overlap prevention logs found. The mechanism might not be working correctly for automatic runs.');
    }
    
    // Step 5: Restore the original task settings
    console.log(`\nStep 5: Restoring original task settings...`);
    
    // Create the original Flux script
    const originalFlux = createOriginalFluxScript(config.bucket, config.statusBucket, resolution);
    
    // Update the task
    await tasksApi.patchTasksID({
      taskID: task.id,
      body: {
        flux: originalFlux,
        every: '1m'
      }
    });
    
    console.log('Task restored successfully.');
    
    console.log('\nTest completed.');
  } catch (error) {
    console.error('Error testing automatic overlap prevention:', error);
  }
}

/**
 * Creates a modified Flux script for testing automatic overlap prevention
 * This script is similar to the original but processes a much larger chunk of data
 */
function createModifiedFluxScript(bucket, statusBucket, resolution) {
  // Increase the chunk size to make the task take longer
  const chunkDays = 365; // Process a full year of data
  
  return `
// Task to downsample trade data to ${resolution} resolution (MODIFIED FOR TESTING)
option task = {
  name: "Downsample_Trades_${resolution}",
  every: 5s
}

// Check if this task is already running
task_status = from(bucket: "${statusBucket}")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "task_status")
  |> filter(fn: (r) => r.task_name == "Downsample_Trades_${resolution}")
  |> filter(fn: (r) => r._field == "status")
  |> last()
  |> findRecord(fn: (key) => true, idx: 0)

// Check if the task is already running
is_running = if exists task_status and exists task_status._value and task_status._value == "running" then true else false

// Main task logic with overlap prevention
main_task = () => {
  // Mark the task as running by updating the existing status point
  from(bucket: "${statusBucket}")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "task_status")
    |> filter(fn: (r) => r.task_name == "Downsample_Trades_${resolution}")
    |> last()
    |> set(key: "_value", value: "running")
    |> to(bucket: "${statusBucket}", org: "${process.env.INFLUXDB_ORG}")
  
  // Log that we're starting the task
  from(bucket: "${bucket}")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "task_logs")
    |> filter(fn: (r) => r.task == "Downsample_Trades_${resolution}")
    |> last()
    |> set(key: "_value", value: "Starting task run")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  // Get the latest progress record if it exists
  last_processed = from(bucket: "${bucket}")
    |> range(start: 0)
    |> filter(fn: (r) => r._measurement == "downsampling_progress")
    |> filter(fn: (r) => r.resolution == "${resolution}")
    |> filter(fn: (r) => r._field == "last_processed")
    |> last()
    |> findRecord(fn: (key) => true, idx: 0)
  
  // Set the start time based on progress or default to 2022-01-01
  start_time = if exists last_processed and exists last_processed._value then
      time(v: string(v: last_processed._value))
    else
      time(v: "2022-01-01T00:00:00Z")
  
  // Calculate chunk duration in nanoseconds (${chunkDays} days)
  chunk_duration_ns = ${chunkDays} * 24 * 60 * 60 * 1000000000
  
  // Calculate the chunk end time using addition in nanoseconds
  start_time_ns = int(v: start_time)
  end_time_ns = start_time_ns + chunk_duration_ns
  end_time = time(v: end_time_ns)
  
  // Limit the end time to now to avoid processing future data
  current_time = now()
  final_end_time = if end_time > current_time then
      current_time
    else
      end_time
  
  // Process trade data for this chunk
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> filter(fn: (r) => r._field == "price")
    |> window(every: ${resolution})
    |> first()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution}")
    |> set(key: "_field", value: "open")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> filter(fn: (r) => r._field == "price")
    |> window(every: ${resolution})
    |> max()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution}")
    |> set(key: "_field", value: "high")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> filter(fn: (r) => r._field == "price")
    |> window(every: ${resolution})
    |> min()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution}")
    |> set(key: "_field", value: "low")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> filter(fn: (r) => r._field == "price")
    |> window(every: ${resolution})
    |> last()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution}")
    |> set(key: "_field", value: "close")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> filter(fn: (r) => r._field == "amount")
    |> window(every: ${resolution})
    |> sum()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution}")
    |> set(key: "_field", value: "volume")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  // Write the progress record after processing this chunk
  // This ensures the task will continue from where it left off next time
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> last()
    |> map(fn: (r) => ({
        _time: now(),
        _measurement: "downsampling_progress",
        _field: "last_processed",
        resolution: "${resolution}",
        _value: string(v: final_end_time)
      })
    )
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  // Log that we're finishing the task
  from(bucket: "${bucket}")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "task_logs")
    |> filter(fn: (r) => r.task == "Downsample_Trades_${resolution}")
    |> last()
    |> set(key: "_value", value: "Task run completed")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  // Mark the task as completed
  from(bucket: "${statusBucket}")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "task_status")
    |> filter(fn: (r) => r.task_name == "Downsample_Trades_${resolution}")
    |> last()
    |> set(key: "_value", value: "completed")
    |> to(bucket: "${statusBucket}", org: "${process.env.INFLUXDB_ORG}")
    
  return 1
}

// Skip task log for when task is already running
skip_task = () => {
  // Log that we're skipping this run
  from(bucket: "${bucket}")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "task_logs")
    |> filter(fn: (r) => r.task == "Downsample_Trades_${resolution}")
    |> last()
    |> set(key: "_value", value: "Task is already running, skipping this run")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
    
  return 0
}

// Run the appropriate function based on task status
if is_running then skip_task() else main_task()
`;
}

/**
 * Creates the original Flux script to restore the task after testing
 */
function createOriginalFluxScript(bucket, statusBucket, resolution) {
  // Set the chunk size based on the resolution
  let chunkDays;
  switch (resolution) {
    case '1m': chunkDays = 1; break;
    case '5m': chunkDays = 3; break;
    case '15m': chunkDays = 7; break;
    case '1h': chunkDays = 14; break;
    case '4h': chunkDays = 30; break;
    case '1d': chunkDays = 90; break;
    default: chunkDays = 1;
  }
  
  return `
// Task to downsample trade data to ${resolution} resolution
option task = {
  name: "Downsample_Trades_${resolution}",
  every: 1m
}

// Check if this task is already running
task_status = from(bucket: "${statusBucket}")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "task_status")
  |> filter(fn: (r) => r.task_name == "Downsample_Trades_${resolution}")
  |> filter(fn: (r) => r._field == "status")
  |> last()
  |> findRecord(fn: (key) => true, idx: 0)

// Check if the task is already running
is_running = if exists task_status and exists task_status._value and task_status._value == "running" then true else false

// Main task logic with overlap prevention
main_task = () => {
  // Mark the task as running by updating the existing status point
  from(bucket: "${statusBucket}")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "task_status")
    |> filter(fn: (r) => r.task_name == "Downsample_Trades_${resolution}")
    |> last()
    |> set(key: "_value", value: "running")
    |> to(bucket: "${statusBucket}", org: "${process.env.INFLUXDB_ORG}")
  
  // Log that we're starting the task
  from(bucket: "${bucket}")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "task_logs")
    |> filter(fn: (r) => r.task == "Downsample_Trades_${resolution}")
    |> last()
    |> set(key: "_value", value: "Starting task run")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  // Get the latest progress record if it exists
  last_processed = from(bucket: "${bucket}")
    |> range(start: 0)
    |> filter(fn: (r) => r._measurement == "downsampling_progress")
    |> filter(fn: (r) => r.resolution == "${resolution}")
    |> filter(fn: (r) => r._field == "last_processed")
    |> last()
    |> findRecord(fn: (key) => true, idx: 0)
  
  // Set the start time based on progress or default to 2022-01-01
  start_time = if exists last_processed and exists last_processed._value then
      time(v: string(v: last_processed._value))
    else
      time(v: "2022-01-01T00:00:00Z")
  
  // Calculate chunk duration in nanoseconds (${chunkDays} days)
  chunk_duration_ns = ${chunkDays} * 24 * 60 * 60 * 1000000000
  
  // Calculate the chunk end time using addition in nanoseconds
  start_time_ns = int(v: start_time)
  end_time_ns = start_time_ns + chunk_duration_ns
  end_time = time(v: end_time_ns)
  
  // Limit the end time to now to avoid processing future data
  current_time = now()
  final_end_time = if end_time > current_time then
      current_time
    else
      end_time
  
  // Process trade data for this chunk
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> filter(fn: (r) => r._field == "price")
    |> window(every: ${resolution})
    |> first()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution}")
    |> set(key: "_field", value: "open")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> filter(fn: (r) => r._field == "price")
    |> window(every: ${resolution})
    |> max()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution}")
    |> set(key: "_field", value: "high")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> filter(fn: (r) => r._field == "price")
    |> window(every: ${resolution})
    |> min()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution}")
    |> set(key: "_field", value: "low")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> filter(fn: (r) => r._field == "price")
    |> window(every: ${resolution})
    |> last()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution}")
    |> set(key: "_field", value: "close")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> filter(fn: (r) => r._field == "amount")
    |> window(every: ${resolution})
    |> sum()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution}")
    |> set(key: "_field", value: "volume")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  // Write the progress record after processing this chunk
  // This ensures the task will continue from where it left off next time
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> last()
    |> map(fn: (r) => ({
        _time: now(),
        _measurement: "downsampling_progress",
        _field: "last_processed",
        resolution: "${resolution}",
        _value: string(v: final_end_time)
      })
    )
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  // Log that we're finishing the task
  from(bucket: "${bucket}")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "task_logs")
    |> filter(fn: (r) => r.task == "Downsample_Trades_${resolution}")
    |> last()
    |> set(key: "_value", value: "Task run completed")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  // Mark the task as completed
  from(bucket: "${statusBucket}")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "task_status")
    |> filter(fn: (r) => r.task_name == "Downsample_Trades_${resolution}")
    |> last()
    |> set(key: "_value", value: "completed")
    |> to(bucket: "${statusBucket}", org: "${process.env.INFLUXDB_ORG}")
    
  return 1
}

// Skip task log for when task is already running
skip_task = () => {
  // Log that we're skipping this run
  from(bucket: "${bucket}")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "task_logs")
    |> filter(fn: (r) => r.task == "Downsample_Trades_${resolution}")
    |> last()
    |> set(key: "_value", value: "Task is already running, skipping this run")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
    
  return 0
}

// Run the appropriate function based on task status
if is_running then skip_task() else main_task()
`;
}

// Execute the test function
testAutomaticOverlapPrevention()
  .then(() => console.log('Automatic overlap prevention test completed.'))
  .catch(error => console.error('Error testing automatic overlap prevention:', error));
