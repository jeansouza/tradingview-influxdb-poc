require('dotenv').config();
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

async function testBatchWrite() {
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
  
  // Create test trades
  const trades = [];
  const baseTimestamp = new Date('2022-01-01T00:00:00Z').getTime();
  const timeInterval = 2000; // 2 seconds in milliseconds
  
  for (let i = 0; i < 10; i++) {
    trades.push({
      symbol: 'BTCUSD',
      side: i % 2 === 0 ? 'buy' : 'sell',
      price: 35000 + (i * 10),
      amount: 1 + (i * 0.1),
      timestamp: new Date(baseTimestamp + (i * timeInterval))
    });
  }
  
  console.log('Created test trades:', trades);
  
  // Function to write trades directly to InfluxDB
  const writeTradesBatch = async (trades) => {
    if (!trades || trades.length === 0) {
      console.log('No trades to write');
      return;
    }
    
    console.log(`Writing ${trades.length} trades directly to InfluxDB...`);
    
    // Create a new write API for this batch
    const writeApi = influxDB.getWriteApi(org, bucket, 'ns');
    
    try {
      // Add points to the write API
      trades.forEach(trade => {
        const point = new Point('trade')
          .tag('symbol', trade.symbol)
          .tag('side', trade.side)
          .floatField('price', trade.price)
          .floatField('amount', trade.amount)
          .timestamp(trade.timestamp);
        
        writeApi.writePoint(point);
      });
      
      // Flush and close the write API
      console.log('Flushing data...');
      await writeApi.flush();
      
      console.log('Closing write API...');
      await writeApi.close();
      
      console.log(`Successfully wrote ${trades.length} trades to InfluxDB`);
    } catch (error) {
      console.error('Error writing trades to InfluxDB:', error);
      try {
        await writeApi.close();
      } catch (closeError) {
        console.error('Error closing write API:', closeError);
      }
      throw error;
    }
  };
  
  try {
    await writeTradesBatch(trades);
    
    // Verify the records were written
    console.log('Verifying records were written...');
    const queryApi = influxDB.getQueryApi(org);
    const query = `
      from(bucket: "${bucket}")
        |> range(start: 2022-01-01T00:00:00Z)
        |> filter(fn: (r) => r._measurement == "trade")
        |> limit(n: 10)
    `;
    
    const result = await queryApi.collectRows(query);
    if (result.length > 0) {
      console.log(`Verification successful. Found ${result.length} records.`);
      console.log('First record:', result[0]);
    } else {
      console.log('Verification failed. No records found.');
    }
  } catch (error) {
    console.error('Error in test:', error);
  }
}

testBatchWrite()
  .then(() => console.log('Test completed.'))
  .catch(error => console.error('Error in test:', error));
