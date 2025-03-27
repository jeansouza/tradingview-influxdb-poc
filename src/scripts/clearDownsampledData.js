require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');
const { DeleteAPI } = require('@influxdata/influxdb-client-apis');

async function clearDownsampledData() {
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
  const influxDB = new InfluxDB({ url: config.url, token: config.token });
  
  // Create Delete API client
  const deleteApi = new DeleteAPI(influxDB);
  
  // Get organization ID
  const orgsApi = new (require('@influxdata/influxdb-client-apis').OrgsAPI)(influxDB);
  const orgs = await orgsApi.getOrgs({ org: config.org });
  if (!orgs || !orgs.orgs || orgs.orgs.length === 0) {
    throw new Error(`Organization '${config.org}' not found`);
  }
  const orgID = orgs.orgs[0].id;
  console.log(`Found organization ID: ${orgID}`);
  
  // Get bucket ID
  const bucketsApi = new (require('@influxdata/influxdb-client-apis').BucketsAPI)(influxDB);
  const buckets = await bucketsApi.getBuckets({ name: config.bucket });
  
  if (!buckets || !buckets.buckets || buckets.buckets.length === 0) {
    throw new Error(`Bucket '${config.bucket}' not found`);
  }
  
  const bucketID = buckets.buckets[0].id;
  console.log(`Found bucket ID: ${bucketID}`);
  
  // Define resolutions
  const resolutions = ['1m', '5m', '15m', '1h', '4h', '1d'];
  
  // Delete downsampled data for each resolution
  for (const resolution of resolutions) {
    try {
      console.log(`Deleting downsampled data for resolution: ${resolution}`);
      
      // Delete data with predicate
      const predicate = `_measurement="trade_ohlc_${resolution}"`;
      
      // Delete from the beginning of time to now
      const start = new Date(0); // 1970-01-01T00:00:00Z
      const stop = new Date(); // now
      
      await deleteApi.postDelete({
        orgID: orgID,
        bucketID: bucketID,
        body: {
          predicate: predicate,
          start: start,
          stop: stop
        }
      });
      
      console.log(`Successfully deleted downsampled data for resolution: ${resolution}`);
    } catch (error) {
      console.error(`Error deleting data for resolution ${resolution}:`, error);
    }
  }
  
  console.log('Downsampled data deletion process completed.');
}

clearDownsampledData()
  .then(() => console.log('Downsampled data clearing process completed.'))
  .catch(error => console.error('Error clearing downsampled data:', error));
