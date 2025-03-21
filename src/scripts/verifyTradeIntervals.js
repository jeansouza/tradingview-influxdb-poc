#!/usr/bin/env node
/**
 * Script to verify that all trades respect the 2-second interval
 * starting from 2022-01-01T00:00:00.000Z
 */

// Load environment variables from .env file
require('dotenv').config();

const { influxDB, queryApi, config } = require('../config/influxdb');

async function verifyTradeIntervals() {
  console.log('Verifying trade intervals...');
  
  // Expected start timestamp
  const expectedStartTimestamp = new Date('2022-01-01T00:00:00.000Z').getTime();
  console.log(`Expected start timestamp: ${new Date(expectedStartTimestamp).toISOString()}`);
  
  // Expected interval in milliseconds
  const expectedInterval = 2000; // 2 seconds
  
  // Query to fetch all trade timestamps in ascending order
  const fluxQuery = `
    from(bucket: "${config.bucket}")
      |> range(start: 0)
      |> filter(fn: (r) => r._measurement == "trade")
      |> filter(fn: (r) => r.symbol == "BTCUSD")
      |> filter(fn: (r) => r._field == "price")
      |> sort(columns: ["_time"], desc: false)
  `;
  
  console.log('Executing query to fetch all trade timestamps...');
  
  try {
    let previousTimestamp = null;
    let count = 0;
    let validIntervalCount = 0;
    let invalidIntervalCount = 0;
    let firstTimestamp = null;
    let lastTimestamp = null;
    
    // Process timestamps in batches to avoid memory issues
    for await (const { values, tableMeta } of queryApi.iterateRows(fluxQuery)) {
      const o = tableMeta.toObject(values);
      const timestamp = new Date(o._time).getTime();
      
      // Store the first timestamp we encounter
      if (count === 0) {
        firstTimestamp = timestamp;
        console.log(`First trade timestamp: ${new Date(firstTimestamp).toISOString()}`);
        
        // Check if the first timestamp matches the expected start
        if (firstTimestamp === expectedStartTimestamp) {
          console.log('✅ First timestamp matches expected start time');
        } else {
          console.log(`❌ First timestamp does not match expected start time. Difference: ${(firstTimestamp - expectedStartTimestamp) / 1000} seconds`);
        }
      }
      
      // Check if this timestamp is exactly on a 2-second boundary from the start
      const expectedExactTimestamp = expectedStartTimestamp + (count * expectedInterval);
      
      if (timestamp === expectedExactTimestamp) {
        validIntervalCount++;
      } else {
        invalidIntervalCount++;
        // Only log the first few invalid intervals to avoid flooding the console
        if (invalidIntervalCount <= 10) {
          console.log(`❌ Invalid timestamp at trade ${count}: ${new Date(timestamp).toISOString()}`);
          console.log(`   Expected: ${new Date(expectedExactTimestamp).toISOString()}`);
          console.log(`   Difference: ${(timestamp - expectedExactTimestamp) / 1000} seconds`);
        } else if (invalidIntervalCount === 11) {
          console.log('... more invalid timestamps (not showing all to avoid flooding the console)');
        }
      }
      
      previousTimestamp = timestamp;
      lastTimestamp = timestamp;
      count++;
      
      // Log progress every 100,000 trades
      if (count % 100000 === 0) {
        console.log(`Processed ${count} trades...`);
      }
    }
    
    console.log(`\nVerification complete for ${count} trades`);
    console.log(`Last trade timestamp: ${new Date(lastTimestamp).toISOString()}`);
    
    // Check if the sequence is complete
    const expectedLastTimestamp = expectedStartTimestamp + (count - 1) * expectedInterval;
    if (lastTimestamp === expectedLastTimestamp) {
      console.log('✅ Last timestamp matches expected value based on count and interval');
    } else {
      console.log(`❌ Last timestamp does not match expected value. Difference: ${(lastTimestamp - expectedLastTimestamp) / 1000} seconds`);
    }
    
    // Calculate and display statistics
    console.log(`\nStatistics:`);
    console.log(`Total trades: ${count}`);
    console.log(`Valid intervals: ${validIntervalCount} (${((validIntervalCount / (count - 1)) * 100).toFixed(2)}%)`);
    console.log(`Invalid intervals: ${invalidIntervalCount} (${((invalidIntervalCount / (count - 1)) * 100).toFixed(2)}%)`);
    
    // Check if all trades follow the expected pattern
    if (firstTimestamp === expectedStartTimestamp && invalidIntervalCount === 0) {
      console.log('\n✅ All trades respect the 2-second interval starting from 2022-01-01T00:00:00.000Z');
    } else {
      console.log('\n❌ Not all trades respect the 2-second interval pattern');
    }
    
    // Calculate total time span
    const totalTimeSpanMs = lastTimestamp - firstTimestamp;
    const totalTimeSpanDays = totalTimeSpanMs / (1000 * 60 * 60 * 24);
    console.log(`\nTotal time span: ${totalTimeSpanDays.toFixed(2)} days (${(totalTimeSpanMs / 1000 / 60 / 60).toFixed(2)} hours)`);
    
    // Calculate expected count based on time span
    const expectedCount = Math.floor(totalTimeSpanMs / expectedInterval) + 1;
    if (count === expectedCount) {
      console.log(`✅ Trade count matches expected count based on time span: ${expectedCount}`);
    } else {
      console.log(`❌ Trade count (${count}) does not match expected count based on time span: ${expectedCount}`);
      console.log(`   Missing trades: ${expectedCount - count}`);
    }
  } catch (error) {
    console.error('Error verifying trade intervals:', error);
  }
}

// Execute the function
verifyTradeIntervals()
  .then(() => console.log('Verification completed'))
  .catch(error => console.error('Verification failed:', error));
