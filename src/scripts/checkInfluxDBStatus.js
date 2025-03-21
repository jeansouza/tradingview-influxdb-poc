require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');
const { OrgsAPI, BucketsAPI } = require('@influxdata/influxdb-client-apis');

async function checkInfluxDBStatus() {
  const { url, token, org, bucket } = {
    url: process.env.INFLUXDB_URL,
    token: process.env.INFLUXDB_TOKEN,
    org: process.env.INFLUXDB_ORG,
    bucket: process.env.INFLUXDB_BUCKET
  };

  console.log('Connecting to InfluxDB at:', url);
  console.log('Using organization:', org);
  console.log('Using bucket:', bucket);

  try {
    // Create InfluxDB client
    const influxDB = new InfluxDB({ url, token });
    
    // Check if the server is reachable
    console.log('Checking if InfluxDB server is reachable...');
    const orgsAPI = new OrgsAPI(influxDB);
    const orgs = await orgsAPI.getOrgs({ org });
    
    if (orgs && orgs.orgs) {
      console.log('InfluxDB server is reachable.');
      console.log('Found organizations:', orgs.orgs.map(o => o.name).join(', '));
      
      // Check if the organization exists
      const orgExists = orgs.orgs.some(o => o.name === org);
      if (orgExists) {
        console.log(`Organization '${org}' exists.`);
      } else {
        console.log(`Organization '${org}' does not exist.`);
        return;
      }
      
      // Check if the bucket exists
      console.log('Checking if bucket exists...');
      const bucketsAPI = new BucketsAPI(influxDB);
      const buckets = await bucketsAPI.getBuckets({ org });
      
      if (buckets && buckets.buckets) {
        console.log('Found buckets:', buckets.buckets.map(b => b.name).join(', '));
        
        const bucketExists = buckets.buckets.some(b => b.name === bucket);
        if (bucketExists) {
          console.log(`Bucket '${bucket}' exists.`);
          
          // Check bucket details
          const bucketInfo = buckets.buckets.find(b => b.name === bucket);
          console.log('Bucket details:', {
            id: bucketInfo.id,
            name: bucketInfo.name,
            orgID: bucketInfo.orgID,
            retentionRules: bucketInfo.retentionRules
          });
          
          // Check if the bucket has retention rules that might be deleting data
          if (bucketInfo.retentionRules && bucketInfo.retentionRules.length > 0) {
            console.log('Bucket has retention rules:');
            bucketInfo.retentionRules.forEach((rule, i) => {
              console.log(`Rule ${i + 1}:`, rule);
              if (rule.everySeconds && rule.everySeconds < 86400) { // Less than a day
                console.log(`WARNING: Retention rule ${i + 1} is set to delete data after ${rule.everySeconds} seconds, which is less than a day.`);
              }
            });
          } else {
            console.log('Bucket has no retention rules.');
          }
        } else {
          console.log(`Bucket '${bucket}' does not exist.`);
        }
      } else {
        console.log('No buckets found.');
      }
    } else {
      console.log('No organizations found.');
    }
  } catch (error) {
    console.error('Error checking InfluxDB status:', error);
  }
}

checkInfluxDBStatus()
  .then(() => console.log('InfluxDB status check completed.'))
  .catch(error => console.error('Error in InfluxDB status check:', error));
