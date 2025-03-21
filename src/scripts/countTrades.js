require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');

async function countAllTrades() {
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

  // Most efficient query to count all trades
  // This query counts all price fields (one per trade) in the trade measurement
  const countQuery = `
    from(bucket: "${bucket}")
      |> range(start: 0) // Count from the beginning of time
      |> filter(fn: (r) => r._measurement == "trade")
      |> filter(fn: (r) => r._field == "price") // Count only price fields to avoid double counting
      |> group()
      |> count()
      |> yield(name: "count")
  `;

  console.log('Executing query to count all trades...');

  try {
    const result = await queryApi.collectRows(countQuery);
    
    if (result.length > 0) {
      const totalTrades = result[0]._value;
      console.log(`Total trades in database: ${totalTrades.toLocaleString()}`);
      return totalTrades;
    } else {
      console.log('No trades found in the database.');
      return 0;
    }
  } catch (error) {
    console.error('Error counting trades:', error);
    throw error;
  }
}

// Execute the count function
countAllTrades()
  .then(() => console.log('Trade count completed.'))
  .catch(error => console.error('Error counting trades:', error));
