require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');

async function checkInfluxDB() {
  const { url, token, org, bucket } = {
    url: process.env.INFLUXDB_URL,
    token: process.env.INFLUXDB_TOKEN,
    org: process.env.INFLUXDB_ORG,
    bucket: process.env.INFLUXDB_BUCKET
  };

  console.log('Connecting to InfluxDB at:', url);
  console.log('Using organization:', org);
  console.log('Using bucket:', bucket);

  // Create InfluxDB client
  const influxDB = new InfluxDB({ url, token });
  const queryApi = influxDB.getQueryApi(org);
  
  // Simple query to check if there's any data in the bucket
  const query = `
    from(bucket: "${bucket}")
      |> range(start: 2000-01-01T00:00:00Z, stop: 2100-01-01T00:00:00Z)
      |> filter(fn: (r) => r._measurement == "trade")
      |> limit(n: 10)
  `;
  
  console.log('Executing query to check if there is any data in InfluxDB...');
  
  try {
    const result = await queryApi.collectRows(query);
    console.log('Query result:', result);
    
    if (result.length > 0) {
      console.log(`Found ${result.length} records in the database.`);
      console.log('First record:', JSON.stringify(result[0], null, 2));
    } else {
      console.log('No data found in the database.');
    }
  } catch (error) {
    console.error('Error querying InfluxDB:', error);
  }
}

checkInfluxDB()
  .then(() => console.log('InfluxDB check completed.'))
  .catch(error => console.error('Error in InfluxDB check:', error));
