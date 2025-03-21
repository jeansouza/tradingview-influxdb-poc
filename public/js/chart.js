/**
 * Chart.js Implementation for Trade Data Visualization
 */

class ChartManager {
  constructor(containerId) {
    this.containerId = containerId;
    this.chart = null;
    this.symbol = 'BTCUSD';
    this.resolution = '5M';
    this.range = '1d';
    this.data = [];
    
    this.initChart();
  }
  
  initChart() {
    const container = document.getElementById(this.containerId);
    
    // Create canvas element for Chart.js
    const canvas = document.createElement('canvas');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    container.appendChild(canvas);
    
    // Create chart context
    const ctx = canvas.getContext('2d');
    
    // Create chart instance
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Price',
            data: [],
            borderColor: 'rgb(75, 192, 192)',
            tension: 0.1,
            pointRadius: 0,
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: {
              unit: 'minute',
              // Dynamically adjust display format based on zoom level
              displayFormats: {
                millisecond: 'HH:mm:ss.SSS',
                second: 'HH:mm:ss',
                minute: 'HH:mm',
                hour: 'HH:mm',
                day: 'MMM d',
                week: 'MMM d',
                month: 'MMM YYYY',
                quarter: 'MMM YYYY',
                year: 'YYYY'
              }
            },
            // Remove the problematic locale configuration
            ticks: {
              autoSkip: true,
              maxRotation: 0,
              source: 'auto'
            },
            title: {
              display: true,
              text: 'Time'
            }
          },
          y: {
            title: {
              display: true,
              text: 'Price'
            }
          }
        },
        plugins: {
          zoom: {
            pan: {
              enabled: false // Disable built-in pan
            },
            zoom: {
              wheel: {
                enabled: true
              },
              pinch: {
                enabled: true
              },
              drag: {
                enabled: false // Disable drag zoom
              },
              mode: 'x',
              onZoomComplete: ({ chart }) => {
                // Update time unit based on zoom level
                this.updateTimeUnit(chart);
                this.updateDateRangeFromChart(chart);
              }
            }
          },
          legend: {
            display: true
          },
          tooltip: {
            mode: 'index',
            intersect: false
          },
          title: {
            display: true,
            text: 'BTC/USD - 5 min',
            font: {
              size: 16
            }
          }
        }
      }
    });
    
    // Add custom drag handling
    this.setupDragHandling(canvas);
    
    // Handle window resize
    window.addEventListener('resize', () => {
      if (this.chart) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        this.chart.resize();
      }
    });
    
    // Add reset zoom button, navigation buttons, and help message
    this.addResetButton(container);
    this.addNavigationButtons(container);
    this.addHelpMessage(container);
    
    // Load initial data
    this.loadData();
  }
  
  setupDragHandling(canvas) {
    let isDragging = false;
    let startX = 0;
    let lastX = 0;
    
    // Mouse events for desktop
    canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      lastX = e.clientX;
      canvas.style.cursor = 'grabbing';
    });
    
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const deltaX = e.clientX - lastX;
      lastX = e.clientX;
      
      // Move the chart in the opposite direction of the drag
      if (this.chart && deltaX !== 0) {
        const xAxis = this.chart.scales.x;
        const range = xAxis.max - xAxis.min;
        const pixelRatio = canvas.width / range;
        const moveAmount = deltaX / pixelRatio;
        
        // Update the chart's x-axis range
        xAxis.min -= moveAmount;
        xAxis.max -= moveAmount;
        this.chart.update();
      }
    });
    
    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        canvas.style.cursor = 'default';
        
        // Update the date range when dragging stops
        if (this.chart) {
          this.updateDateRangeFromChart(this.chart);
        }
      }
    });
    
    // Touch events for mobile
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isDragging = true;
        startX = e.touches[0].clientX;
        lastX = e.touches[0].clientX;
      }
    });
    
    canvas.addEventListener('touchmove', (e) => {
      if (!isDragging || e.touches.length !== 1) return;
      
      const deltaX = e.touches[0].clientX - lastX;
      lastX = e.touches[0].clientX;
      
      // Move the chart in the opposite direction of the drag
      if (this.chart && deltaX !== 0) {
        const xAxis = this.chart.scales.x;
        const range = xAxis.max - xAxis.min;
        const pixelRatio = canvas.width / range;
        const moveAmount = deltaX / pixelRatio;
        
        // Update the chart's x-axis range
        xAxis.min -= moveAmount;
        xAxis.max -= moveAmount;
        this.chart.update();
      }
    });
    
    canvas.addEventListener('touchend', () => {
      if (isDragging) {
        isDragging = false;
        
        // Update the date range when dragging stops
        if (this.chart) {
          this.updateDateRangeFromChart(this.chart);
        }
      }
    });
  }
  
  addHelpMessage(container) {
    // Create help message
    const helpMessage = document.createElement('div');
    helpMessage.textContent = 'Click & Drag to pan the chart horizontally';
    helpMessage.style.position = 'absolute';
    helpMessage.style.bottom = '10px';
    helpMessage.style.left = '10px';
    helpMessage.style.zIndex = '100';
    helpMessage.style.padding = '5px 10px';
    helpMessage.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    helpMessage.style.color = 'white';
    helpMessage.style.borderRadius = '4px';
    helpMessage.style.fontSize = '12px';
    helpMessage.style.opacity = '0.8';
    
    // Add to container
    container.appendChild(helpMessage);
    
    // Fade out after 10 seconds
    setTimeout(() => {
      let opacity = 0.8;
      const fadeInterval = setInterval(() => {
        opacity -= 0.05;
        helpMessage.style.opacity = opacity;
        
        if (opacity <= 0) {
          clearInterval(fadeInterval);
          container.removeChild(helpMessage);
        }
      }, 100);
    }, 10000);
  }
  
  addNavigationButtons(container) {
    // Create navigation container
    const navContainer = document.createElement('div');
    navContainer.style.position = 'absolute';
    navContainer.style.bottom = '10px';
    navContainer.style.right = '10px';
    navContainer.style.zIndex = '100';
    navContainer.style.display = 'flex';
    navContainer.style.gap = '5px';
    
    // Create previous button
    const prevButton = document.createElement('button');
    prevButton.textContent = '◀ Previous';
    prevButton.style.padding = '5px 10px';
    prevButton.style.backgroundColor = '#2962ff';
    prevButton.style.color = 'white';
    prevButton.style.border = 'none';
    prevButton.style.borderRadius = '4px';
    prevButton.style.cursor = 'pointer';
    prevButton.style.fontSize = '12px';
    
    // Create next button
    const nextButton = document.createElement('button');
    nextButton.textContent = 'Next ▶';
    nextButton.style.padding = '5px 10px';
    nextButton.style.backgroundColor = '#2962ff';
    nextButton.style.color = 'white';
    nextButton.style.border = 'none';
    nextButton.style.borderRadius = '4px';
    nextButton.style.cursor = 'pointer';
    nextButton.style.fontSize = '12px';
    
    // Add hover effects
    const addHoverEffect = (button) => {
      button.addEventListener('mouseover', () => {
        button.style.backgroundColor = '#0039cb';
      });
      
      button.addEventListener('mouseout', () => {
        button.style.backgroundColor = '#2962ff';
      });
    };
    
    addHoverEffect(prevButton);
    addHoverEffect(nextButton);
    
    // Add click events
    prevButton.addEventListener('click', () => {
      this.navigateToPreviousPeriod();
    });
    
    nextButton.addEventListener('click', () => {
      this.navigateToNextPeriod();
    });
    
    // Add buttons to container
    navContainer.appendChild(prevButton);
    navContainer.appendChild(nextButton);
    
    // Add navigation container to chart container
    container.appendChild(navContainer);
  }
  
  navigateToPreviousPeriod() {
    if (!this.customDateRange) return;
    
    // Calculate the time range
    const start = this.customDateRange.start;
    const end = this.customDateRange.end;
    const timeRange = end.getTime() - start.getTime();
    
    // Move to the previous period
    const newEnd = new Date(start.getTime());
    const newStart = new Date(start.getTime() - timeRange);
    
    // Update the custom date range
    this.setCustomDateRange(newStart, newEnd);
  }
  
  navigateToNextPeriod() {
    if (!this.customDateRange) return;
    
    // Calculate the time range
    const start = this.customDateRange.start;
    const end = this.customDateRange.end;
    const timeRange = end.getTime() - start.getTime();
    
    // Move to the next period
    const newStart = new Date(end.getTime());
    const newEnd = new Date(end.getTime() + timeRange);
    
    // Update the custom date range
    this.setCustomDateRange(newStart, newEnd);
  }
  
  addResetButton(container) {
    // Create reset button
    const resetButton = document.createElement('button');
    resetButton.textContent = 'Reset View';
    resetButton.style.position = 'absolute';
    resetButton.style.top = '10px';
    resetButton.style.right = '10px';
    resetButton.style.zIndex = '100';
    resetButton.style.padding = '5px 10px';
    resetButton.style.backgroundColor = '#2962ff';
    resetButton.style.color = 'white';
    resetButton.style.border = 'none';
    resetButton.style.borderRadius = '4px';
    resetButton.style.cursor = 'pointer';
    resetButton.style.fontSize = '12px';
    
    // Add hover effect
    resetButton.addEventListener('mouseover', () => {
      resetButton.style.backgroundColor = '#0039cb';
    });
    
    resetButton.addEventListener('mouseout', () => {
      resetButton.style.backgroundColor = '#2962ff';
    });
    
    // Add click event
    resetButton.addEventListener('click', () => {
      if (this.chart) {
        this.chart.resetZoom();
        
        // Reset to default date range
        this.range = 'all';
        const rangeSelect = document.getElementById('range');
        if (rangeSelect) {
          rangeSelect.value = 'all';
        }
        
        // Hide date filter container
        const dateFilterContainer = document.getElementById('date-filter-container');
        if (dateFilterContainer) {
          dateFilterContainer.style.display = 'none';
        }
        
        // Reset custom date range
        this.customDateRange = null;
        
        // Reload data
        this.loadData();
      }
    });
    
    // Add button to container
    container.appendChild(resetButton);
  }
  
  async loadData() {
    try {
      // Calculate time range
      let start, end;
      
      // Default to 2022-01-01 (whole day)
      const defaultStart = new Date('2022-01-01T00:00:00Z');
      const defaultEnd = new Date('2022-01-02T00:00:00Z');
      
      // Check if custom date range is set
      if (this.customDateRange) {
        start = this.customDateRange.start;
        end = this.customDateRange.end;
      } else {
        // Use predefined ranges but always in 2022
        const baseDate = new Date('2022-01-01T12:00:00Z'); // Noon on Jan 1, 2022
        
        switch (this.range) {
          case '1h':
            end = new Date(baseDate);
            start = new Date(baseDate.getTime() - 60 * 60 * 1000);
            break;
          case '6h':
            end = new Date(baseDate);
            start = new Date(baseDate.getTime() - 6 * 60 * 60 * 1000);
            break;
          case '1d':
            end = new Date(baseDate);
            start = new Date(baseDate.getTime() - 24 * 60 * 60 * 1000);
            break;
          case '7d':
            end = new Date(baseDate);
            start = new Date(baseDate.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case '30d':
            end = new Date(baseDate);
            start = new Date(baseDate.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          case '90d':
            end = new Date(baseDate);
            start = new Date(baseDate.getTime() - 90 * 24 * 60 * 60 * 1000);
            break;
          case '180d':
            end = new Date(baseDate);
            start = new Date(baseDate.getTime() - 180 * 24 * 60 * 60 * 1000);
            break;
          case '365d':
            end = new Date(baseDate);
            start = new Date(baseDate.getTime() - 365 * 24 * 60 * 60 * 1000);
            break;
          case 'all':
          case 'custom':
          default:
            // Default to 2022-01-01 (whole day)
            start = defaultStart;
            end = defaultEnd;
        }
      }
      
      // Limit the range to prevent performance issues
      const timeRangeMs = end.getTime() - start.getTime();
      const maxRangeMs = 30 * 24 * 60 * 60 * 1000; // 30 days max
      
      if (timeRangeMs > maxRangeMs) {
        console.warn(`Date range too large (${timeRangeMs}ms). Limiting to ${maxRangeMs}ms.`);
        // Keep the end date and adjust the start date
        start = new Date(end.getTime() - maxRangeMs);
      }
      
      console.log(`Loading data for ${this.symbol} from ${start.toISOString()} to ${end.toISOString()}`);
      
      // Use AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      try {
        // Fetch OHLC data from API with timeout
        const response = await fetch(
          `/api/trades/ohlc?symbol=${this.symbol}&resolution=${this.resolution}&start=${start.toISOString()}&end=${end.toISOString()}`,
          { signal: controller.signal }
        );
        
        // Clear the timeout
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        this.data = data;
        
        // If no data, just display an empty chart
        if (!data || data.length === 0) {
          console.log('No data returned for the specified range');
          // Update chart data with empty array
          this.chart.data.datasets[0].data = [];
          
          // Update chart title
          this.updateChartTitle();
          
          // Update the chart
          this.chart.update();
          
          // Update time unit based on range
          this.updateTimeUnit(this.chart);
          
          return;
        }
        
        // Format data for Chart.js
        const chartData = data.map(item => ({
          x: new Date(item.time),
          y: item.close
        }));
        
        // Update chart data
        this.chart.data.datasets[0].data = chartData;
        
        // Update chart title
        this.updateChartTitle();
        
        // Update time unit based on range
        this.updateTimeUnit(this.chart);
        
        // Update the chart
        this.chart.update();
      } catch (fetchError) {
        // Clear the timeout
        clearTimeout(timeoutId);
        
        // Handle abort error differently
        if (fetchError.name === 'AbortError') {
          console.error('Request timed out after 30 seconds');
          this.showError('Request timed out. Try a smaller date range.');
        } else {
          throw fetchError; // Re-throw for the outer catch block
        }
      }
    } catch (error) {
      console.error('Error loading chart data:', error);
      this.showError(`Failed to load chart data: ${error.message}`);
    }
  }
  
  updateChartTitle() {
    const symbolDisplay = this.symbol.slice(0, 3) + '/' + this.symbol.slice(3);
    const resolutionDisplay = this.resolution.replace('M', ' min').replace('H', ' hour').replace('D', ' day');
    
    let dateRangeDisplay = '';
    if (this.customDateRange) {
      // Format dates for display
      const formatDate = (date) => {
        return date.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      };
      
      dateRangeDisplay = ` (${formatDate(this.customDateRange.start)} - ${formatDate(this.customDateRange.end)})`;
    }
    
    this.chart.options.plugins.title.text = `${symbolDisplay} - ${resolutionDisplay}${dateRangeDisplay}`;
  }
  
  setSymbol(symbol) {
    this.symbol = symbol;
    this.loadData();
  }
  
  setResolution(resolution) {
    this.resolution = resolution;
    this.loadData();
  }
  
  setRange(range) {
    this.range = range;
    this.loadData();
  }
  
  setCustomDateRange(start, end) {
    this.customDateRange = { start, end };
    this.range = 'custom';
    this.loadData();
  }
  
  updateDateRangeFromChart(chart) {
    try {
      // Get the current min and max values from the chart's x-axis
      const xAxis = chart.scales.x;
      if (!xAxis || !xAxis.min || !xAxis.max) return;
      
      // Convert the min and max values to dates
      // Ensure we're using dates in 2022, not 2025
      const minDate = new Date(xAxis.min);
      const maxDate = new Date(xAxis.max);
      
      // Force the year to be 2022
      const start = new Date(minDate);
      start.setFullYear(2022);
      
      const end = new Date(maxDate);
      end.setFullYear(2022);
      
      // Make sure end is after start
      if (end <= start) {
        end.setTime(start.getTime() + (24 * 60 * 60 * 1000)); // Add one day
      }
      
      // Limit the range to prevent performance issues
      const timeRangeMs = end.getTime() - start.getTime();
      const maxRangeMs = 30 * 24 * 60 * 60 * 1000; // 30 days max
      
      if (timeRangeMs > maxRangeMs) {
        console.warn(`Date range too large (${timeRangeMs}ms). Limiting to ${maxRangeMs}ms.`);
        // Keep the end date and adjust the start date
        start.setTime(end.getTime() - maxRangeMs);
      }
      
      // Update the date inputs if they exist
      const startDateInput = document.getElementById('start-date');
      const endDateInput = document.getElementById('end-date');
      
      if (startDateInput && endDateInput) {
        // Format the dates for the datetime-local inputs (YYYY-MM-DDTHH:MM)
        const formatDateForInput = (date) => {
          return date.toISOString().slice(0, 16);
        };
        
        startDateInput.value = formatDateForInput(start);
        endDateInput.value = formatDateForInput(end);
      }
      
      // Update the custom date range
      this.customDateRange = { start, end };
      
      // Set the range to custom
      const rangeSelect = document.getElementById('range');
      if (rangeSelect) {
        rangeSelect.value = 'custom';
        
        // Show the date filter container
        const dateFilterContainer = document.getElementById('date-filter-container');
        if (dateFilterContainer) {
          dateFilterContainer.style.display = 'flex';
        }
      }
      
      // Update the chart title with the date range
      this.updateChartTitle();
      
      // Load new data for the visible range
      this.loadData();
    } catch (error) {
      console.error('Error updating date range from chart:', error);
      this.showError('Error updating chart view. Try using the Reset View button.');
    }
  }
  
  // Update the time unit based on the zoom level
  updateTimeUnit(chart) {
    if (!chart || !chart.scales || !chart.scales.x) return;
    
    const xAxis = chart.scales.x;
    const range = xAxis.max - xAxis.min;
    
    // Convert range from milliseconds to days
    const rangeDays = range / (1000 * 60 * 60 * 24);
    
    // Set appropriate time unit based on range
    let unit = 'minute';
    
    if (rangeDays > 365) {
      unit = 'year';
    } else if (rangeDays > 90) {
      unit = 'month';
    } else if (rangeDays > 30) {
      unit = 'week';
    } else if (rangeDays > 3) {
      unit = 'day';
    } else if (rangeDays > 1) {
      unit = 'hour';
    }
    
    // Update the time unit
    if (chart.options.scales.x.time.unit !== unit) {
      chart.options.scales.x.time.unit = unit;
      console.log(`Updated time unit to ${unit} for range of ${rangeDays.toFixed(2)} days`);
    }
  }
  
  showError(message) {
    const container = document.getElementById(this.containerId);
    
    // Create error overlay
    const errorOverlay = document.createElement('div');
    errorOverlay.style.position = 'absolute';
    errorOverlay.style.top = '0';
    errorOverlay.style.left = '0';
    errorOverlay.style.width = '100%';
    errorOverlay.style.height = '100%';
    errorOverlay.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
    errorOverlay.style.display = 'flex';
    errorOverlay.style.justifyContent = 'center';
    errorOverlay.style.alignItems = 'center';
    errorOverlay.style.zIndex = '1000';
    
    const errorMessage = document.createElement('div');
    errorMessage.textContent = message;
    errorMessage.style.color = '#d32f2f';
    errorMessage.style.fontSize = '16px';
    errorMessage.style.padding = '20px';
    errorMessage.style.textAlign = 'center';
    
    errorOverlay.appendChild(errorMessage);
    container.appendChild(errorOverlay);
    
    // Remove error after 5 seconds
    setTimeout(() => {
      container.removeChild(errorOverlay);
    }, 5000);
  }
}

// Export for use in app.js
window.ChartManager = ChartManager;
