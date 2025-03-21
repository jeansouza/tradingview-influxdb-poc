/**
 * Main Application JavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize chart
  const chartManager = new ChartManager('chart');

  // UI Elements
  const symbolSelect = document.getElementById('symbol');
  const resolutionSelect = document.getElementById('resolution');
  const rangeSelect = document.getElementById('range');
  const refreshBtn = document.getElementById('refresh-btn');
  
  // Get date filter elements
  const dateFilterContainer = document.getElementById('date-filter-container');
  const startDateInput = document.getElementById('start-date');
  const endDateInput = document.getElementById('end-date');
  const applyDateFilterBtn = document.getElementById('apply-date-filter');

  const generateBtn = document.getElementById('generate-btn');
  const genSymbolSelect = document.getElementById('gen-symbol');
  const genCountInput = document.getElementById('gen-count');
  const generationStatus = document.getElementById('generation-status');

  const addTradeBtn = document.getElementById('add-trade-btn');
  const tradeSymbolSelect = document.getElementById('trade-symbol');
  const tradeSideSelect = document.getElementById('trade-side');
  const tradePriceInput = document.getElementById('trade-price');
  const tradeAmountInput = document.getElementById('trade-amount');
  const addTradeStatus = document.getElementById('add-trade-status');

  // Event Listeners
  symbolSelect.addEventListener('change', () => {
    chartManager.setSymbol(symbolSelect.value);
  });

  resolutionSelect.addEventListener('change', () => {
    chartManager.setResolution(resolutionSelect.value);
  });

  rangeSelect.addEventListener('change', () => {
    // Show/hide date filter based on selection
    if (rangeSelect.value === 'custom') {
      dateFilterContainer.style.display = 'flex';
    } else {
      dateFilterContainer.style.display = 'none';
    }
    
    chartManager.setRange(rangeSelect.value);
  });

  refreshBtn.addEventListener('click', () => {
    // Force range to 'all' to use the fixed date range
    chartManager.setRange('all');
    chartManager.loadData();
  });
  
  // Date filter event listeners
  applyDateFilterBtn.addEventListener('click', () => {
    const startDate = new Date(startDateInput.value + ':00Z'); // Add seconds and UTC
    const endDate = new Date(endDateInput.value + ':00Z');
    
    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      alert('Please enter valid dates');
      return;
    }
    
    if (startDate >= endDate) {
      alert('Start date must be before end date');
      return;
    }
    
    // Set custom date range
    chartManager.setCustomDateRange(startDate, endDate);
  });

  // Generate fake trades
  generateBtn.addEventListener('click', async () => {
    try {
      const symbol = genSymbolSelect.value;
      const count = parseInt(genCountInput.value);

      if (isNaN(count) || count < 1000 || count > 1000000000) {
        throw new Error('Count must be between 1,000 and 1,000,000,000');
      }

      // Disable button and show loading
      generateBtn.disabled = true;
      generationStatus.textContent = 'Starting generation...';
      generationStatus.style.color = '#333';

      // Make request to generate trades
      const response = await fetch(`/api/trades/generate?symbol=${symbol}&count=${count}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let result = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        // Decode and append chunk
        const chunk = decoder.decode(value, { stream: true });
        result += chunk;

        // Update status with latest chunk
        generationStatus.textContent = result;
      }

      // Re-enable button
      generateBtn.disabled = false;

      // Refresh chart data
      if (symbol === chartManager.symbol) {
        // Force range to 'all' to use the fixed date range
        chartManager.setRange('all');
        chartManager.loadData();
      }
    } catch (error) {
      console.error('Error generating trades:', error);
      generationStatus.textContent = `Error: ${error.message}`;
      generationStatus.style.color = '#d32f2f';
      generateBtn.disabled = false;
    }
  });

  // Add single trade
  addTradeBtn.addEventListener('click', async () => {
    try {
      const symbol = tradeSymbolSelect.value;
      const side = tradeSideSelect.value;
      const price = parseFloat(tradePriceInput.value);
      const amount = parseFloat(tradeAmountInput.value);

      if (isNaN(price) || price <= 0) {
        throw new Error('Price must be a positive number');
      }

      if (isNaN(amount) || amount <= 0) {
        throw new Error('Amount must be a positive number');
      }

      // Disable button and show loading
      addTradeBtn.disabled = true;
      addTradeStatus.textContent = 'Adding trade...';
      addTradeStatus.style.color = '#333';

      // Make request to add trade
      const response = await fetch('/api/trades', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symbol,
          side,
          price,
          amount,
          timestamp: new Date('2022-01-01T00:01:00Z').toISOString() // Use 2022 date to match our data
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add trade');
      }

      const data = await response.json();

      // Show success message
      addTradeStatus.textContent = 'Trade added successfully!';
      addTradeStatus.style.color = '#2e7d32';

      // Re-enable button
      addTradeBtn.disabled = false;

      // Refresh chart data if same symbol
      if (symbol === chartManager.symbol) {
        // Force range to 'all' to use the fixed date range
        chartManager.setRange('all');
        chartManager.loadData();
      }
    } catch (error) {
      console.error('Error adding trade:', error);
      addTradeStatus.textContent = `Error: ${error.message}`;
      addTradeStatus.style.color = '#d32f2f';
      addTradeBtn.disabled = false;
    }
  });

  // Helper function to format numbers
  function formatNumber(num, decimals = 2) {
    return num.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }
  
  // Force range to 'all' on page load to use the fixed date range (2022-01-01)
  rangeSelect.value = 'all';
  chartManager.setRange('all');
  
  // Set initial custom date range to 2022-01-01 to 2022-01-02
  const initialStart = new Date('2022-01-01T00:00:00Z');
  const initialEnd = new Date('2022-01-02T00:00:00Z');
  chartManager.customDateRange = { start: initialStart, end: initialEnd };
});
