require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');
const { TasksAPI } = require('@influxdata/influxdb-client-apis');

/**
 * This script runs a specific InfluxDB task by name.
 * It can be used to manually trigger the downsampling tasks.
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
 */

async function runTask() {
  // Get task name from command line arguments
  const taskName = process.argv[2];
  
  if (!taskName) {
    console.error('Error: Task name is required');
    console.log('Usage: node src/scripts/runDownsamplingTask.js <task_name>');
    console.log('Examples:');
    console.log('  node src/scripts/runDownsamplingTask.js Downsample_Trades_1m');
    console.log('  node src/scripts/runDownsamplingTask.js Downsample_Trades_1d');
    console.log('  node src/scripts/runDownsamplingTask.js all');
    process.exit(1);
  }

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
