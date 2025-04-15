const express = require('express');
const router = express.Router();
const { influxDB, config } = require('../config/influxdb');

/**
 * Health check routes for monitoring the application and its dependencies.
 * These endpoints can be used by monitoring tools to check the health of the application.
 */

// Basic health check - returns 200 OK if the server is running
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'tradingview-influxdb-poc'
  });
});

// Detailed health check - checks InfluxDB connection and returns detailed status
router.get('/health/detailed', async (req, res) => {
  try {
    const healthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'tradingview-influxdb-poc',
      version: process.env.npm_package_version || require('../../package.json').version,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      dependencies: {
        influxdb: {
          status: 'unknown',
          url: config.url,
          bucket: config.bucket,
          org: config.org
        }
      }
    };

    // Check InfluxDB connection
    try {
      const queryApi = influxDB.getQueryApi(config.org);
      const query = `from(bucket: "${config.bucket}") |> range(start: -1m) |> limit(n: 1)`;
      await queryApi.collectRows(query);
      
      healthStatus.dependencies.influxdb.status = 'ok';
    } catch (error) {
      healthStatus.dependencies.influxdb.status = 'error';
      healthStatus.dependencies.influxdb.error = error.message;
      healthStatus.status = 'degraded';
    }

    // Check if downsampling tasks are set up
    try {
      const { TasksAPI } = require('@influxdata/influxdb-client-apis');
      const tasksApi = new TasksAPI(influxDB);
      const tasks = await tasksApi.getTasks();
      
      const downsamplingTasks = tasks.tasks.filter(t => t.name.startsWith('Downsample_Trades_'));
      
      healthStatus.dependencies.downsamplingTasks = {
        status: downsamplingTasks.length > 0 ? 'ok' : 'missing',
        count: downsamplingTasks.length
      };
      
      if (downsamplingTasks.length === 0) {
        healthStatus.status = 'degraded';
      }
    } catch (error) {
      healthStatus.dependencies.downsamplingTasks = {
        status: 'error',
        error: error.message
      };
      healthStatus.status = 'degraded';
    }

    // Return appropriate status code
    const statusCode = healthStatus.status === 'ok' ? 200 : 
                      healthStatus.status === 'degraded' ? 200 : 500;
    
    res.status(statusCode).json(healthStatus);
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      service: 'tradingview-influxdb-poc',
      error: error.message
    });
  }
});

// Metrics endpoint - returns basic metrics for monitoring
router.get('/metrics', async (req, res) => {
  try {
    const metrics = {
      timestamp: new Date().toISOString(),
      uptime_seconds: process.uptime(),
      memory_usage_mb: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024 * 100) / 100,
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024 * 100) / 100,
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
        external: Math.round(process.memoryUsage().external / 1024 / 1024 * 100) / 100
      }
    };

    // Get trade counts from InfluxDB
    try {
      const queryApi = influxDB.getQueryApi(config.org);
      
      // Count raw trades
      const tradeCountQuery = `
        from(bucket: "${config.bucket}")
          |> range(start: 0)
          |> filter(fn: (r) => r._measurement == "trade")
          |> count()
          |> yield(name: "count")
      `;
      
      const tradeCountResult = await queryApi.collectRows(tradeCountQuery);
      
      if (tradeCountResult.length > 0) {
        metrics.trade_count = tradeCountResult[0]._value;
      }
      
      // Count downsampled data for each resolution
      const resolutions = ['1m', '5m', '15m', '1h', '4h', '1d'];
      metrics.downsampled_counts = {};
      
      for (const resolution of resolutions) {
        const downsampledCountQuery = `
          from(bucket: "${config.bucket}")
            |> range(start: 0)
            |> filter(fn: (r) => r._measurement == "trade_ohlc_${resolution}")
            |> count()
            |> yield(name: "count")
        `;
        
        const downsampledCountResult = await queryApi.collectRows(downsampledCountQuery);
        
        if (downsampledCountResult.length > 0) {
          metrics.downsampled_counts[resolution] = downsampledCountResult[0]._value;
        } else {
          metrics.downsampled_counts[resolution] = 0;
        }
      }
    } catch (error) {
      metrics.database_error = error.message;
    }

    res.status(200).json(metrics);
  } catch (error) {
    console.error('Metrics error:', error);
    res.status(500).json({
      error: 'Failed to collect metrics',
      message: error.message
    });
  }
});

// Status endpoint - returns the current status of the application and its components
router.get('/status', async (req, res) => {
  try {
    // Get the status of the application components
    const status = {
      application: {
        status: 'ok',
        uptime: process.uptime()
      },
      database: {
        status: 'unknown'
      },
      downsampling: {
        status: 'unknown'
      }
    };

    // Check InfluxDB connection
    try {
      const queryApi = influxDB.getQueryApi(config.org);
      const query = `from(bucket: "${config.bucket}") |> range(start: -1m) |> limit(n: 1)`;
      await queryApi.collectRows(query);
      
      status.database.status = 'ok';
    } catch (error) {
      status.database.status = 'error';
      status.database.error = error.message;
    }

    // Check downsampling tasks
    try {
      const { TasksAPI } = require('@influxdata/influxdb-client-apis');
      const tasksApi = new TasksAPI(influxDB);
      const tasks = await tasksApi.getTasks();
      
      const downsamplingTasks = tasks.tasks.filter(t => t.name.startsWith('Downsample_Trades_'));
      
      if (downsamplingTasks.length > 0) {
        // Check if any tasks have run recently
        let recentRuns = false;
        
        for (const task of downsamplingTasks) {
          const runs = await tasksApi.getTasksIDRuns({ taskID: task.id });
          
          if (runs && runs.runs && runs.runs.length > 0) {
            const latestRun = runs.runs[0];
            const runTime = new Date(latestRun.scheduledFor);
            const now = new Date();
            const hoursSinceLastRun = (now - runTime) / (1000 * 60 * 60);
            
            if (hoursSinceLastRun < 24) {
              recentRuns = true;
              break;
            }
          }
        }
        
        status.downsampling.status = recentRuns ? 'ok' : 'stale';
        status.downsampling.tasks = downsamplingTasks.length;
      } else {
        status.downsampling.status = 'missing';
      }
    } catch (error) {
      status.downsampling.status = 'error';
      status.downsampling.error = error.message;
    }

    // Determine overall status
    if (status.database.status === 'error' || status.downsampling.status === 'error') {
      status.application.status = 'error';
    } else if (status.database.status === 'ok' && 
              (status.downsampling.status === 'ok' || status.downsampling.status === 'stale')) {
      status.application.status = 'ok';
    } else {
      status.application.status = 'degraded';
    }

    // Return appropriate status code
    const statusCode = status.application.status === 'ok' ? 200 : 
                      status.application.status === 'degraded' ? 200 : 500;
    
    res.status(statusCode).json(status);
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      application: {
        status: 'error',
        error: error.message
      }
    });
  }
});

module.exports = router;
