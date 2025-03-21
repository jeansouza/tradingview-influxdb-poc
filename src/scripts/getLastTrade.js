#!/usr/bin/env node
/**
 * Script to get the last trade created in InfluxDB
 * Usage: node src/scripts/getLastTrade.js [symbol]
 * Example: node src/scripts/getLastTrade.js BTCUSD
 */

// Load environment variables from .env file
require('dotenv').config();

const { influxDB, queryApi, config } = require('../config/influxdb');

// Get the symbol from command line arguments or use default
const symbol = process.argv[2] || 'BTCUSD';

async function getLastTrade(symbol) {
  console.log(`Finding the last trade for ${symbol}...`);
  
  // Query to fetch the latest trade
  const fluxQuery = `
    from(bucket: "${config.bucket}")
      |> range(start: 0)
      |> filter(fn: (r) => r._measurement == "trade")
      |> filter(fn: (r) => r.symbol == "${symbol}")
      |> last()
      |> pivot(rowKey:["_time", "symbol", "side"], columnKey: ["_field"], valueColumn: "_value")
  `;

  console.log('Executing query:', fluxQuery);

  try {
    let lastTrade = null;
    
    for await (const { values, tableMeta } of queryApi.iterateRows(fluxQuery)) {
      const o = tableMeta.toObject(values);
      lastTrade = {
        time: new Date(o._time),
        symbol: o.symbol,
        side: o.side,
        price: o.price,
        amount: o.amount
      };
    }
    
    if (lastTrade) {
      console.log('\nLast Trade Details:');
      console.log('===================');
      console.log(`Symbol: ${lastTrade.symbol}`);
      console.log(`Time: ${lastTrade.time.toISOString()}`);
      console.log(`Side: ${lastTrade.side}`);
      console.log(`Price: ${lastTrade.price}`);
      console.log(`Amount: ${lastTrade.amount}`);
      console.log('===================');
      return lastTrade;
    } else {
      console.log(`No trades found for symbol ${symbol}`);
      return null;
    }
  } catch (error) {
    console.error('Error querying last trade:', error);
    throw error;
  }
}

// Execute the function and handle the promise
getLastTrade(symbol)
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
