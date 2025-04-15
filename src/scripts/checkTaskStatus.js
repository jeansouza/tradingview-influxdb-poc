require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');

/**
 * This script checks the current status of all downsampling tasks in the task_status bucket.
 * It helps identify if any tasks are stuck in the "running" state.
 * 
 * Usage:
 * node src/scripts/checkTaskStatus.js
 */

async function checkTaskStatus() {
  // Get configuration from environment variables
  const config = {
    url: process.env.INFLUXDB_URL,
    token: process.env.INFLUXDB_TOKEN,
    org: process.env.INFLUXDB_ORG,
    statusBucket: 'task_status'
  };

  console.log('Connecting to InfluxDB at:', config.url);
  console.log('Using organization:', config.org);
  console.log('Using status bucket:', config.statusBucket);

  // Create InfluxDB client
  const influxDB = new InfluxDB({
    url: config.url,
    token: config.token
  });

  // Create Query API
  const queryApi = influxDB.getQueryApi(config.org);

  try {
    console.log('\nChecking task status...');
    
    // Query to get the latest status for each task
    const statusQuery = `
      from(bucket: "${config.statusBucket}")
        |> range(start: -24h)
        |> filter(fn: (r) => r._measurement == "task_status")
        |> filter(fn: (r) => r._field == "status")
        |> group(columns: ["task_name"])
        |> last()
    `;
    
    // Execute the query
    const statusResult = await queryApi.collectRows(statusQuery);
    
    if (statusResult.length === 0) {
      console.log('No task status records found.');
      return;
    }
    
    console.log('\nCurrent task status:');
    console.log('--------------------');
    
    // Display the status of each task
    for (const row of statusResult) {
      console.log(`Task: ${row.task_name}`);
      console.log(`Status: ${row._value}`);
      console.log(`Last Updated: ${new Date(row._time).toISOString()}`);
      console.log('--------------------');
    }
    
    // Check for tasks in "running" state
    const runningTasks = statusResult.filter(row => row._value === 'running');
    
    if (runningTasks.length > 0) {
      console.log('\nWARNING: The following tasks are stuck in "running" state:');
      for (const task of runningTasks) {
        console.log(`- ${task.task_name} (since ${new Date(task._time).toISOString()})`);
      }
      
      console.log('\nTo reset these tasks, run:');
      console.log('node src/scripts/resetTaskStatus.js');
    } else {
      console.log('\nAll tasks are in a normal state.');
    }
  } catch (error) {
    console.error('Error checking task status:', error);
  }
}

// Execute the check function
checkTaskStatus()
  .then(() => console.log('\nTask status check completed.'))
  .catch(error => console.error('Error checking task status:', error));
