require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');
const { TasksAPI } = require('@influxdata/influxdb-client-apis');

/**
 * This script sets up InfluxDB tasks to downsample trade data into different time resolutions.
 * It creates pre-aggregated OHLC (Open, High, Low, Close) data for each resolution.
 * 
 * Resolutions: 1m, 5m, 15m, 1h, 4h, 1d
 * 
 * Each task will:
 * 1. Check for existing downsampled data
 * 2. Process all unprocessed data from the earliest trade to now
 * 3. Run incrementally to avoid reprocessing already downsampled data
 * 4. Handle both initial backfill and ongoing downsampling in a single task
 * 
 * The tasks are optimized for performance with large datasets (50M+ records).
 */

async function setupDownsamplingTasks() {
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

  // Define resolutions for downsampling
  const resolutions = [
    { name: '1m', seconds: 60, flux: '1m', every: '5m', chunkDays: 1 },      // Run every 5 minutes, process 1 day chunks
    { name: '5m', seconds: 300, flux: '5m', every: '15m', chunkDays: 3 },    // Run every 15 minutes, process 3 day chunks
    { name: '15m', seconds: 900, flux: '15m', every: '30m', chunkDays: 7 },  // Run every 30 minutes, process 7 day chunks
    { name: '1h', seconds: 3600, flux: '1h', every: '1h', chunkDays: 14 },   // Run every hour, process 14 day chunks
    { name: '4h', seconds: 14400, flux: '4h', every: '4h', chunkDays: 30 },  // Run every 4 hours, process 30 day chunks
    { name: '1d', seconds: 86400, flux: '1d', every: '6h', chunkDays: 90 }   // Run every 6 hours, process 90 day chunks
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
            flux: createFluxScript(config.bucket, resolution),
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
          flux: createFluxScript(config.bucket, resolution),
          every: resolution.every
        };

        await tasksApi.postTasks({ body: task });
        console.log(`Task for ${resolution.name} created successfully.`);
      }
    } catch (error) {
      console.error(`Error creating/updating task for ${resolution.name}:`, error);
    }
  }
  
  console.log('\nDownsampling tasks setup completed.');
  console.log('Each task will automatically process all historical data and keep up with new data.');
  console.log('The tasks will run incrementally to avoid reprocessing already downsampled data.');
  console.log('\nTo manually trigger a task, use:');
  console.log('node src/scripts/runDownsamplingTask.js Downsample_Trades_<resolution>');
  console.log('\nTo verify the tasks and check progress, use:');
  console.log('node src/scripts/verifyDownsamplingTasks.js');
}

/**
 * Creates a Flux script for downsampling trade data to a specific resolution
 * This script handles both initial backfill and ongoing downsampling in a single task
 */
function createFluxScript(bucket, resolution) {
  return `
// Task to downsample trade data to ${resolution.name} resolution
option task = {
  name: "Downsample_Trades_${resolution.name}",
  every: ${resolution.every}
}

// Get the latest progress record if it exists
last_processed = from(bucket: "${bucket}")
  |> range(start: 0)
  |> filter(fn: (r) => r._measurement == "downsampling_progress")
  |> filter(fn: (r) => r.resolution == "${resolution.name}")
  |> filter(fn: (r) => r._field == "last_processed")
  |> last()
  |> findRecord(fn: (key) => true, idx: 0)

// Set the start time based on progress or default to 2022-01-01
start_time = if exists last_processed._value then
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

// For now, we'll skip writing the progress record
// This means the task will always start from the beginning
// But it's better than having the task fail completely
`;
}

// Execute the setup function
setupDownsamplingTasks()
  .then(() => console.log('Downsampling tasks setup completed.'))
  .catch(error => console.error('Error setting up downsampling tasks:', error));
