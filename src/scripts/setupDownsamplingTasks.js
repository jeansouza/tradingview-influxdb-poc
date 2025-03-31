require('dotenv').config();
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const { TasksAPI } = require('@influxdata/influxdb-client-apis');

/**
 * This script sets up InfluxDB tasks to downsample trade data into different time resolutions.
 * It creates pre-aggregated OHLC (Open, High, Low, Close) data for each resolution.
 * 
 * Resolutions: 1m, 5m, 15m, 1h, 4h, 1d
 * 
 * Each task will:
 * 1. Check if the task is already running (using task_status bucket)
 * 2. Check for existing downsampled data
 * 3. Process all unprocessed data from the earliest trade to now
 * 4. Run incrementally to avoid reprocessing already downsampled data
 * 5. Handle both initial backfill and ongoing downsampling in a single task
 * 
 * The tasks are optimized for performance with large datasets (50M+ records).
 * 
 * Tasks are scheduled to run every minute. The task status check ensures that
 * if a task is still running when it's scheduled to run again, the new run will
 * exit immediately, preventing multiple instances from running simultaneously.
 */

async function setupDownsamplingTasks() {
  // Get configuration from environment variables
  const config = {
    url: process.env.INFLUXDB_URL,
    token: process.env.INFLUXDB_TOKEN,
    org: process.env.INFLUXDB_ORG,
    bucket: process.env.INFLUXDB_BUCKET,
    statusBucket: 'task_status' // New bucket for storing task status
  };

  console.log('Connecting to InfluxDB at:', config.url);
  console.log('Using organization:', config.org);
  console.log('Using bucket:', config.bucket);
  console.log('Using status bucket:', config.statusBucket);

  // Create InfluxDB client
  const influxDB = new InfluxDB({
    url: config.url,
    token: config.token
  });

  // Create Tasks API client
  const tasksApi = new TasksAPI(influxDB);
  
  // Create bucket for task status if it doesn't exist
  await createStatusBucket(influxDB, config);

  // Define resolutions for downsampling - all running every 1 minute
  const resolutions = [
    { name: '1m', seconds: 60, flux: '1m', every: '1m', chunkDays: 1 },      // Run every minute, process 1 day chunks
    { name: '5m', seconds: 300, flux: '5m', every: '1m', chunkDays: 3 },     // Run every minute, process 3 day chunks
    { name: '15m', seconds: 900, flux: '15m', every: '1m', chunkDays: 7 },   // Run every minute, process 7 day chunks
    { name: '1h', seconds: 3600, flux: '1h', every: '1m', chunkDays: 14 },   // Run every minute, process 14 day chunks
    { name: '4h', seconds: 14400, flux: '4h', every: '1m', chunkDays: 30 },  // Run every minute, process 30 day chunks
    { name: '1d', seconds: 86400, flux: '1d', every: '1m', chunkDays: 90 }   // Run every minute, process 90 day chunks
  ];

  // Get organization ID
  const orgsApi = new (require('@influxdata/influxdb-client-apis').OrgsAPI)(influxDB);
  const orgs = await orgsApi.getOrgs({ org: config.org });
  if (!orgs || !orgs.orgs || orgs.orgs.length === 0) {
    throw new Error(`Organization '${config.org}' not found`);
  }
  const orgID = orgs.orgs[0].id;

  // Create a task for each resolution
  for (const resolution of resolutions) {
    try {
      // Check if task already exists
      const tasks = await tasksApi.getTasks({
        name: `Downsample_Trades_${resolution.name}`
      });

      if (tasks && tasks.tasks && tasks.tasks.length > 0) {
        console.log(`Task for ${resolution.name} already exists. Updating...`);
        
        // Get the existing task
        const existingTask = tasks.tasks[0];
        
        // Update the task with the new flux script
        await tasksApi.patchTasksID({
          taskID: existingTask.id,
          body: {
            flux: createFluxScript(config.bucket, config.statusBucket, resolution),
            every: resolution.every
          }
        });
        
        console.log(`Task for ${resolution.name} updated successfully.`);
      } else {
        // Create a new task
        const task = {
          name: `Downsample_Trades_${resolution.name}`,
          orgID: orgID,
          status: 'active',
          flux: createFluxScript(config.bucket, config.statusBucket, resolution),
          every: resolution.every
        };

        await tasksApi.postTasks({ body: task });
        console.log(`Task for ${resolution.name} created successfully.`);
      }
    } catch (error) {
      console.error(`Error creating/updating task for ${resolution.name}:`, error);
    }
  }
  
  // Create initial status points for each task
  await createInitialStatusPoints(influxDB, config, resolutions);
  
  console.log('\nDownsampling tasks setup completed.');
  console.log('Each task will automatically process all historical data and keep up with new data.');
  console.log('The tasks will run incrementally to avoid reprocessing already downsampled data.');
  console.log('Tasks are configured to run every minute with overlap prevention.');
  console.log('Each task will check if it is already running before starting a new run.');
  console.log('\nTo manually trigger a task, use:');
  console.log('node src/scripts/runDownsamplingTask.js Downsample_Trades_<resolution>');
  console.log('\nTo verify the tasks and check progress, use:');
  console.log('node src/scripts/verifyDownsamplingTasks.js');
}

/**
 * Creates a status bucket for storing task status if it doesn't exist
 */
async function createStatusBucket(influxDB, config) {
  try {
    // Create bucket for task status if it doesn't exist
    const { OrgsAPI, BucketsAPI } = require('@influxdata/influxdb-client-apis');
    const orgsAPI = new OrgsAPI(influxDB);
    const bucketsAPI = new BucketsAPI(influxDB);
    
    // Get organization ID
    const orgs = await orgsAPI.getOrgs({ org: config.org });
    if (!orgs || !orgs.orgs || orgs.orgs.length === 0) {
      throw new Error(`Organization '${config.org}' not found`);
    }
    const orgID = orgs.orgs[0].id;
    
    // Check if status bucket exists
    const buckets = await bucketsAPI.getBuckets({ name: config.statusBucket });
    
    // Create status bucket if it doesn't exist
    if (!buckets || !buckets.buckets || buckets.buckets.length === 0) {
      console.log(`Status bucket '${config.statusBucket}' not found. Creating it...`);
      
      // Create the bucket with infinite retention
      await bucketsAPI.postBuckets({
        body: {
          orgID,
          name: config.statusBucket,
          retentionRules: []  // Empty array means infinite retention
        }
      });
      
      console.log(`Status bucket '${config.statusBucket}' created successfully.`);
    } else {
      console.log(`Status bucket '${config.statusBucket}' already exists.`);
    }
  } catch (error) {
    console.error('Error creating status bucket:', error);
    throw error;
  }
}

/**
 * Creates initial status points for each task
 * This is necessary because the Flux script needs existing points to use as templates
 */
async function createInitialStatusPoints(influxDB, config, resolutions) {
  try {
    // Create a write API client
    const writeApi = influxDB.getWriteApi(config.org, config.statusBucket, 'ns');
    
    // Create initial status points for each task
    for (const resolution of resolutions) {
      const point = new Point('task_status')
        .tag('task_name', `Downsample_Trades_${resolution.name}`)
        .stringField('status', 'completed');
      
      writeApi.writePoint(point);
    }
    
    // Create initial log points
    const logWriteApi = influxDB.getWriteApi(config.org, config.bucket, 'ns');
    
    for (const resolution of resolutions) {
      const point = new Point('task_logs')
        .tag('task', `Downsample_Trades_${resolution.name}`)
        .stringField('message', 'Initial setup');
      
      logWriteApi.writePoint(point);
    }
    
    // Flush the write API
    await writeApi.flush();
    await writeApi.close();
    
    await logWriteApi.flush();
    await logWriteApi.close();
    
    console.log('Initial status points created successfully.');
  } catch (error) {
    console.error('Error creating initial status points:', error);
  }
}

/**
 * Creates a Flux script for downsampling trade data to a specific resolution
 * This script handles both initial backfill and ongoing downsampling in a single task
 * It also includes task overlap prevention by checking and updating task status
 */
function createFluxScript(bucket, statusBucket, resolution) {
  return `
// Task to downsample trade data to ${resolution.name} resolution
option task = {
  name: "Downsample_Trades_${resolution.name}",
  every: ${resolution.every}
}

// Check if this task is already running
task_status = from(bucket: "${statusBucket}")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "task_status")
  |> filter(fn: (r) => r.task_name == "Downsample_Trades_${resolution.name}")
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
    |> filter(fn: (r) => r.task_name == "Downsample_Trades_${resolution.name}")
    |> last()
    |> set(key: "_value", value: "running")
    |> to(bucket: "${statusBucket}", org: "${process.env.INFLUXDB_ORG}")
  
  // Log that we're starting the task
  from(bucket: "${bucket}")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "task_logs")
    |> filter(fn: (r) => r.task == "Downsample_Trades_${resolution.name}")
    |> last()
    |> set(key: "_value", value: "Starting task run")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  // Get the latest progress record if it exists
  last_processed = from(bucket: "${bucket}")
    |> range(start: 0)
    |> filter(fn: (r) => r._measurement == "downsampling_progress")
    |> filter(fn: (r) => r.resolution == "${resolution.name}")
    |> filter(fn: (r) => r._field == "last_processed")
    |> last()
    |> findRecord(fn: (key) => true, idx: 0)
  
  // Set the start time based on progress or default to 2022-01-01
  start_time = if exists last_processed and exists last_processed._value then
      time(v: string(v: last_processed._value))
    else
      time(v: "2022-01-01T00:00:00Z")
  
  // Calculate chunk duration in nanoseconds (${resolution.chunkDays} days)
  chunk_duration_ns = ${resolution.chunkDays} * 24 * 60 * 60 * 1000000000
  
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
    |> window(every: ${resolution.flux})
    |> first()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution.name}")
    |> set(key: "_field", value: "open")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> filter(fn: (r) => r._field == "price")
    |> window(every: ${resolution.flux})
    |> max()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution.name}")
    |> set(key: "_field", value: "high")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> filter(fn: (r) => r._field == "price")
    |> window(every: ${resolution.flux})
    |> min()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution.name}")
    |> set(key: "_field", value: "low")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> filter(fn: (r) => r._field == "price")
    |> window(every: ${resolution.flux})
    |> last()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution.name}")
    |> set(key: "_field", value: "close")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  from(bucket: "${bucket}")
    |> range(start: start_time, stop: final_end_time)
    |> filter(fn: (r) => r._measurement == "trade")
    |> filter(fn: (r) => r._field == "amount")
    |> window(every: ${resolution.flux})
    |> sum()
    |> duplicate(column: "_stop", as: "_time")
    |> set(key: "_measurement", value: "trade_ohlc_${resolution.name}")
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
        resolution: "${resolution.name}",
        _value: string(v: final_end_time)
      })
    )
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  // Log that we're finishing the task
  from(bucket: "${bucket}")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "task_logs")
    |> filter(fn: (r) => r.task == "Downsample_Trades_${resolution.name}")
    |> last()
    |> set(key: "_value", value: "Task run completed")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
  
  // Mark the task as completed
  from(bucket: "${statusBucket}")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "task_status")
    |> filter(fn: (r) => r.task_name == "Downsample_Trades_${resolution.name}")
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
    |> filter(fn: (r) => r.task == "Downsample_Trades_${resolution.name}")
    |> last()
    |> set(key: "_value", value: "Task is already running, skipping this run")
    |> to(bucket: "${bucket}", org: "${process.env.INFLUXDB_ORG}")
    
  return 0
}

// Run the appropriate function based on task status
if is_running then skip_task() else main_task()
`;
}

// Execute the setup function
setupDownsamplingTasks()
  .then(() => console.log('Downsampling tasks setup completed.'))
  .catch(error => console.error('Error setting up downsampling tasks:', error));
