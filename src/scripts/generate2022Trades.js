require('dotenv').config();
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const { OrgsAPI, BucketsAPI, HealthAPI } = require('@influxdata/influxdb-client-apis');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

// Function to initialize the bucket
async function initializeBucket(influxDB, config) {
  try {
    if (config.verboseLogging) console.log('Initializing InfluxDB bucket...');
    
    // Create APIs
    const orgsAPI = new OrgsAPI(influxDB);
    const bucketsAPI = new BucketsAPI(influxDB);
    
    // Get organization ID
    if (config.verboseLogging) console.log(`Looking up organization: ${config.org}`);
    const orgs = await orgsAPI.getOrgs({ org: config.org });
    if (!orgs || !orgs.orgs || orgs.orgs.length === 0) {
      throw new Error(`Organization '${config.org}' not found`);
    }
    const orgID = orgs.orgs[0].id;
    if (config.verboseLogging) console.log(`Found organization ID: ${orgID}`);
    
    // Check if bucket exists
    if (config.verboseLogging) console.log(`Checking if bucket '${config.bucket}' exists...`);
    const buckets = await bucketsAPI.getBuckets({ name: config.bucket });
    
    // Create bucket if it doesn't exist
    if (!buckets || !buckets.buckets || buckets.buckets.length === 0) {
      console.log(`Bucket '${config.bucket}' not found. Creating it...`);
      
      // Create the bucket with infinite retention
      await bucketsAPI.postBuckets({
        body: {
          orgID,
          name: config.bucket,
          retentionRules: []  // Empty array means infinite retention
        }
      });
      
      console.log(`Bucket '${config.bucket}' created successfully.`);
    } else {
      if (config.verboseLogging) console.log(`Bucket '${config.bucket}' already exists.`);
    }
    
    return true;
  } catch (error) {
    console.error('Error initializing bucket:', error);
    throw error;
  }
}

// Function to check server health
async function checkServerHealth(config) {
  try {
    const healthClient = new InfluxDB({
      url: config.url,
      token: config.token,
      timeout: 10000
    });
    const healthApi = new HealthAPI(healthClient);
    const health = await healthApi.getHealth();
    return health.status === 'pass';
  } catch (error) {
    return false;
  }
}

/**
 * This script generates trade data for the entire year of 2022 with 200,000 trades per day.
 * Features:
 * - Parallel processing using worker threads for maximum performance
 * - Uniform distribution of trades throughout each day
 * - Ability to resume from where it stopped
 * - Optimized for performance with batch processing
 * - Progress tracking and estimation
 * - Improved timeout handling and retry logic
 */

// Worker thread code
if (!isMainThread) {
  const { 
    config, 
    day, 
    startIndex, 
    dayNumber, 
    daysInYear 
  } = workerData;
  
  // Function to generate trades for a specific day in a worker thread
  async function generateTradesForDayWorker() {
    try {
      // Calculate date for this day
      const date = new Date(config.year, 0, day); // Month is 0-indexed in JavaScript
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
      const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
      
      // Calculate time interval between trades (in milliseconds)
      const dayDuration = dayEnd.getTime() - dayStart.getTime();
      const interval = dayDuration / config.tradesPerDay;
      
      // Format date for display
      const dateStr = date.toISOString().split('T')[0];
      
      // Create InfluxDB client
      const influxDB = new InfluxDB({
        url: config.url,
        token: config.token,
        timeout: 120000, // 120 seconds timeout (increased from 60s)
        transportOptions: {
          maxRetries: 15,
          retryJitter: 1000, // Increased jitter
          minRetryDelay: 1000,
          maxRetryDelay: 30000, // Increased from 20000
          retryOnTimeout: true
        }
      });
      
      // Base price for this day (random starting point between 30k-40k)
      // Use a deterministic seed based on the day to ensure consistent prices if restarted
      const seed = day / daysInYear;
      const basePrice = 30000 + (seed * 10000);
      let currentPrice = basePrice;
      
      // Limits for price movement (15% variation from base price)
      const minPrice = basePrice * 0.85;
      const maxPrice = basePrice * 1.15;
      
      // Maximum percentage change per trade (0.1%)
      const maxPercentChange = 0.001;
      
      // Process in batches
      const remainingTrades = config.tradesPerDay - startIndex;
      const batches = Math.ceil(remainingTrades / config.batchSize);
      
      let tradesWritten = 0;
      let consecutiveTimeouts = 0;
      
      for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
        // Check server health before starting a new batch
        if (consecutiveTimeouts > 0) {
          const isHealthy = await checkServerHealth(config);
          if (!isHealthy) {
            console.log(`InfluxDB server is not healthy, waiting before retry...`);
            await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second pause
          }
        }
        
        // Calculate batch boundaries
        const batchStart = startIndex + (batchIndex * config.batchSize);
        const batchEnd = Math.min(batchStart + config.batchSize, config.tradesPerDay);
        const batchSize = batchEnd - batchStart;
        
        // Send progress update to main thread only if verbose logging is enabled
        if (config.verboseLogging) {
          parentPort.postMessage({
            type: 'progress',
            day,
            dayNumber,
            batchIndex,
            batchCount: batches,
            batchStart,
            batchEnd
          });
        }
        
        // Create a dedicated write API for this batch
        const writeApi = influxDB.getWriteApi(config.org, config.bucket, 'ns', {
          defaultTags: { source: 'trade-generator-2022' },
          maxRetries: 15,
          retryJitter: 1000, // Increased jitter
          minRetryDelay: 1000,
          maxRetryDelay: 30000, // Increased from 20000
          exponentialBase: 2,
          maxRetryTime: 900000, // 15 minutes (increased from 10 minutes)
          maxBufferLines: 10000, // Reduced from 20000
          flushInterval: 0, // Disable auto-flushing for manual control
          gzipThreshold: 1000 // Enable gzip compression for payloads larger than 1000 bytes
        });
        
        // Generate points for this batch
        for (let i = batchStart; i < batchEnd; i++) {
          // Calculate timestamp for this trade
          const timestamp = new Date(dayStart.getTime() + (i * interval));
          
          // Generate realistic price movement (random walk)
          const randomFactor = (Math.random() * 2) - 1.0; // Random value between -1.0 and 1.0
          const priceChange = currentPrice * maxPercentChange * randomFactor;
          currentPrice += priceChange;
          
          // Ensure price stays within the allowed range
          if (currentPrice < minPrice) {
            currentPrice = minPrice + Math.random() * (basePrice - minPrice);
          } else if (currentPrice > maxPrice) {
            currentPrice = maxPrice - Math.random() * (maxPrice - basePrice);
          }
          
          // Random trade size between 0.001 and 2 BTC
          const amount = 0.001 + Math.random() * 1.999;
          
          // Random side (buy/sell)
          const side = Math.random() > 0.5 ? 'buy' : 'sell';
          
          // Create point
          const point = new Point('trade')
            .tag('symbol', config.symbol)
            .tag('side', side)
            .floatField('price', currentPrice)
            .floatField('amount', amount)
            .timestamp(timestamp);
          
          writeApi.writePoint(point);
        }
        
        // Flush and close the write API with retries
        let success = false;
        let retries = 0;
        
        while (!success && retries < config.maxRetries) {
          try {
            // Send flush start message only if verbose logging is enabled
            if (config.verboseLogging) {
              parentPort.postMessage({
                type: 'flushStart',
                day,
                dayNumber,
                batchIndex,
                batchCount: batches
              });
            }
            
            const startFlush = Date.now();
            await writeApi.flush();
            const flushDuration = (Date.now() - startFlush) / 1000;
            
            // Send flush complete message only if verbose logging is enabled
            if (config.verboseLogging) {
              parentPort.postMessage({
                type: 'flushComplete',
                day,
                dayNumber,
                batchIndex,
                batchCount: batches,
                flushDuration
              });
            }
            
            await writeApi.close();
            
            // Send close complete message only if verbose logging is enabled
            if (config.verboseLogging) {
              parentPort.postMessage({
                type: 'closeComplete',
                day,
                dayNumber,
                batchIndex,
                batchCount: batches
              });
            }
            
            success = true;
            tradesWritten += batchSize;
            consecutiveTimeouts = 0; // Reset timeout counter on success
            
            // Send batch complete message only if verbose logging is enabled
            if (config.verboseLogging) {
              parentPort.postMessage({
                type: 'batchComplete',
                day,
                dayNumber,
                batchIndex,
                batchCount: batches,
                batchSize,
                tradesWritten,
                currentIndex: batchEnd
              });
            }
            
            // Add rate limiting delay between batches
            if (config.rateLimitDelay > 0) {
              await new Promise(resolve => setTimeout(resolve, config.rateLimitDelay));
            }
            
          } catch (error) {
            retries++;
            
            // Check if it's a timeout error
            if (error.message.includes('timeout')) {
              consecutiveTimeouts++;
              
              // Implement circuit breaker pattern
              if (consecutiveTimeouts >= config.circuitBreakerThreshold) {
                console.log(`Too many consecutive timeouts (${consecutiveTimeouts}), pausing for recovery...`);
                await new Promise(resolve => setTimeout(resolve, config.circuitBreakerPause));
                consecutiveTimeouts = 0; // Reset after pause
              }
            }
            
            // Send error message (always show errors)
            parentPort.postMessage({
              type: 'error',
              day,
              dayNumber,
              batchIndex,
              batchCount: batches,
              retries,
              maxRetries: config.maxRetries,
              error: error.message
            });
            
            if (retries < config.maxRetries) {
              // Implement progressive backoff with jitter
              const backoffDelay = config.retryDelay * Math.pow(2, retries - 1);
              const jitter = Math.random() * 2000; // Random jitter up to 2 seconds
              await new Promise(resolve => setTimeout(resolve, backoffDelay + jitter));
            } else {
              throw error;
            }
          }
        }
      }
      
      // Send day complete message (always show completed days)
      parentPort.postMessage({
        type: 'dayComplete',
        day,
        dayNumber,
        tradesWritten,
        date: dateStr
      });
      
      return tradesWritten;
    } catch (error) {
      // Send fatal error message (always show errors)
      parentPort.postMessage({
        type: 'fatalError',
        day,
        dayNumber,
        error: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }
  
  // Execute the worker function
  generateTradesForDayWorker()
    .then(() => {
      // Send completion message
      parentPort.postMessage({ type: 'workerComplete', day, dayNumber });
    })
    .catch(error => {
      // Send error message (always show errors)
      parentPort.postMessage({ 
        type: 'workerError', 
        day, 
        dayNumber, 
        error: error.message,
        stack: error.stack
      });
    });
  
} else {
  // Main thread code
  async function generate2022Trades() {
    try {
      // Configuration
      const config = {
        url: process.env.INFLUXDB_URL,
        token: process.env.INFLUXDB_TOKEN,
        org: process.env.INFLUXDB_ORG,
        bucket: process.env.INFLUXDB_BUCKET,
        symbol: 'BTCUSD',
        tradesPerDay: 200000,
        batchSize: 5000, // Reduced from 10000 to avoid timeouts
        year: 2022,
        checkpointFile: path.join(__dirname, 'checkpoint_2022_trades.json'),
        maxRetries: 5,
        retryDelay: 5000, // 5 seconds base delay
        maxConcurrentDays: Math.max(1, Math.min(os.cpus().length - 1, 2)), // Reduced from 4 to 2
        rateLimitDelay: 500, // 500ms pause between batches
        circuitBreakerThreshold: 3, // Number of consecutive timeouts before pausing
        circuitBreakerPause: 60000, // 1 minute pause after circuit breaker triggers
        verboseLogging: false // Only log errors and successful completions
      };

      console.log('=== 2022 Trade Generator ===');
      
      // Initialize bucket before starting generation
      const setupClient = new InfluxDB({
        url: config.url,
        token: config.token,
        timeout: 120000 // Increased from 60000 to 120000 (2 minutes)
      });
      
      try {
        await initializeBucket(setupClient, config);
      } catch (error) {
        console.error('Failed to initialize bucket. Please check your InfluxDB configuration.');
        return;
      }
      
      // Only show essential configuration information
      console.log(`Target: ${config.tradesPerDay.toLocaleString()} trades per day for the entire year ${config.year}`);
      console.log(`Symbol: ${config.symbol}`);
      console.log(`Batch size: ${config.batchSize.toLocaleString()} trades`);
      console.log(`Parallel workers: ${config.maxConcurrentDays}`);
      console.log(`Timeout avoidance: Enabled (rate limiting, circuit breaker, progressive backoff)`);
      console.log(`Verbose logging: ${config.verboseLogging ? 'Enabled' : 'Disabled (only errors and completed dates)'}`);

      // Calculate total days in the year (accounting for leap years)
      const isLeapYear = (config.year % 4 === 0 && config.year % 100 !== 0) || (config.year % 400 === 0);
      const daysInYear = isLeapYear ? 366 : 365;
      const totalTrades = daysInYear * config.tradesPerDay;

      console.log(`Days in ${config.year}: ${daysInYear}`);
      console.log(`Total trades to generate: ${totalTrades.toLocaleString()}`);

      // Load checkpoint if exists
      let pendingDays = [];
      let completedDays = [];
      let tradesGenerated = 0;

      try {
        if (fs.existsSync(config.checkpointFile)) {
          const checkpoint = JSON.parse(fs.readFileSync(config.checkpointFile, 'utf8'));
          pendingDays = checkpoint.pendingDays || [];
          completedDays = checkpoint.completedDays || [];
          tradesGenerated = checkpoint.tradesGenerated || 0;
          
          console.log(`Resuming from checkpoint:`);
          console.log(`- Completed days: ${completedDays.length}`);
          console.log(`- Pending days: ${pendingDays.length}`);
          console.log(`- Trades already generated: ${tradesGenerated.toLocaleString()}`);
        } else {
          console.log('No checkpoint found. Starting from the beginning of the year.');
          // Initialize pending days (all days of the year)
          pendingDays = Array.from({ length: daysInYear }, (_, i) => ({
            day: i + 1,
            startIndex: 0
          }));
        }
      } catch (error) {
        console.error('Error loading checkpoint:', error.message);
        console.log('Starting from the beginning of the year.');
        // Initialize pending days (all days of the year)
        pendingDays = Array.from({ length: daysInYear }, (_, i) => ({
          day: i + 1,
          startIndex: 0
        }));
      }

      // Function to save checkpoint
      function saveCheckpoint() {
        try {
          fs.writeFileSync(
            config.checkpointFile,
            JSON.stringify({
              pendingDays,
              completedDays,
              tradesGenerated,
              lastUpdated: new Date().toISOString()
            }, null, 2)
          );
        } catch (error) {
          console.error('Error saving checkpoint:', error.message);
        }
      }

      // Main execution loop
      const startTime = Date.now();
      
      // Track active workers
      const activeWorkers = new Map();
    
      // Process days in parallel
      async function processDays() {
        // Save checkpoint periodically
        const checkpointInterval = setInterval(() => {
          saveCheckpoint();
        }, 60000); // Every minute
      
        try {
          while (pendingDays.length > 0) {
            // Check server health before starting new workers
            const isHealthy = await checkServerHealth(config);
            if (!isHealthy) {
              console.log('InfluxDB server is not healthy, waiting before starting new workers...');
              await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second pause
              continue;
            }
            
            // Fill worker slots up to max concurrent days
            while (activeWorkers.size < config.maxConcurrentDays && pendingDays.length > 0) {
              const dayInfo = pendingDays.shift();
              const { day, startIndex } = dayInfo;
              
              const dateStr = new Date(config.year, 0, day).toISOString().split('T')[0];
              console.log(`\nStarting worker for day ${day} of ${daysInYear} (${dateStr})`);
              if (startIndex > 0) {
                console.log(`Resuming from trade ${startIndex.toLocaleString()} of ${config.tradesPerDay.toLocaleString()}`);
              }
              
              // Create worker
              const worker = new Worker(__filename, {
                workerData: {
                  config,
                  day,
                  startIndex,
                  dayNumber: day,
                  daysInYear
                }
              });
              
              // Set up message handler
              worker.on('message', (message) => {
                switch (message.type) {
                  case 'progress':
                    // Only log if verbose logging is enabled
                    if (config.verboseLogging) {
                      console.log(`Day ${message.dayNumber}: Processing batch ${message.batchIndex + 1}/${message.batchCount} (trades ${message.batchStart.toLocaleString()} to ${message.batchEnd.toLocaleString()})`);
                    }
                    break;
                    
                  case 'flushStart':
                    // Only log if verbose logging is enabled
                    if (config.verboseLogging) {
                      console.log(`Day ${message.dayNumber}: Flushing batch ${message.batchIndex + 1}/${message.batchCount}...`);
                    }
                    break;
                    
                  case 'flushComplete':
                    // Only log if verbose logging is enabled
                    if (config.verboseLogging) {
                      console.log(`Day ${message.dayNumber}: Flush completed in ${message.flushDuration.toFixed(2)} seconds`);
                    }
                    break;
                    
                  case 'closeComplete':
                    // Only log if verbose logging is enabled
                    if (config.verboseLogging) {
                      console.log(`Day ${message.dayNumber}: Write API closed successfully`);
                    }
                    break;
                    
                  case 'batchComplete':
                    // Only log if verbose logging is enabled
                    if (config.verboseLogging) {
                      console.log(`Day ${message.dayNumber}: Batch ${message.batchIndex + 1}/${message.batchCount} completed (${message.batchSize.toLocaleString()} trades)`);
                    }
                    
                    // Update pending days if this worker is interrupted
                    const workerInfo = activeWorkers.get(message.day);
                    if (workerInfo) {
                      workerInfo.currentIndex = message.currentIndex;
                      workerInfo.tradesWritten = message.tradesWritten;
                    }
                    
                    // Update total trades generated
                    tradesGenerated += message.batchSize;
                    
                    // Calculate and display progress only if verbose logging is enabled
                    if (config.verboseLogging) {
                      const progress = (tradesGenerated / totalTrades) * 100;
                      console.log(`Overall progress: ${tradesGenerated.toLocaleString()} / ${totalTrades.toLocaleString()} trades (${progress.toFixed(2)}%)`);
                      
                      // Calculate estimated time remaining
                      const elapsedMs = Date.now() - startTime;
                      const msPerTrade = elapsedMs / tradesGenerated;
                      const remainingTrades = totalTrades - tradesGenerated;
                      const estimatedRemainingMs = msPerTrade * remainingTrades;
                      
                      const remainingHours = Math.floor(estimatedRemainingMs / 3600000);
                      const remainingMinutes = Math.floor((estimatedRemainingMs % 3600000) / 60000);
                      
                      console.log(`Estimated time remaining: ${remainingHours} hours, ${remainingMinutes} minutes`);
                    }
                    break;
                    
                  case 'error':
                    // Always log errors
                    console.error(`Day ${message.dayNumber}: Error in batch ${message.batchIndex + 1} (attempt ${message.retries}/${message.maxRetries}): ${message.error}`);
                    break;
                    
                  case 'dayComplete':
                    // Always log completed days
                    console.log(`\nDay ${message.dayNumber} (${message.date}) completed successfully (${message.tradesWritten.toLocaleString()} trades)`);
                    break;
                    
                  case 'fatalError':
                    // Always log errors
                    console.error(`Day ${message.dayNumber}: Fatal error: ${message.error}`);
                    console.error(message.stack);
                    
                    // Add day back to pending with current progress
                    const errorWorkerInfo = activeWorkers.get(message.day);
                    if (errorWorkerInfo && errorWorkerInfo.currentIndex < config.tradesPerDay) {
                      pendingDays.push({
                        day: message.day,
                        startIndex: errorWorkerInfo.currentIndex || 0
                      });
                      console.log(`Day ${message.dayNumber} added back to pending queue at index ${errorWorkerInfo.currentIndex || 0}`);
                    }
                    break;
                    
                  case 'workerComplete':
                    // Only log if verbose logging is enabled
                    if (config.verboseLogging) {
                      console.log(`Worker for day ${message.dayNumber} completed successfully`);
                    }
                    
                    // Add to completed days
                    completedDays.push(message.day);
                    
                    // Remove from active workers
                    activeWorkers.delete(message.day);
                    break;
                    
                  case 'workerError':
                    // Always log errors
                    console.error(`Worker for day ${message.dayNumber} failed with error: ${message.error}`);
                    console.error(message.stack);
                    
                    // Add day back to pending with current progress
                    const failedWorkerInfo = activeWorkers.get(message.day);
                    if (failedWorkerInfo && failedWorkerInfo.currentIndex < config.tradesPerDay) {
                      pendingDays.push({
                        day: message.day,
                        startIndex: failedWorkerInfo.currentIndex || 0
                      });
                      console.log(`Day ${message.dayNumber} added back to pending queue at index ${failedWorkerInfo.currentIndex || 0}`);
                    }
                    
                    // Remove from active workers
                    activeWorkers.delete(message.day);
                    break;
                }
              });
              
              // Handle worker exit
              worker.on('exit', (code) => {
                if (code !== 0) {
                  console.error(`Worker for day ${day} exited with code ${code}`);
                  
                  // Add day back to pending with current progress
                  const exitedWorkerInfo = activeWorkers.get(day);
                  if (exitedWorkerInfo && exitedWorkerInfo.currentIndex < config.tradesPerDay) {
                    pendingDays.push({
                      day,
                      startIndex: exitedWorkerInfo.currentIndex || 0
                    });
                    console.log(`Day ${day} added back to pending queue at index ${exitedWorkerInfo.currentIndex || 0}`);
                  }
                }
                
                // Remove from active workers
                activeWorkers.delete(day);
              });
              
              // Handle worker error
              worker.on('error', (error) => {
                console.error(`Worker for day ${day} error:`, error);
                
                // Add day back to pending with current progress
                const errorWorkerInfo = activeWorkers.get(day);
                if (errorWorkerInfo && errorWorkerInfo.currentIndex < config.tradesPerDay) {
                  pendingDays.push({
                    day,
                    startIndex: errorWorkerInfo.currentIndex || 0
                  });
                  console.log(`Day ${day} added back to pending queue at index ${errorWorkerInfo.currentIndex || 0}`);
                }
                
                // Remove from active workers
                activeWorkers.delete(day);
              });
              
              // Add to active workers
              activeWorkers.set(day, {
                worker,
                day,
                startIndex,
                currentIndex: startIndex,
                tradesWritten: 0
              });
              
              // Add delay between starting workers to prevent overwhelming the server
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          
            // Wait for a worker to complete
            if (activeWorkers.size >= config.maxConcurrentDays || (pendingDays.length === 0 && activeWorkers.size > 0)) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Save checkpoint
            saveCheckpoint();
          }
        
          // Wait for all active workers to complete
          while (activeWorkers.size > 0) {
            console.log(`Waiting for ${activeWorkers.size} active workers to complete...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            saveCheckpoint();
          }
        
          clearInterval(checkpointInterval);
          
          console.log('\n=== Generation Complete ===');
          console.log(`Generated ${tradesGenerated.toLocaleString()} trades for ${config.year}`);
          
          // Clean up checkpoint file
          if (fs.existsSync(config.checkpointFile)) {
            fs.unlinkSync(config.checkpointFile);
            console.log('Checkpoint file removed as generation is complete.');
          }
          
          const totalDurationMs = Date.now() - startTime;
          const hours = Math.floor(totalDurationMs / 3600000);
          const minutes = Math.floor((totalDurationMs % 3600000) / 60000);
          const seconds = Math.floor((totalDurationMs % 60000) / 1000);
          
          console.log(`Total execution time: ${hours}h ${minutes}m ${seconds}s`);
          
        } catch (error) {
          clearInterval(checkpointInterval);
          console.error('Error during trade generation:', error);
          console.log(`Generation stopped. Use the checkpoint file to resume later.`);
          
          // Save final checkpoint
          saveCheckpoint();
        }
      }
      
      // Start processing
      await processDays();
    } catch (error) {
      console.error('Error in generate2022Trades:', error);
    }
  }

  // Run the function
  generate2022Trades()
    .then(() => console.log('Script execution completed.'))
    .catch(error => console.error('Unhandled error in script:', error));
}
