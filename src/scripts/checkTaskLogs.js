require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');
const { TasksAPI } = require('@influxdata/influxdb-client-apis');
const https = require('https');
const http = require('http');

/**
 * This script checks the logs for InfluxDB tasks.
 * It uses the TasksAPI to get detailed run logs.
 * 
 * Usage:
 * node src/scripts/checkTaskLogs.js [task_name_or_id] [limit]
 * 
 * Examples:
 * node src/scripts/checkTaskLogs.js                        # Show all task logs (limit 5)
 * node src/scripts/checkTaskLogs.js Downsample_Trades_1d   # Show logs for a specific task
 * node src/scripts/checkTaskLogs.js 0e9fafe79b83d000       # Show logs for a specific task ID
 * node src/scripts/checkTaskLogs.js all 10                 # Show all task logs with limit 10
 */

async function checkTaskLogs() {
  // Get task name/ID and limit from command line arguments
  const taskNameOrId = process.argv[2] || 'all';
  const limit = parseInt(process.argv[3] || '5');
  
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
    console.log('\nFetching tasks...');
    const allTasks = await tasksApi.getTasks();
    
    if (!allTasks || !allTasks.tasks || allTasks.tasks.length === 0) {
      console.log('No tasks found.');
      return;
    }
    
    console.log(`Found ${allTasks.tasks.length} tasks.`);
    
    // Filter tasks based on the input
    let tasksToCheck = [];
    
    if (taskNameOrId.toLowerCase() === 'all') {
      tasksToCheck = allTasks.tasks;
      console.log(`Checking all ${tasksToCheck.length} tasks...`);
    } else {
      // Check if input is a task ID
      const taskById = allTasks.tasks.find(t => t.id === taskNameOrId);
      
      if (taskById) {
        tasksToCheck = [taskById];
        console.log(`Found task with ID ${taskNameOrId}: ${taskById.name}`);
      } else {
        // Check if input is a task name
        const tasksByName = allTasks.tasks.filter(t => t.name.includes(taskNameOrId));
        
        if (tasksByName.length > 0) {
          tasksToCheck = tasksByName;
          console.log(`Found ${tasksByName.length} tasks matching name '${taskNameOrId}'`);
        } else {
          console.log(`No tasks found with name or ID '${taskNameOrId}'.`);
          return;
        }
      }
    }
    
    // Check each task
    for (const task of tasksToCheck) {
      console.log(`\n========== Task: ${task.name} (ID: ${task.id}) ==========`);
      console.log(`Status: ${task.status}`);
      
      // Get task details to show the Flux script
      try {
        const taskDetails = await tasksApi.getTasksID({ taskID: task.id });
        
        if (taskDetails && taskDetails.flux) {
          console.log('\nTask Flux Script:');
          console.log('----------------------------------------');
          console.log(taskDetails.flux.substring(0, 500) + (taskDetails.flux.length > 500 ? '...' : ''));
          console.log('----------------------------------------');
        }
      } catch (error) {
        console.error('Error fetching task details:', error.message);
      }
      
      // Get the runs for this task
      console.log(`\nFetching runs for task (limit: ${limit})...`);
      
      try {
        // Use the TasksAPI to get runs
        const runs = await tasksApi.getTasksIDRuns({ taskID: task.id, limit });
        
        if (!runs || !runs.runs || runs.runs.length === 0) {
          console.log('No runs found for this task.');
          continue;
        }
        
        console.log(`Found ${runs.runs.length} runs.`);
        
        // Process each run
        for (const run of runs.runs) {
          console.log(`\n----- Run ID: ${run.id} -----`);
          console.log(`Status: ${run.status}`);
          console.log(`Scheduled for: ${new Date(run.scheduledFor).toISOString()}`);
          
          if (run.startedAt) {
            console.log(`Started at: ${new Date(run.startedAt).toISOString()}`);
          }
          
          if (run.finishedAt) {
            console.log(`Finished at: ${new Date(run.finishedAt).toISOString()}`);
          }
          
          // Check for logs in the run object
          if (run.log && run.log.length > 0) {
            console.log('\nRun Logs:');
            for (const log of run.log) {
              console.log(`[${new Date(log.time).toISOString()}] ${log.message}`);
            }
          } else {
            console.log('\nNo logs found in run object.');
          }
          
          // Make a direct API call to get more detailed logs
          console.log('\nFetching detailed logs via direct API call...');
          
          const runLogsUrl = `${config.url}/api/v2/tasks/${task.id}/runs/${run.id}/logs`;
          const runLogsResult = await makeApiRequest(runLogsUrl, config.token);
          
          if (runLogsResult && runLogsResult.events && runLogsResult.events.length > 0) {
            console.log('Detailed Run Logs:');
            for (const event of runLogsResult.events) {
              console.log(`[${new Date(event.time).toISOString()}] ${event.message}`);
            }
          } else {
            console.log('No detailed logs found via API call.');
          }
        }
      } catch (error) {
        console.error('Error fetching task runs:', error.message);
      }
    }
  } catch (error) {
    console.error('Error checking task logs:', error);
  }
}

/**
 * Make a direct API request to InfluxDB
 * @param {string} url - The API URL
 * @param {string} token - The InfluxDB token
 * @returns {Promise<any>} - The API response
 */
function makeApiRequest(url, token) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: 'GET',
      headers: {
        'Authorization': `Token ${token}`,
        'Accept': 'application/json'
      }
    };
    
    // Choose http or https based on the URL
    const requestModule = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = requestModule.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          if (data.trim() === '') {
            resolve({});
          } else {
            resolve(JSON.parse(data));
          }
        } catch (error) {
          console.error('Error parsing API response:', error.message);
          console.error('Raw response:', data);
          reject(error);
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.end();
  });
}

// Execute the check function
checkTaskLogs()
  .then(() => console.log('\nTask logs check completed.'))
  .catch(error => console.error('Error checking task logs:', error));
