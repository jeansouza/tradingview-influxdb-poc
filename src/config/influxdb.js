const { InfluxDB } = require('@influxdata/influxdb-client');

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

// Create InfluxDB client with retry options
const influxDB = new InfluxDB({
  url: config.url,
  token: config.token,
  timeout: 120000, // 120 seconds timeout (increased from 60s)
  transportOptions: {
    maxRetries: 15, // Increased from 10
    retryJitter: 500,
    minRetryDelay: 1000,
    maxRetryDelay: 20000, // Increased from 15000
    retryOnTimeout: true
  }
});

// Log connection status
console.log('InfluxDB client created with timeout:', 120000, 'ms');

// Create bucket if it doesn't exist
const { OrgsAPI, BucketsAPI } = require('@influxdata/influxdb-client-apis');
const orgsAPI = new OrgsAPI(influxDB);
const bucketsAPI = new BucketsAPI(influxDB);

// Function to initialize the bucket
async function initializeBucket() {
  try {
    // Get organization ID
    const orgs = await orgsAPI.getOrgs({ org: config.org });
    if (!orgs || !orgs.orgs || orgs.orgs.length === 0) {
      throw new Error(`Organization '${config.org}' not found`);
    }
    const orgID = orgs.orgs[0].id;
    
    // Check if bucket exists
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
      console.log(`Bucket '${config.bucket}' already exists.`);
    }
  } catch (error) {
    console.error('Error initializing bucket:', error);
    throw error;
  }
}

// Initialize bucket
initializeBucket()
  .catch(error => {
    console.error('Failed to initialize bucket:', error);
    process.exit(1);
  });

// Create write API
const writeApi = influxDB.getWriteApi(config.org, config.bucket, 'ns', {
  defaultTags: { source: 'tradingview-poc' },
  maxRetries: 15, // Increased from 10
  retryJitter: 500,
  minRetryDelay: 1000,
  maxRetryDelay: 20000, // Increased from 15000
  exponentialBase: 2,
  maxRetryTime: 600000, // 10 minutes (increased from 5 minutes)
  maxBufferLines: 2000, // Reduced from 5000 to prevent buffer overflow
  flushInterval: 1000 // Flush every 1 second (reduced from 2 seconds)
});

console.log('Write API created with flush interval:', 1000, 'ms');

// Create query API
const queryApi = influxDB.getQueryApi(config.org);

// Export the client, APIs, and configuration
module.exports = {
  influxDB,
  writeApi,
  queryApi,
  config
};
