/**
 * TradingView InfluxDB POC - Main Application JavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
  const symbolSelect = document.getElementById('symbol');
  const resolutionSelect = document.getElementById('resolution');
  const refreshBtn = document.getElementById('refresh-btn');
  const chartContainer = document.getElementById('tv_chart_container');

  // Default values
  let currentSymbol = 'BTCUSD';
  let currentResolution = '5';
  let widget = null;

  // Check if TradingView library is available
  const isTradingViewAvailable = () => {
    return typeof TradingView !== 'undefined';
  };

  // Display a message when TradingView library is not available
  function displayLibraryMissingMessage() {
    chartContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%; text-align: center; padding: 20px;">
        <h2 style="color: #333; margin-bottom: 20px;">TradingView Charting Library Not Installed</h2>
        <p style="color: #666; margin-bottom: 15px; max-width: 600px;">
          The TradingView Charting Library is required but not installed. This library requires a license from TradingView.
        </p>
        <p style="color: #666; margin-bottom: 15px; max-width: 600px;">
          Please follow these steps to install it:
        </p>
        <ol style="color: #666; text-align: left; max-width: 600px; margin-bottom: 20px;">
          <li>Download the TradingView Charting Library from your TradingView account</li>
          <li>Extract the downloaded zip file</li>
          <li>Run the setup script: <code>node setup-tradingview.js</code></li>
          <li>Follow the prompts to provide the path to the extracted library files</li>
          <li>Restart the application</li>
        </ol>
        <p style="color: #666; max-width: 600px;">
          For more information, please refer to the README.md file.
        </p>
      </div>
    `;
  }

  // Custom datafeed implementation that uses our direct API endpoints
  class InfluxDBDatafeed {
    constructor() {
      this.symbolsInfo = {};
      this.resolutionToSeconds = {
        '1': 60,
        '5': 300,
        '15': 900,
        '30': 1800,
        '60': 3600,
        '120': 7200,
        '240': 14400,
        '360': 21600,
        '720': 43200,
        'D': 86400
      };
    }

    // Required method: Called when the chart is initialized
    onReady(callback) {
      console.log('Datafeed onReady');
      
      // Define the supported resolutions
      const configurationData = {
        supported_resolutions: ['1', '5', '15', '30', '60', '120', '240', '360', '720', 'D'],
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
        exchanges: [
          {
            value: 'InfluxDB',
            name: 'InfluxDB',
            desc: 'InfluxDB'
          }
        ],
        symbols_types: [
          {
            name: 'crypto',
            value: 'crypto'
          }
        ]
      };
      
      // Call the callback with the configuration data
      setTimeout(() => callback(configurationData), 0);
    }

    // Required method: Search for symbols
    searchSymbols(userInput, exchange, symbolType, onResult) {
      console.log('Datafeed searchSymbols:', userInput, exchange, symbolType);
      
      // Fetch symbols from our API
      fetch('/api/symbols')
        .then(response => response.json())
        .then(symbols => {
          // Filter symbols based on user input if provided
          let filteredSymbols = symbols;
          if (userInput) {
            const searchString = userInput.toLowerCase();
            filteredSymbols = symbols.filter(symbol => 
              symbol.symbol.toLowerCase().includes(searchString) || 
              symbol.description.toLowerCase().includes(searchString)
            );
          }
          
          // Format symbols for TradingView
          const formattedSymbols = filteredSymbols.map(symbol => ({
            symbol: symbol.symbol,
            full_name: symbol.symbol,
            description: symbol.description,
            exchange: symbol.exchange,
            type: symbol.type
          }));
          
          onResult(formattedSymbols);
        })
        .catch(error => {
          console.error('Error searching symbols:', error);
          onResult([]);
        });
    }

    // Required method: Get symbol information
    resolveSymbol(symbolName, onSymbolResolvedCallback, onResolveErrorCallback, extension) {
      console.log('Datafeed resolveSymbol:', symbolName);
      
      // Check if we already have this symbol's info cached
      if (this.symbolsInfo[symbolName]) {
        setTimeout(() => onSymbolResolvedCallback(this.symbolsInfo[symbolName]), 0);
        return;
      }
      
      // Fetch symbols from our API
      fetch('/api/symbols')
        .then(response => response.json())
        .then(symbols => {
          // Find the requested symbol
          const symbolInfo = symbols.find(s => s.symbol === symbolName);
          
          if (!symbolInfo) {
            onResolveErrorCallback('Symbol not found');
            return;
          }
          
          // Format the symbol info for TradingView
          const formattedSymbolInfo = {
            name: symbolInfo.symbol,
            ticker: symbolInfo.symbol,
            description: symbolInfo.description,
            type: symbolInfo.type,
            session: '24x7',
            timezone: 'America/Sao_Paulo',
            exchange: symbolInfo.exchange,
            minmov: 1,
            pricescale: 100,
            has_intraday: true,
            has_daily: true,
            has_weekly_and_monthly: false,
            supported_resolutions: ['1', '5', '15', '30', '60', '120', '240', '360', '720', 'D'],
            volume_precision: 8,
            data_status: 'streaming'
          };
          
          // Cache the symbol info
          this.symbolsInfo[symbolName] = formattedSymbolInfo;
          
          // Return the symbol info
          onSymbolResolvedCallback(formattedSymbolInfo);
        })
        .catch(error => {
          console.error('Error resolving symbol:', error);
          onResolveErrorCallback('Error resolving symbol');
        });
    }

    // Required method: Get historical bars
    getBars(symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) {
      try {
        const { from, to, firstDataRequest, countBack } = periodParams;
        console.log('Datafeed getBars:', symbolInfo.name, resolution, from, to, firstDataRequest, countBack);
        
        // Check if we have custom date range data
        if (window.customDateRange && window.customDateRange.data && window.customDateRange.data.length > 0) {
          console.log('Using custom date range data');
          
          // Format the data for TradingView
          const bars = window.customDateRange.data.map(bar => ({
            time: bar.time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume || 0
          }));
          
          console.log(`Using ${bars.length} bars from custom date range`);
          
          // Clear the custom date range data so it's only used once
          const customData = window.customDateRange;
          window.customDateRange = null;
          
          // Return the data
          onHistoryCallback(bars, { noData: bars.length === 0 });
          return;
        }
        
        // Convert timestamps to ISO strings for our API
        const fromDate = new Date(from * 1000).toISOString();
        const toDate = new Date(to * 1000).toISOString();
        
        // Log the request details for debugging
        console.log(`Requesting OHLC data: 
          Symbol: ${symbolInfo.name}
          Resolution: ${resolution}
          From: ${fromDate} (${from})
          To: ${toDate} (${to})
          First Request: ${firstDataRequest}
          Count Back: ${countBack || 'N/A'}
        `);
        
        // Create the URL with the query parameters
        const url = new URL('/api/trades/ohlc', window.location.origin);
        url.searchParams.append('symbol', symbolInfo.name);
        url.searchParams.append('resolution', resolution);
        url.searchParams.append('start', fromDate);
        url.searchParams.append('end', toDate);
        
        console.log('Request URL:', url.toString());
        
        // Fetch OHLC data from our API
        fetch(url.toString())
          .then(response => {
            console.log('Response status:', response.status);
            return response.json();
          })
          .then(data => {
            // Check if we got an error response
            if (data.error) {
              console.error('API error:', data.error);
              onErrorCallback(data.error);
              return;
            }
            
            // Check if we got any data
            if (!data || data.length === 0) {
              console.log('No data for the requested period');
              onHistoryCallback([], { noData: true });
              return;
            }
            
            // Format the data for TradingView
            const bars = data.map(bar => ({
              time: bar.time,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume || 0
            }));
            
            console.log(`Received ${bars.length} bars`);
            onHistoryCallback(bars, { noData: bars.length === 0 });
          })
          .catch(error => {
            console.error('Error fetching bars:', error);
            onErrorCallback(`Error fetching bars: ${error.message}`);
          });
      } catch (error) {
        console.error('Error in getBars:', error);
        onErrorCallback(`Error in getBars: ${error.message}`);
      }
    }

    // Optional method: Subscribe to real-time updates (not used in this implementation)
    subscribeBars(symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) {
      console.log('Datafeed subscribeBars:', symbolInfo.name, resolution, subscriberUID);
      // We're not implementing real-time updates in this POC
      return;
    }

    // Optional method: Unsubscribe from real-time updates (not used in this implementation)
    unsubscribeBars(subscriberUID) {
      console.log('Datafeed unsubscribeBars:', subscriberUID);
      // We're not implementing real-time updates in this POC
      return;
    }

    // Optional method: Get server time
    getServerTime(callback) {
      console.log('Datafeed getServerTime');
      const time = Math.floor(Date.now() / 1000);
      setTimeout(() => callback(time), 0);
    }
  }

  // Initialize TradingView widget
  function initTradingViewWidget() {
    // Clear the container if widget already exists
    if (widget) {
      chartContainer.innerHTML = '';
    }

    // Check if TradingView library is available
    if (!isTradingViewAvailable()) {
      displayLibraryMissingMessage();
      return;
    }

    // Create our custom datafeed
    const datafeed = new InfluxDBDatafeed();

    // Create the widget
    widget = new TradingView.widget({
      // Debug mode
      debug: true, // Enable debug mode to see more logs
      // DOM element where the widget will be rendered
      container: chartContainer,
      // TradingView library path
      library_path: '/charting_library/',
      // Custom datafeed
      datafeed: datafeed,
      // Initial symbol
      symbol: currentSymbol,
      // Chart interval (resolution)
      interval: currentResolution,
      // Container size
      container_id: 'tv_chart_container',
      // Full featured chart
      charts_storage_url: 'https://saveload.tradingview.com',
      charts_storage_api_version: '1.1',
      client_id: 'tradingview.com',
      user_id: 'public_user',
      // Appearance
      theme: 'Dark',
      // Toolbar configuration
      toolbar_bg: '#2a2e39',
      // Disable features that might interfere with our custom date handling
      disabled_features: [
        'save_chart_properties_to_local_storage',
        'use_localstorage_for_settings'
      ],
      enabled_features: [
        'side_toolbar_in_fullscreen_mode',
        'header_widget',
        'header_symbol_search',
        'header_resolutions',
        'header_chart_type',
        'header_settings',
        'header_indicators',
        'header_compare',
        'header_undo_redo',
        'header_screenshot',
        'header_fullscreen_button',
        'study_templates',
        'left_toolbar',
        'control_bar',
        'timeframes_toolbar',
        'display_market_status',
        'legend_context_menu',
        'header_saveload',
        'use_localstorage_for_settings',
        'save_chart_properties_to_local_storage',
        'go_to_date',
        'adaptive_logo',
        'date_range'
      ],
      // Time zone
      timezone: 'America/Sao_Paulo',
      // Localization
      locale: 'en',
      // Auto save chart settings
      auto_save_delay: 5,
      // Default overrides
      overrides: {
        'mainSeriesProperties.style': 1, // Candles
        'mainSeriesProperties.candleStyle.upColor': '#26a69a',
        'mainSeriesProperties.candleStyle.downColor': '#ef5350',
        'mainSeriesProperties.candleStyle.wickUpColor': '#26a69a',
        'mainSeriesProperties.candleStyle.wickDownColor': '#ef5350',
        'mainSeriesProperties.candleStyle.borderUpColor': '#26a69a',
        'mainSeriesProperties.candleStyle.borderDownColor': '#ef5350',
      },
      // Loading screen
      loading_screen: {
        backgroundColor: '#2a2e39',
        foregroundColor: '#2962ff'
      },
      // Fullscreen mode
      fullscreen: false,
      // Auto size
      autosize: true,
      // Studies (indicators) to load by default
      studies_overrides: {
        'volume.volume.color.0': 'rgba(239, 83, 80, 0.5)',
        'volume.volume.color.1': 'rgba(38, 166, 154, 0.5)'
      }
    });

    // Save widget instance
    window.tvWidget = widget;
    
    // Add event listener for when the chart is ready
    widget.onChartReady(() => {
      console.log('Chart is ready');
      
      // Get the chart instance
      const chart = widget.chart();
      
      // Subscribe to the time range change event
      chart.onIntervalChanged().subscribe(null, (interval, timeframeObj) => {
        console.log('Time range changed:', interval, timeframeObj);
        
        // If it's a custom time range
        if (timeframeObj && timeframeObj.type === 'time-range') {
          console.log('Custom time range selected:', timeframeObj);
          
          // Convert timestamps to dates for logging
          const fromDate = new Date(timeframeObj.from * 1000).toISOString();
          const toDate = new Date(timeframeObj.to * 1000).toISOString();
          console.log(`Custom range: ${fromDate} to ${toDate}`);
          
          // Force a reload of data for the new range
          // This will trigger a new getBars call with the updated time range
          try {
            console.log('Setting visible range and forcing data reload');
            
            // First reset the data to clear any cached data
            chart.resetData();
            
            // Then set the visible range with a slight delay to ensure the reset takes effect
            setTimeout(() => {
              chart.setVisibleRange({
                from: timeframeObj.from,
                to: timeframeObj.to
              }).then(() => {
                console.log('Visible range set successfully');
                
                // Create a direct API request to ensure data is fetched
                const fromDate = new Date(timeframeObj.from * 1000).toISOString();
                const toDate = new Date(timeframeObj.to * 1000).toISOString();
                
                const url = new URL('/api/trades/ohlc', window.location.origin);
                url.searchParams.append('symbol', currentSymbol);
                url.searchParams.append('resolution', currentResolution);
                url.searchParams.append('start', fromDate);
                url.searchParams.append('end', toDate);
                
                console.log('Making direct API request:', url.toString());
                
                // Make the request directly
                fetch(url.toString())
                  .then(response => {
                    console.log('Direct API response status:', response.status);
                    return response.json();
                  })
                  .then(data => {
                    console.log('Direct API response data:', data);
                    if (data && data.length > 0) {
                      console.log(`Received ${data.length} bars directly`);
                    } else {
                      console.log('No data received from direct API request');
                    }
                  })
                  .catch(error => {
                    console.error('Error in direct API request:', error);
                  });
              }).catch(error => {
                console.error('Error setting visible range:', error);
              });
            }, 100);
          } catch (error) {
            console.error('Error in custom range handling:', error);
          }
        }
      });
      
      // Add a global click event listener to capture the "Go to" button click
      document.addEventListener('click', (event) => {
        // Check if the clicked element is a button with text "Go to"
        if (event.target.tagName === 'BUTTON' && 
            event.target.textContent.trim() === 'Go to') {
          
          console.log('Go to button clicked detected by global listener');
          
          // Find all input elements in the document
          const inputs = document.querySelectorAll('input[type="text"]');
          
          if (inputs.length >= 2) {
            // Extract dates and times
            let startDate, startTime, endDate, endTime;
            
            // Try to identify date and time inputs
            for (let i = 0; i < inputs.length; i++) {
              const input = inputs[i];
              const value = input.value;
              
              // Check if it's a date input (contains dashes)
              if (value && value.includes('-')) {
                if (!startDate) {
                  startDate = value;
                } else if (!endDate) {
                  endDate = value;
                }
              } 
              // Check if it's a time input (contains colons)
              else if (value && value.includes(':')) {
                if (!startTime) {
                  startTime = value;
                } else if (!endTime) {
                  endTime = value;
                }
              }
            }
            
            // If we couldn't identify all values, make some assumptions
            if (!startDate || !endDate) {
              console.log('Could not identify date inputs clearly, using defaults');
              startDate = inputs[0].value;
              endDate = inputs.length > 2 ? inputs[2].value : startDate;
            }
            
            if (!startTime || !endTime) {
              console.log('Could not identify time inputs clearly, using defaults');
              startTime = inputs[1].value;
              endTime = inputs.length > 3 ? inputs[3].value : startTime;
            }
            
            console.log(`Custom range selected: ${startDate} ${startTime} to ${endDate} ${endTime}`);
            
            // Create ISO date strings
            try {
              const start = new Date(`${startDate}T${startTime}:00`).toISOString();
              const end = new Date(`${endDate}T${endTime}:00`).toISOString();
              
              console.log(`Converted to ISO: ${start} to ${end}`);
              
              // Create a direct API request
              const url = new URL('/api/trades/ohlc', window.location.origin);
              url.searchParams.append('symbol', currentSymbol);
              url.searchParams.append('resolution', currentResolution);
              url.searchParams.append('start', start);
              url.searchParams.append('end', end);
              
              console.log('Making direct API request from button click:', url.toString());
              
              // Make the request directly
              fetch(url.toString())
                .then(response => {
                  console.log('Direct API response status from button click:', response.status);
                  return response.json();
                })
                .then(data => {
                  console.log('Direct API response data from button click:', data);
                  if (data && data.length > 0) {
                    console.log(`Received ${data.length} bars directly from button click`);
                  } else {
                    console.log('No data received from direct API request from button click');
                  }
                })
                .catch(error => {
                  console.error('Error in direct API request from button click:', error);
                });
            } catch (error) {
              console.error('Error parsing dates:', error);
            }
          }
        }
      }, true); // Use capture phase to ensure we catch the event before it's stopped
    });
  }

  // Event Listeners
  symbolSelect.addEventListener('change', () => {
    currentSymbol = symbolSelect.value;
    if (isTradingViewAvailable() && widget && widget.chart) {
      widget.chart().setSymbol(currentSymbol);
    } else {
      initTradingViewWidget();
    }
  });

  resolutionSelect.addEventListener('change', () => {
    currentResolution = resolutionSelect.value;
    if (isTradingViewAvailable() && widget && widget.chart) {
      widget.chart().setResolution(currentResolution);
    } else {
      initTradingViewWidget();
    }
  });

  refreshBtn.addEventListener('click', () => {
    // Reinitialize the widget
    initTradingViewWidget();
  });

  // Custom date range button
  const customRangeBtn = document.getElementById('custom-range-btn');
  const startDateInput = document.getElementById('start-date');
  const startTimeInput = document.getElementById('start-time');
  const endDateInput = document.getElementById('end-date');
  const endTimeInput = document.getElementById('end-time');

  customRangeBtn.addEventListener('click', () => {
    console.log('Custom range button clicked');
    
    // Get the date and time values
    const startDate = startDateInput.value;
    const startTime = startTimeInput.value;
    const endDate = endDateInput.value;
    const endTime = endTimeInput.value;
    
    console.log(`Custom range selected: ${startDate} ${startTime} to ${endDate} ${endTime}`);
    
    // Create ISO date strings
    try {
      // Parse the date values correctly
      // The date format might be DD/MM/YYYY or YYYY-MM-DD depending on the browser locale
      let startDateObj, endDateObj;
      
      // Handle different date formats
      if (startDate.includes('/')) {
        // Format: DD/MM/YYYY
        const [day, month, year] = startDate.split('/');
        startDateObj = new Date(`${year}-${month}-${day}T${startTime}:00`);
      } else {
        // Format: YYYY-MM-DD
        startDateObj = new Date(`${startDate}T${startTime}:00`);
      }
      
      if (endDate.includes('/')) {
        // Format: DD/MM/YYYY
        const [day, month, year] = endDate.split('/');
        endDateObj = new Date(`${year}-${month}-${day}T${endTime}:00`);
      } else {
        // Format: YYYY-MM-DD
        endDateObj = new Date(`${endDate}T${endTime}:00`);
      }
      
      const start = startDateObj.toISOString();
      const end = endDateObj.toISOString();
      
      console.log(`Converted to ISO: ${start} to ${end}`);
      
      // Create a direct API request
      const url = new URL('/api/trades/ohlc', window.location.origin);
      url.searchParams.append('symbol', currentSymbol);
      url.searchParams.append('resolution', currentResolution);
      url.searchParams.append('start', start);
      url.searchParams.append('end', end);
      
      console.log('Making direct API request from custom range button:', url.toString());
      
      // Make the request directly
      fetch(url.toString())
        .then(response => {
          console.log('Direct API response status from custom range button:', response.status);
          return response.json();
        })
        .then(data => {
          console.log('Direct API response data from custom range button:', data);
          if (data && data.length > 0) {
            console.log(`Received ${data.length} bars directly from custom range button`);
            
            // If we have data, we need to reinitialize the chart with the new date range
            console.log('Reinitializing chart with the new date range');
            
            // Store the date range in global variables to be used when initializing the chart
            window.customDateRange = {
              start: start,
              end: end,
              data: data
            };
            
            // Reinitialize the chart
            initTradingViewWidget();
          } else {
            console.log('No data received from direct API request from custom range button');
          }
        })
        .catch(error => {
          console.error('Error in direct API request from custom range button:', error);
        });
    } catch (error) {
      console.error('Error parsing dates:', error);
    }
  });

  // Initialize the widget on page load
  initTradingViewWidget();
});
