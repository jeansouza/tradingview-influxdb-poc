require('dotenv').config();
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

async function writeTestRecord() {
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
  
  // Create write API
  const writeApi = influxDB.getWriteApi(org, bucket, 'ns');
  
  try {
    // Create a test point
    const point = new Point('trade')
      .tag('symbol', 'BTCUSD')
      .tag('side', 'buy')
      .floatField('price', 35000.50)
      .floatField('amount', 1.5)
      .timestamp(new Date());
    
    console.log('Writing test point to InfluxDB...');
    writeApi.writePoint(point);
    
    console.log('Flushing data...');
    await writeApi.flush();
    
    console.log('Test record written successfully.');
    
    // Close the write API
    console.log('Closing write API...');
    await writeApi.close();
    console.log('Write API closed.');
    
    // Verify the record was written
    console.log('Verifying record was written...');
    const queryApi = influxDB.getQueryApi(org);
    const query = `
      from(bucket: "${bucket}")
        |> range(start: -1h)
        |> filter(fn: (r) => r._measurement == "trade")
        |> limit(n: 1)
    `;
    
    const result = await queryApi.collectRows(query);
    if (result.length > 0) {
      console.log('Verification successful. Found record:', result[0]);
    } else {
      console.log('Verification failed. No record found.');
    }
  } catch (error) {
    console.error('Error writing test record:', error);
  }
}

writeTestRecord()
  .then(() => console.log('Test completed.'))
  .catch(error => console.error('Error in test:', error));
