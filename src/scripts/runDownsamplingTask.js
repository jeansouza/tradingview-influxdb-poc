require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');
const { TasksAPI } = require('@influxdata/influxdb-client-apis');

/**
 * This script runs a specific InfluxDB task by name.
 * It can be used to manually trigger the downsampling tasks.
 * It checks if a task is already running before triggering it.
 * 
 * Usage:
 * node src/scripts/runDownsamplingTask.js <task_name>
 * 
 * Examples:
 * node src/scripts/runDownsamplingTask.js Downsample_Trades_1m
 * node src/scripts/runDownsamplingTask.js Downsample_Trades_1d
 * 
 * You can also run all downsampling tasks at once:
 * node src/scripts/runDownsamplingTask.js all
 * 
 * Use the --force flag to run a task even if it's already running:
 * node src/scripts/runDownsamplingTask.js Downsample_Trades_1m --force
 */

async function runTask() {
  // Get task name and options from command line arguments
  const taskName = process.argv[2];
  const forceRun = process.argv.includes('--force');
  
  if (!taskName) {
    console.error('Error: Task name is required');
    console.log('Usage: node src/scripts/runDownsamplingTask.js <task_name> [--force]');
    console.log('Examples:');
    console.log('  node src/scripts/runDownsamplingTask.js Downsample_Trades_1m');
    console.log('  node src/scripts/runDownsamplingTask.js Downsample_Trades_1d');
    console.log('  node src/scripts/runDownsamplingTask.js all');
    console.log('  node src/scripts/runDownsamplingTask.js Downsample_Trades_1m --force');
    process.exit(1);
  }

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
  
  // Create Query API
  const queryApi = influxDB.getQueryApi(config.org);

  try {
    // List all tasks
    console.log('\nAvailable tasks:');
    const allTasks = await tasksApi.getTasks();
    
    if (!allTasks || !allTasks.tasks || allTasks.tasks.length === 0) {
      console.error('No tasks found');
      process.exit(1);
    }
    
    // Filter downsampling tasks
    const downsamplingTasks = allTasks.tasks.filter(t => t.name.startsWith('Downsample_Trades_'));
    
    // Display all available tasks
    console.log('Downsampling tasks:');
    downsamplingTasks.forEach(t => {
      console.log(`- ${t.name} (ID: ${t.id}, Status: ${t.status})`);
    });
    
    // Determine which tasks to run
    let tasksToRun = [];
    
    if (taskName.toLowerCase() === 'all') {
      console.log('\nRunning all downsampling tasks...');
      tasksToRun = downsamplingTasks;
    } else {
      // Find the specific task by name
      const task = allTasks.tasks.find(t => t.name === taskName);
      
      if (!task) {
        console.error(`Task '${taskName}' not found`);
        process.exit(1);
      }
      
      tasksToRun = [task];
      console.log(`\nFound task '${task.name}' with ID: ${task.id}`);
    }
    
    // Check task status before running
    if (!forceRun) {
      console.log('\nChecking task status before running...');
      
      // Query to get the latest status for each task
      const statusQuery = `
        from(bucket: "${config.statusBucket}")
          |> range(start: -1h)
          |> filter(fn: (r) => r._measurement == "task_status")
          |> filter(fn: (r) => r._field == "status")
          |> group(columns: ["task_name"])
          |> last()
      `;
      
      // Execute the query
      const statusResult = await queryApi.collectRows(statusQuery);
      
      // Create a map of task name to status
      const statusMap = new Map();
      statusResult.forEach(row => {
        statusMap.set(row.task_name, row._value);
      });
      
      // Filter out tasks that are already running
      const runningTasks = [];
      const tasksToRunFiltered = [];
      
      for (const task of tasksToRun) {
        const status = statusMap.get(task.name);
        if (status === 'running') {
          runningTasks.push(task);
        } else {
          tasksToRunFiltered.push(task);
        }
      }
      
      if (runningTasks.length > 0) {
        console.log('\nThe following tasks are already running:');
        runningTasks.forEach(task => {
          console.log(`- ${task.name}`);
        });
        console.log('\nUse --force flag to run them anyway.');
      }
      
      // Update the list of tasks to run
      tasksToRun = tasksToRunFiltered;
      
      if (tasksToRun.length === 0) {
        console.log('\nNo tasks to run. All specified tasks are already running.');
        console.log('Use --force flag to run them anyway.');
        return;
      }
    } else {
      console.log('\nForce flag detected. Running tasks even if they are already running.');
    }
    
    // Run each task
    for (const task of tasksToRun) {
      console.log(`Running task '${task.name}'...`);
      await tasksApi.postTasksIDRuns({ taskID: task.id });
      console.log(`Task '${task.name}' triggered successfully`);
    }
    
    console.log('\nNote: The task(s) are running in the background on the InfluxDB server.');
    console.log('Each task processes data in chunks for better performance.');
    console.log('To check progress, run: node src/scripts/verifyDownsamplingTasks.js');
    
    if (tasksToRun.length > 1) {
      console.log('\nTip: For large datasets, it\'s better to run tasks one at a time');
      console.log('to avoid overloading the InfluxDB server.');
    }
  } catch (error) {
    console.error('Error running task:', error);
    process.exit(1);
  }
}

// Execute the run function
runTask()
  .then(() => console.log('Task run command completed.'))
  .catch(error => console.error('Error running task:', error));
