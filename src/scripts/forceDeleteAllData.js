require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');
const { DeleteAPI, BucketsAPI } = require('@influxdata/influxdb-client-apis');

async function forceDeleteAllData() {
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
    timeout: 300000, // 5 minutes timeout
    transportOptions: {
      maxRetries: 10,
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
    // Get the bucket ID
    const buckets = await bucketsApi.getBuckets({ name: bucket });
    if (!buckets || !buckets.buckets || buckets.buckets.length === 0) {
      throw new Error(`Bucket '${bucket}' not found`);
    }
    
    const bucketID = buckets.buckets[0].id;
    console.log(`Found bucket ID: ${bucketID}`);
    
    // Delete all data in the bucket without any predicate
    console.log(`Deleting ALL data from bucket '${bucket}'...`);
    
    try {
      // Use a very wide time range to ensure all data is deleted
      await deleteApi.postDelete({
        org,
        bucket,
        body: {
          start: '1970-01-01T00:00:00Z',
          stop: '2030-01-01T00:00:00Z'
          // No predicate means delete everything
        }
      });
      
      console.log(`Successfully deleted all data from bucket '${bucket}'`);
    } catch (error) {
      console.error('Error deleting all data:', error);
      
      // Try an alternative approach if the first one fails
      console.log('Trying alternative approach...');
      
      // Try to delete with specific measurements
      const measurements = ['trade', 'trades', 'downsample_1m', 'downsample_5m', 
                           'downsample_15m', 'downsample_1h', 'downsample_4h', 'downsample_1d'];
      
      for (const measurement of measurements) {
        try {
          console.log(`Deleting data for measurement '${measurement}'...`);
          
          await deleteApi.postDelete({
            org,
            bucket,
            body: {
              start: '1970-01-01T00:00:00Z',
              stop: '2030-01-01T00:00:00Z',
              predicate: `_measurement="${measurement}"`
            }
          });
          
          console.log(`Successfully deleted data for measurement '${measurement}'`);
        } catch (measurementError) {
          console.error(`Error deleting data for measurement '${measurement}':`, measurementError);
        }
      }
    }
    
    console.log('Data deletion process completed.');
  } catch (error) {
    console.error('Error in deletion process:', error);
  }
}

forceDeleteAllData()
  .then(() => console.log('Force database clearing process completed.'))
  .catch(error => console.error('Error in force database clearing process:', error));
