require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');
const { TasksAPI } = require('@influxdata/influxdb-client-apis');

/**
 * This script deletes InfluxDB tasks.
 * It can delete all tasks or specific tasks by name pattern.
 * 
 * Usage:
 * node src/scripts/deleteTasks.js [pattern]
 * 
 * Examples:
 * node src/scripts/deleteTasks.js                  # Delete all tasks
 * node src/scripts/deleteTasks.js Downsample       # Delete all tasks with "Downsample" in the name
 * node src/scripts/deleteTasks.js Downsample_1m    # Delete the specific 1m downsampling task
 */

async function deleteTasks() {
  // Get optional name pattern from command line arguments
  const pattern = process.argv[2] || '';
  
  // Get configuration from environment variables
  const config = {
    url: process.env.INFLUXDB_URL,
    token: process.env.INFLUXDB_TOKEN,
    org: process.env.INFLUXDB_ORG,
    bucket: process.env.INFLUXDB_BUCKET
  };

  console.log('Connecting to InfluxDB at:', config.url);
  console.log('Using organization:', config.org);

  // Create InfluxDB client
  const influxDB = new InfluxDB({
    url: config.url,
    token: config.token
  });

  // Create Tasks API client
  const tasksApi = new TasksAPI(influxDB);

  try {
    // Get all tasks
    console.log('Getting all tasks...');
    const tasks = await tasksApi.getTasks();
    
    if (!tasks || !tasks.tasks || tasks.tasks.length === 0) {
      console.log('No tasks found.');
      return;
    }
    
    console.log(`Found ${tasks.tasks.length} tasks.`);
    
    // Filter tasks by pattern if provided
    const tasksToDelete = pattern 
      ? tasks.tasks.filter(task => task.name.includes(pattern))
      : tasks.tasks;
    
    if (tasksToDelete.length === 0) {
      console.log(`No tasks found matching pattern "${pattern}".`);
      return;
    }
    
    console.log(`Will delete ${tasksToDelete.length} tasks:`);
    tasksToDelete.forEach(task => console.log(`- ${task.name} (ID: ${task.id})`));
    
    // Confirm deletion if not all tasks
    if (pattern) {
      console.log('\nPress Ctrl+C to cancel or wait 5 seconds to continue...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Delete each task
    let successCount = 0;
    let failureCount = 0;
    
    for (const task of tasksToDelete) {
      try {
        console.log(`Deleting task: ${task.name} (ID: ${task.id})...`);
        await tasksApi.deleteTasksID({ taskID: task.id });
        console.log(`✅ Task ${task.name} deleted successfully.`);
        successCount++;
      } catch (error) {
        console.error(`❌ Error deleting task ${task.name}:`, error.message);
        failureCount++;
      }
    }
    
    console.log('\nTask deletion summary:');
    console.log(`- ${successCount} tasks deleted successfully`);
    console.log(`- ${failureCount} tasks failed to delete`);
    
    if (failureCount > 0) {
      console.log('\nSome tasks could not be deleted. This might be due to:');
      console.log('1. Insufficient permissions');
      console.log('2. Tasks being in use by other processes');
      console.log('3. Network or server issues');
      console.log('\nTry again later or check the InfluxDB logs for more information.');
    }
  } catch (error) {
    console.error('Error getting tasks:', error);
  }
}

deleteTasks()
  .then(() => console.log('Task deletion process completed.'))
  .catch(error => console.error('Error in task deletion process:', error));
