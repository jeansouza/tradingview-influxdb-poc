require('dotenv').config();
const { InfluxDB } = require('@influxdata/influxdb-client');

async function monitorTradesRealtime() {
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
  
  // Function to get the latest trades
  async function getLatestTrades() {
    const query = `
      from(bucket: "${bucket}")
        |> range(start: -10s)
        |> filter(fn: (r) => r._measurement == "trade")
        |> filter(fn: (r) => r._field == "price")
        |> sort(columns: ["_time"], desc: true)
        |> limit(n: 5)
    `;
    
    try {
      const result = await queryApi.collectRows(query);
      return result;
    } catch (error) {
      console.error('Error querying latest trades:', error);
      return [];
    }
  }
  
  // Function to count trades
  async function countTrades() {
    const query = `
      from(bucket: "${bucket}")
        |> range(start: 2022-01-01T00:00:00Z)
        |> filter(fn: (r) => r._measurement == "trade")
        |> filter(fn: (r) => r._field == "price")
        |> count()
        |> yield(name: "count")
    `;
    
    try {
      const result = await queryApi.collectRows(query);
      return result.length > 0 ? result[0]._value : 0;
    } catch (error) {
      console.error('Error counting trades:', error);
      return 0;
    }
  }
  
  // Initial count
  let previousCount = await countTrades();
  console.log(`Initial trade count: ${previousCount}`);
  
  // Monitor trades every 2 seconds
  console.log('Starting real-time monitoring...');
  console.log('Press Ctrl+C to stop monitoring.');
  console.log('-------------------------------------------');
  
  const intervalId = setInterval(async () => {
    // Get current count
    const currentCount = await countTrades();
    
    // Check if count has changed
    if (currentCount !== previousCount) {
      console.log(`\n${new Date().toISOString()} - Trade count changed: ${previousCount} -> ${currentCount} (${currentCount - previousCount} new trades)`);
      
      // Get latest trades
      const latestTrades = await getLatestTrades();
      
      if (latestTrades.length > 0) {
        console.log('Latest trades:');
        latestTrades.forEach((trade, i) => {
          console.log(`Trade ${i + 1}:`);
          console.log(`- Time: ${new Date(trade._time).toISOString()}`);
          console.log(`- Price: ${trade._value}`);
          console.log(`- Symbol: ${trade.symbol}`);
          console.log(`- Side: ${trade.side}`);
          console.log('---');
        });
      }
      
      // Update previous count
      previousCount = currentCount;
    }
  }, 2000);
  
  // Handle Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(intervalId);
    console.log('\nMonitoring stopped.');
    process.exit(0);
  });
}

monitorTradesRealtime()
  .catch(error => console.error('Error in monitoring:', error));
