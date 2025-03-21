require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');
const { DeleteAPI, BucketsAPI } = require('@influxdata/influxdb-client-apis');

async function clearDatabase() {
  const { url, token, org, bucket } = {
    url: process.env.INFLUXDB_URL,
    token: process.env.INFLUXDB_TOKEN,
    org: process.env.INFLUXDB_ORG,
    bucket: process.env.INFLUXDB_BUCKET
  };

  console.log('Connecting to InfluxDB at:', url);
  console.log('Using organization:', org);
  console.log('Using bucket:', bucket);

  // Create InfluxDB client with increased timeout
  const influxDB = new InfluxDB({ 
    url, 
    token,
    timeout: 120000, // 2 minutes timeout
    transportOptions: {
      maxRetries: 5,
      retryJitter: 500,
      minRetryDelay: 1000,
      maxRetryDelay: 15000,
      retryOnTimeout: true
    }
  });
  
  // Create API clients
  const deleteApi = new DeleteAPI(influxDB);
  const bucketsApi = new BucketsAPI(influxDB);

  try {
    // Try to delete data in smaller time chunks to avoid timeout
    console.log(`Attempting to delete data from bucket '${bucket}' in chunks...`);
    
    // Get the bucket ID
    const buckets = await bucketsApi.getBuckets({ name: bucket });
    if (!buckets || !buckets.buckets || buckets.buckets.length === 0) {
      throw new Error(`Bucket '${bucket}' not found`);
    }
    
    const bucketID = buckets.buckets[0].id;
    console.log(`Found bucket ID: ${bucketID}`);
    
    // Delete data in chunks by year
    const years = [
      { start: '2022-01-01T00:00:00Z', stop: '2022-12-31T23:59:59Z' },
      { start: '2023-01-01T00:00:00Z', stop: '2023-12-31T23:59:59Z' },
      { start: '2024-01-01T00:00:00Z', stop: '2024-12-31T23:59:59Z' },
      { start: '2025-01-01T00:00:00Z', stop: new Date().toISOString() }
    ];
    
    for (const period of years) {
      try {
        console.log(`Deleting data from ${period.start} to ${period.stop}...`);
        
        await deleteApi.postDelete({
          org,
          bucket,
          body: {
            start: period.start,
            stop: period.stop,
            predicate: '_measurement="trade"'
          }
        });
        
        console.log(`Successfully deleted data from ${period.start} to ${period.stop}`);
      } catch (chunkError) {
        console.error(`Error deleting data for period ${period.start} to ${period.stop}:`, chunkError);
      }
    }
    
    console.log('Data deletion process completed.');
  } catch (error) {
    console.error('Error in deletion process:', error);
  }
}

clearDatabase()
  .then(() => console.log('Database clearing process completed.'))
  .catch(error => console.error('Error in database clearing process:', error));
