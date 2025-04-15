# Monitoring and Health Checks

This document provides information about the monitoring and health check endpoints available in the TradingView InfluxDB POC. These endpoints can be used to monitor the health and performance of the application.

## Health Check Endpoints

The application provides several health check endpoints that can be used by monitoring tools to check the health of the application and its dependencies.

### Basic Health Check

**Endpoint:** `GET /api/health`

This endpoint returns a simple health check response indicating that the server is running.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2025-04-15T19:53:57.123Z",
  "service": "tradingview-influxdb-poc"
}
```

**Status Codes:**

- 200: The server is running
- 500: An error occurred

### Detailed Health Check

**Endpoint:** `GET /api/health/detailed`

This endpoint performs a more detailed health check, including checking the connection to InfluxDB and the status of downsampling tasks.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2025-04-15T19:53:57.123Z",
  "service": "tradingview-influxdb-poc",
  "version": "1.0.0",
  "uptime": 3600,
  "memory": {
    "rss": 123456789,
    "heapTotal": 98765432,
    "heapUsed": 87654321,
    "external": 12345678
  },
  "dependencies": {
    "influxdb": {
      "status": "ok",
      "url": "http://localhost:8086",
      "bucket": "trades",
      "org": "my-org"
    },
    "downsamplingTasks": {
      "status": "ok",
      "count": 6
    }
  }
}
```

**Status Values:**

- `ok`: All components are functioning properly
- `degraded`: Some components have issues but the application is still functional
- `error`: Critical components are not functioning

**Status Codes:**

- 200: The server is running (even if some components are degraded)
- 500: Critical components are not functioning

### Status Check

**Endpoint:** `GET /api/status`

This endpoint returns the current status of the application and its components.

**Response:**

```json
{
  "application": {
    "status": "ok",
    "uptime": 3600
  },
  "database": {
    "status": "ok"
  },
  "downsampling": {
    "status": "ok",
    "tasks": 6
  }
}
```

**Status Values:**

- `ok`: The component is functioning properly
- `degraded` or `stale`: The component has issues but is still functional
- `error`: The component is not functioning
- `missing`: The component is missing (e.g., downsampling tasks not set up)
- `unknown`: The status could not be determined

**Status Codes:**

- 200: The application is running (even if some components are degraded)
- 500: Critical components are not functioning

## Metrics Endpoint

**Endpoint:** `GET /api/metrics`

This endpoint returns basic metrics about the application, including memory usage and data counts.

**Response:**

```json
{
  "timestamp": "2025-04-15T19:53:57.123Z",
  "uptime_seconds": 3600,
  "memory_usage_mb": {
    "rss": 123.46,
    "heapTotal": 98.77,
    "heapUsed": 87.65,
    "external": 12.35
  },
  "trade_count": 1000000,
  "downsampled_counts": {
    "1m": 500000,
    "5m": 100000,
    "15m": 33333,
    "1h": 8333,
    "4h": 2083,
    "1d": 417
  }
}
```

**Status Codes:**

- 200: Metrics collected successfully
- 500: An error occurred while collecting metrics

## Integration with Monitoring Tools

The health check and metrics endpoints can be integrated with various monitoring tools to monitor the health and performance of the application.

### Prometheus

To integrate with Prometheus, you can use the `/api/metrics` endpoint. You'll need to configure Prometheus to scrape this endpoint.

Example Prometheus configuration:

```yaml
scrape_configs:
  - job_name: 'tradingview-influxdb-poc'
    scrape_interval: 15s
    metrics_path: '/api/metrics'
    static_configs:
      - targets: ['localhost:3000']
```

### Kubernetes Liveness and Readiness Probes

If you're deploying the application in Kubernetes, you can use the health check endpoints for liveness and readiness probes.

Example Kubernetes configuration:

```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /api/health/detailed
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
```

### Docker Healthcheck

If you're using Docker, you can configure a healthcheck in your Docker Compose file:

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
```

## Setting Up Alerts

You can set up alerts based on the health check and metrics endpoints to be notified when there are issues with the application.

### Prometheus Alerting

If you're using Prometheus, you can set up alerts based on the metrics endpoint.

Example Prometheus alert rules:

```yaml
groups:
- name: tradingview-influxdb-poc
  rules:
  - alert: ApplicationDown
    expr: up{job="tradingview-influxdb-poc"} == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Application is down"
      description: "The application has been down for more than 1 minute."
  
  - alert: HighMemoryUsage
    expr: memory_usage_mb{job="tradingview-influxdb-poc", type="heapUsed"} > 1024
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High memory usage"
      description: "The application is using more than 1GB of memory for more than 5 minutes."
```

### Custom Monitoring Script

You can also create a custom monitoring script that periodically checks the health check endpoints and sends alerts if there are issues.

Example shell script:

```bash
#!/bin/bash

# Check the health endpoint
response=$(curl -s http://localhost:3000/api/health/detailed)
status=$(echo $response | jq -r '.status')

if [ "$status" != "ok" ]; then
  # Send an alert
  echo "Application is not healthy: $status"
  # Add code to send an email, Slack message, etc.
fi
```

## Best Practices

1. **Regular Monitoring**: Set up regular monitoring of the health check and metrics endpoints to detect issues early.

2. **Alerting**: Configure alerts based on the health check and metrics endpoints to be notified when there are issues.

3. **Logging**: In addition to monitoring the endpoints, also set up centralized logging to capture application logs.

4. **Dashboard**: Create a dashboard to visualize the metrics and health status over time.

5. **Documentation**: Keep this documentation up to date with any changes to the monitoring endpoints.

## Troubleshooting

If you encounter issues with the monitoring endpoints, check the following:

1. **Application Logs**: Check the application logs for any errors related to the monitoring endpoints.

2. **InfluxDB Connection**: Verify that the application can connect to InfluxDB.

3. **Downsampling Tasks**: Check if the downsampling tasks are set up and running correctly.

4. **Memory Usage**: Monitor the memory usage of the application to ensure it's not running out of memory.

5. **Network Connectivity**: Ensure that the monitoring tools can reach the application endpoints.

## Conclusion

The monitoring and health check endpoints provide a way to monitor the health and performance of the TradingView InfluxDB POC. By integrating these endpoints with monitoring tools and setting up alerts, you can ensure that the application is running smoothly and detect issues early.
