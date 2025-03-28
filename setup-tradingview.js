/**
 * Script to download and set up the TradingView Charting Library
 * 
 * Note: This script assumes you have access to the TradingView Charting Library.
 * The library is not open source and requires a license from TradingView.
 * 
 * Instructions:
 * 1. Download the TradingView Charting Library from your TradingView account or contact TradingView for access
 * 2. Extract the downloaded zip file
 * 3. Run this script to copy the necessary files to the correct locations
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Paths
const PUBLIC_DIR = path.join(__dirname, 'public');
const CHARTING_LIB_DIR = path.join(PUBLIC_DIR, 'charting_library');
const DATAFEEDS_DIR = path.join(PUBLIC_DIR, 'datafeeds');

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Create directories if they don't exist
if (!fs.existsSync(CHARTING_LIB_DIR)) {
  fs.mkdirSync(CHARTING_LIB_DIR, { recursive: true });
  console.log(`Created directory: ${CHARTING_LIB_DIR}`);
}

if (!fs.existsSync(DATAFEEDS_DIR)) {
  fs.mkdirSync(DATAFEEDS_DIR, { recursive: true });
  console.log(`Created directory: ${DATAFEEDS_DIR}`);
}

console.log('\n=== TradingView Charting Library Setup ===');
console.log('\nThis script will help you set up the TradingView Charting Library.');
console.log('The library is not open source and requires a license from TradingView.');
console.log('\nInstructions:');
console.log('1. Download the TradingView Charting Library from your TradingView account');
console.log('2. Extract the downloaded zip file');
console.log('3. When prompted, provide the path to the extracted library files');

// Function to copy directory recursively
function copyDir(src, dest) {
  // Create destination directory if it doesn't exist
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  // Get all files and directories in source
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      // Recursively copy directory
      copyDir(srcPath, destPath);
    } else {
      // Copy file
      fs.copyFileSync(srcPath, destPath);
      console.log(`Copied: ${srcPath} -> ${destPath}`);
    }
  }
}

// Ask for the path to the charting library
rl.question('\nEnter the path to the extracted TradingView Charting Library folder: ', (libPath) => {
  const chartingLibSrc = path.join(libPath, 'charting_library');
  const datafeedsSrc = path.join(libPath, 'datafeeds');

  // Check if the provided paths exist
  if (!fs.existsSync(chartingLibSrc)) {
    console.error(`Error: Could not find charting_library at ${chartingLibSrc}`);
    rl.close();
    return;
  }

  if (!fs.existsSync(datafeedsSrc)) {
    console.error(`Error: Could not find datafeeds at ${datafeedsSrc}`);
    rl.close();
    return;
  }

  // Copy the files
  console.log('\nCopying charting_library...');
  copyDir(chartingLibSrc, CHARTING_LIB_DIR);

  console.log('\nCopying datafeeds...');
  copyDir(datafeedsSrc, DATAFEEDS_DIR);

  console.log('\nSetup completed successfully!');
  console.log('You can now start the application with: npm run dev');
  
  rl.close();
});
