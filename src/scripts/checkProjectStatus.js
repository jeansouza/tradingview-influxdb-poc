require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');
const { TasksAPI } = require('@influxdata/influxdb-client-apis');
const fs = require('fs');
const path = require('path');

/**
 * This script performs a comprehensive check of the project status,
 * identifying potential issues, missing implementations, and areas for improvement.
 * 
 * Usage:
 * node src/scripts/checkProjectStatus.js
 */

async function checkProjectStatus() {
  console.log('=== TradingView InfluxDB POC - Project Status Check ===\n');
  
  // Check environment variables
  checkEnvironmentVariables();
  
  // Check InfluxDB connection and configuration
  await checkInfluxDBConnection();
  
  // Check data availability
  await checkDataAvailability();
  
  // Check downsampling tasks
  await checkDownsamplingTasks();
  
  // Check API endpoints
  checkAPIEndpoints();
  
  // Check frontend integration
  checkFrontendIntegration();
  
  // Check documentation
  checkDocumentation();
  
  // Check for missing implementations
  checkMissingImplementations();
  
  // Summarize findings
  summarizeFindings();
}

// Check environment variables
function checkEnvironmentVariables() {
  console.log('Checking environment variables...');
  
  const requiredVars = ['INFLUXDB_URL', 'INFLUXDB_TOKEN', 'INFLUXDB_ORG', 'INFLUXDB_BUCKET'];
  const missingVars = [];
  
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }
  
  if (missingVars.length > 0) {
    console.log(`❌ Missing environment variables: ${missingVars.join(', ')}`);
    console.log('   Please check your .env file and ensure all required variables are set.');
  } else {
    console.log('✅ All required environment variables are set.');
  }
  
  console.log();
}

// Check InfluxDB connection and configuration
async function checkInfluxDBConnection() {
  console.log('Checking InfluxDB connection...');
  
  if (!process.env.INFLUXDB_URL || !process.env.INFLUXDB_TOKEN || 
      !process.env.INFLUXDB_ORG || !process.env.INFLUXDB_BUCKET) {
    console.log('❌ Cannot check InfluxDB connection due to missing environment variables.');
    console.log();
    return;
  }
  
  const config = {
    url: process.env.INFLUXDB_URL,
    token: process.env.INFLUXDB_TOKEN,
    org: process.env.INFLUXDB_ORG,
    bucket: process.env.INFLUXDB_BUCKET
  };
  
  try {
    // Create InfluxDB client
    const influxDB = new InfluxDB({
      url: config.url,
      token: config.token
    });
    
    // Create Query API
    const queryApi = influxDB.getQueryApi(config.org);
    
    // Test query to check connection
    const testQuery = `from(bucket: "${config.bucket}") |> range(start: -1m) |> limit(n: 1)`;
    
    await queryApi.collectRows(testQuery);
    console.log('✅ Successfully connected to InfluxDB.');
    
    // Check if status bucket exists
    try {
      const statusBucketQuery = `from(bucket: "task_status") |> range(start: -1m) |> limit(n: 1)`;
      await queryApi.collectRows(statusBucketQuery);
      console.log('✅ Task status bucket exists.');
    } catch (error) {
      console.log('❌ Task status bucket does not exist or is not accessible.');
      console.log('   Run setupDownsamplingTasks.js to create it.');
    }
  } catch (error) {
    console.log('❌ Failed to connect to InfluxDB:', error.message);
    console.log('   Please check your InfluxDB configuration and ensure the service is running.');
  }
  
  console.log();
}

// Check data availability
async function checkDataAvailability() {
  console.log('Checking data availability...');
  
  if (!process.env.INFLUXDB_URL || !process.env.INFLUXDB_TOKEN || 
      !process.env.INFLUXDB_ORG || !process.env.INFLUXDB_BUCKET) {
    console.log('❌ Cannot check data availability due to missing environment variables.');
    console.log();
    return;
  }
  
  const config = {
    url: process.env.INFLUXDB_URL,
    token: process.env.INFLUXDB_TOKEN,
    org: process.env.INFLUXDB_ORG,
    bucket: process.env.INFLUXDB_BUCKET
  };
  
  try {
    // Create InfluxDB client
    const influxDB = new InfluxDB({
      url: config.url,
      token: config.token
    });
    
    // Create Query API
    const queryApi = influxDB.getQueryApi(config.org);
    
    // Check for raw trade data
    try {
      const tradeCountQuery = `
        from(bucket: "${config.bucket}")
          |> range(start: 0)
          |> filter(fn: (r) => r._measurement == "trade")
          |> count()
          |> yield(name: "count")
      `;
      
      const tradeCountResult = await queryApi.collectRows(tradeCountQuery);
      
      if (tradeCountResult.length > 0 && tradeCountResult[0]._value > 0) {
        const count = tradeCountResult[0]._value;
        console.log(`✅ Found ${count.toLocaleString()} raw trade records.`);
        
        if (count < 1000000) {
          console.log(`⚠️ Only ${count.toLocaleString()} trades found. For proper performance testing, generate at least 50M records.`);
          console.log('   Use: curl "http://localhost:3000/api/trades/generate?symbol=BTCUSD&count=10000000"');
          console.log('   Note: Use high-memory mode for generating large datasets.');
        }
      } else {
        console.log('❌ No raw trade data found.');
        console.log('   Generate test data using the /api/trades/generate endpoint.');
      }
    } catch (error) {
      console.log('❌ Error checking raw trade data:', error.message);
    }
    
    // Check for downsampled data
    const resolutions = ['1m', '5m', '15m', '1h', '4h', '1d'];
    let hasDownsampledData = false;
    
    for (const resolution of resolutions) {
      try {
        const downsampledCountQuery = `
          from(bucket: "${config.bucket}")
            |> range(start: 0)
            |> filter(fn: (r) => r._measurement == "trade_ohlc_${resolution}")
            |> count()
            |> yield(name: "count")
        `;
        
        const downsampledCountResult = await queryApi.collectRows(downsampledCountQuery);
        
        if (downsampledCountResult.length > 0 && downsampledCountResult[0]._value > 0) {
          const count = downsampledCountResult[0]._value;
          console.log(`✅ Found ${count.toLocaleString()} downsampled records for ${resolution} resolution.`);
          hasDownsampledData = true;
        } else {
          console.log(`❌ No downsampled data found for ${resolution} resolution.`);
        }
      } catch (error) {
        console.log(`❌ Error checking downsampled data for ${resolution}:`, error.message);
      }
    }
    
    if (!hasDownsampledData) {
      console.log('⚠️ No downsampled data found for any resolution.');
      console.log('   Run the downsampling tasks to generate downsampled data:');
      console.log('   node src/scripts/runDownsamplingTask.js all');
    }
  } catch (error) {
    console.log('❌ Failed to check data availability:', error.message);
  }
  
  console.log();
}

// Check downsampling tasks
async function checkDownsamplingTasks() {
  console.log('Checking downsampling tasks...');
  
  if (!process.env.INFLUXDB_URL || !process.env.INFLUXDB_TOKEN || 
      !process.env.INFLUXDB_ORG || !process.env.INFLUXDB_BUCKET) {
    console.log('❌ Cannot check downsampling tasks due to missing environment variables.');
    console.log();
    return;
  }
  
  const config = {
    url: process.env.INFLUXDB_URL,
    token: process.env.INFLUXDB_TOKEN,
    org: process.env.INFLUXDB_ORG,
    bucket: process.env.INFLUXDB_BUCKET
  };
  
  try {
    // Create InfluxDB client
    const influxDB = new InfluxDB({
      url: config.url,
      token: config.token
    });
    
    // Create Tasks API client
    const tasksApi = new TasksAPI(influxDB);
    
    // Get all tasks
    const allTasks = await tasksApi.getTasks();
    
    if (!allTasks || !allTasks.tasks || allTasks.tasks.length === 0) {
      console.log('❌ No tasks found.');
      console.log('   Run setupDownsamplingTasks.js to create the downsampling tasks.');
      console.log();
      return;
    }
    
    // Filter downsampling tasks
    const downsamplingTasks = allTasks.tasks.filter(t => t.name.startsWith('Downsample_Trades_'));
    
    if (downsamplingTasks.length === 0) {
      console.log('❌ No downsampling tasks found.');
      console.log('   Run setupDownsamplingTasks.js to create the downsampling tasks.');
    } else {
      console.log(`✅ Found ${downsamplingTasks.length} downsampling tasks.`);
      
      // Check expected resolutions
      const resolutions = ['1m', '5m', '15m', '1h', '4h', '1d'];
      const foundResolutions = downsamplingTasks.map(t => {
        const match = t.name.match(/Downsample_Trades_(.+)/);
        return match ? match[1] : null;
      }).filter(Boolean);
      
      const missingResolutions = resolutions.filter(r => !foundResolutions.includes(r));
      
      if (missingResolutions.length > 0) {
        console.log(`⚠️ Missing downsampling tasks for resolutions: ${missingResolutions.join(', ')}`);
        console.log('   Run setupDownsamplingTasks.js to create all required tasks.');
      } else {
        console.log('✅ All required resolution tasks are present.');
      }
      
      // Check task status
      for (const task of downsamplingTasks) {
        try {
          const runs = await tasksApi.getTasksIDRuns({ taskID: task.id });
          
          if (runs && runs.runs && runs.runs.length > 0) {
            const latestRun = runs.runs[0];
            console.log(`   - ${task.name}: Latest run ${latestRun.status} at ${new Date(latestRun.scheduledFor).toISOString()}`);
          } else {
            console.log(`   - ${task.name}: No runs yet`);
          }
        } catch (error) {
          console.log(`   - ${task.name}: Error fetching runs: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.log('❌ Failed to check downsampling tasks:', error.message);
  }
  
  console.log();
}

// Check API endpoints
function checkAPIEndpoints() {
  console.log('Checking API endpoints...');
  
  try {
    // Check routes file
    const routesPath = path.join(__dirname, '../../src/routes/index.js');
    
    if (fs.existsSync(routesPath)) {
      const routesContent = fs.readFileSync(routesPath, 'utf8');
      
      // Check for required endpoints
      const requiredEndpoints = [
        { name: 'GET /trades', pattern: /get\(['"]\/trades['"]/ },
        { name: 'POST /trades', pattern: /post\(['"]\/trades['"]/ },
        { name: 'GET /trades/generate', pattern: /get\(['"]\/trades\/generate['"]/ },
        { name: 'GET /trades/ohlc', pattern: /get\(['"]\/trades\/ohlc['"]/ },
        { name: 'GET /symbols', pattern: /get\(['"]\/symbols['"]/ }
      ];
      
      const missingEndpoints = [];
      
      for (const endpoint of requiredEndpoints) {
        if (!endpoint.pattern.test(routesContent)) {
          missingEndpoints.push(endpoint.name);
        }
      }
      
      if (missingEndpoints.length > 0) {
        console.log(`❌ Missing API endpoints: ${missingEndpoints.join(', ')}`);
      } else {
        console.log('✅ All required API endpoints are defined.');
      }
      
      // Check for real-time updates endpoint
      if (!/get\(['"]\/trades\/realtime['"]/.test(routesContent) && 
          !/get\(['"]\/trades\/stream['"]/.test(routesContent)) {
        console.log('⚠️ No real-time updates endpoint found.');
        console.log('   Consider implementing WebSocket support for real-time data updates.');
      }
    } else {
      console.log('❌ Routes file not found.');
    }
  } catch (error) {
    console.log('❌ Error checking API endpoints:', error.message);
  }
  
  console.log();
}

// Check frontend integration
function checkFrontendIntegration() {
  console.log('Checking frontend integration...');
  
  try {
    // Check for TradingView library
    const chartingLibPath = path.join(__dirname, '../../public/charting_library');
    
    if (fs.existsSync(chartingLibPath)) {
      console.log('✅ TradingView Charting Library directory exists.');
    } else {
      console.log('❌ TradingView Charting Library not found.');
      console.log('   Run setup-tradingview.js to install the library.');
    }
    
    // Check for custom datafeed implementation
    const appJsPath = path.join(__dirname, '../../public/js/app.js');
    
    if (fs.existsSync(appJsPath)) {
      const appJsContent = fs.readFileSync(appJsPath, 'utf8');
      
      if (/class\s+InfluxDBDatafeed/.test(appJsContent)) {
        console.log('✅ Custom datafeed implementation found.');
      } else {
        console.log('❌ Custom datafeed implementation not found.');
      }
      
      // Check for real-time updates in datafeed
      if (!/subscribeBars.*{[\s\S]*?}/.test(appJsContent) || 
          /We're not implementing real-time updates/.test(appJsContent)) {
        console.log('⚠️ Real-time updates not implemented in datafeed.');
        console.log('   Consider implementing WebSocket support for real-time data updates.');
      }
    } else {
      console.log('❌ Frontend application file not found.');
    }
  } catch (error) {
    console.log('❌ Error checking frontend integration:', error.message);
  }
  
  console.log();
}

// Check documentation
function checkDocumentation() {
  console.log('Checking documentation...');
  
  const docFiles = [
    { path: 'README.md', name: 'README' },
    { path: 'docs/setup.md', name: 'Setup Guide' },
    { path: 'docs/api.md', name: 'API Documentation' },
    { path: 'docs/downsampling.md', name: 'Downsampling Documentation' },
    { path: 'docs/performance.md', name: 'Performance Testing Results' }
  ];
  
  const missingDocs = [];
  
  for (const doc of docFiles) {
    const docPath = path.join(__dirname, '../../', doc.path);
    
    if (fs.existsSync(docPath)) {
      console.log(`✅ ${doc.name} exists.`);
    } else {
      console.log(`❌ ${doc.name} not found.`);
      missingDocs.push(doc.name);
    }
  }
  
  if (missingDocs.length > 0) {
    console.log('⚠️ Missing documentation:');
    for (const doc of missingDocs) {
      console.log(`   - ${doc}`);
    }
  }
  
  console.log();
}

// Check for missing implementations
function checkMissingImplementations() {
  console.log('Checking for missing implementations...');
  
  const missingImplementations = [];
  
  // Check for real-time updates
  try {
    const serverPath = path.join(__dirname, '../../src/server.js');
    const serverContent = fs.readFileSync(serverPath, 'utf8');
    
    if (!/(WebSocket|ws|socket\.io)/.test(serverContent)) {
      missingImplementations.push('Real-time updates using WebSockets');
    }
  } catch (error) {
    console.log('❌ Error checking for WebSocket implementation:', error.message);
  }
  
  // Check for administrative UI
  const adminUIPath = path.join(__dirname, '../../public/admin');
  if (!fs.existsSync(adminUIPath)) {
    missingImplementations.push('Administrative UI for monitoring tasks');
  }
  
  // Check for Docker setup
  const dockerfilePath = path.join(__dirname, '../../Dockerfile');
  const dockerComposePath = path.join(__dirname, '../../docker-compose.yml');
  
  if (!fs.existsSync(dockerfilePath) || !fs.existsSync(dockerComposePath)) {
    missingImplementations.push('Docker Compose setup for deployment');
  }
  
  // Check for monitoring endpoints
  try {
    const routesPath = path.join(__dirname, '../../src/routes/index.js');
    const routesContent = fs.readFileSync(routesPath, 'utf8');
    
    if (!/(health|status|metrics)/.test(routesContent)) {
      missingImplementations.push('Health check/monitoring endpoints');
    }
  } catch (error) {
    console.log('❌ Error checking for monitoring endpoints:', error.message);
  }
  
  if (missingImplementations.length > 0) {
    console.log('Missing implementations:');
    for (const impl of missingImplementations) {
      console.log(`   - ${impl}`);
    }
  } else {
    console.log('✅ No major missing implementations detected.');
  }
  
  console.log();
}

// Summarize findings
function summarizeFindings() {
  console.log('=== Summary ===');
  console.log('1. Check the tasks-plan.md file for a comprehensive list of tasks.');
  console.log('2. Focus on performance testing with large datasets (50M+ records).');
  console.log('3. Improve documentation, especially for the downsampling task system.');
  console.log('4. Consider implementing the missing features identified above.');
  console.log('5. Run this script periodically to track progress.');
  console.log('\nFor more details on the project status, run:');
  console.log('node src/scripts/verifyDownsamplingTasks.js');
  console.log('node src/scripts/checkDownsampledData.js');
  console.log('node src/scripts/benchmarkQueries.js');
}

// Execute the check function
checkProjectStatus()
  .then(() => console.log('\nProject status check completed.'))
  .catch(error => console.error('Error during project status check:', error));
