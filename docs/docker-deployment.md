# Docker Deployment Guide

This document provides instructions for deploying the TradingView InfluxDB POC using Docker and Docker Compose. This approach simplifies the setup process and ensures consistent deployment across different environments.

## Prerequisites

Before you begin, ensure you have the following installed:

1. **Docker**
   - [Install Docker](https://docs.docker.com/get-docker/)
   - Verify installation with `docker --version`

2. **Docker Compose**
   - [Install Docker Compose](https://docs.docker.com/compose/install/)
   - Verify installation with `docker-compose --version`

3. **TradingView Charting Library**
   - Requires a license from TradingView
   - Not included in this repository due to licensing restrictions

## Quick Start

1. Clone the repository:

```bash
git clone https://github.com/jeansouza/tradingview-influxdb-poc.git
cd tradingview-influxdb-poc
```

2. Set up the TradingView Charting Library:
   - Download the library from your TradingView account
   - Extract the files to the `public/charting_library` and `public/datafeeds` directories

3. Start the services:

```bash
docker-compose up -d
```

4. Access the application at http://localhost:3000

## Docker Compose Configuration

The `docker-compose.yml` file defines two services:

1. **InfluxDB**: A time-series database for storing trade data
2. **App**: The Node.js application that serves the frontend and API

### Environment Variables

The Docker Compose configuration includes default environment variables for both services. You can customize these by:

1. Editing the `docker-compose.yml` file directly
2. Creating a `.env` file in the same directory as the `docker-compose.yml` file

Example `.env` file:

```
# InfluxDB Configuration
INFLUXDB_USERNAME=admin
INFLUXDB_PASSWORD=password123
INFLUXDB_ORG=my-org
INFLUXDB_BUCKET=trades
INFLUXDB_ADMIN_TOKEN=my-super-secret-token

# Application Configuration
APP_PORT=3000
NODE_ENV=production
```

## Volumes

The Docker Compose configuration includes the following volumes:

1. **influxdb-storage**: Persistent storage for InfluxDB data
2. **influxdb-config**: Persistent storage for InfluxDB configuration

Additionally, the application service mounts the following directories as volumes:

- `./public`: Frontend assets, including the TradingView Charting Library
- `./src`: Backend source code
- `./package.json` and `./package-lock.json`: Node.js dependencies
- `./.env`: Environment variables

This allows you to make changes to the source code without rebuilding the Docker image.

## Customizing the Deployment

### Using High-Memory Mode

To use high-memory mode for generating large datasets, modify the `Dockerfile` to use the high-memory command:

```dockerfile
# Command to run the application in high-memory mode
CMD ["node", "--max-old-space-size=8192", "start-server.js"]
```

Then rebuild and restart the services:

```bash
docker-compose build app
docker-compose up -d app
```

### Changing Ports

To change the ports used by the services, modify the `ports` section in the `docker-compose.yml` file:

```yaml
services:
  influxdb:
    ports:
      - "8087:8086"  # Map port 8087 on the host to port 8086 in the container
  
  app:
    ports:
      - "8080:3000"  # Map port 8080 on the host to port 3000 in the container
```

### Using a Different InfluxDB Instance

If you want to use an existing InfluxDB instance instead of the one provided by Docker Compose:

1. Remove the `influxdb` service from the `docker-compose.yml` file
2. Update the `INFLUXDB_URL` environment variable in the `app` service to point to your InfluxDB instance
3. Update the other InfluxDB environment variables as needed

## Managing the Deployment

### Starting the Services

```bash
docker-compose up -d
```

This command starts the services in detached mode (in the background).

### Stopping the Services

```bash
docker-compose down
```

This command stops and removes the containers, but preserves the volumes.

### Viewing Logs

```bash
# View logs for all services
docker-compose logs

# View logs for a specific service
docker-compose logs app

# Follow logs in real-time
docker-compose logs -f
```

### Restarting a Service

```bash
docker-compose restart app
```

### Rebuilding a Service

If you make changes to the `Dockerfile` or `package.json`, you need to rebuild the service:

```bash
docker-compose build app
docker-compose up -d app
```

## Generating Test Data

To generate test data, you can use the API endpoint:

```bash
curl "http://localhost:3000/api/trades/generate?symbol=BTCUSD&count=100000"
```

For large datasets, you may need to use the high-memory mode as described above.

## Setting Up Downsampling Tasks

After generating test data, you need to set up the downsampling tasks. You can do this by executing a command inside the container:

```bash
docker-compose exec app node src/scripts/setupDownsamplingTasks.js
```

## Running Downsampling Tasks

You can manually trigger the downsampling tasks:

```bash
# Run a specific task
docker-compose exec app node src/scripts/runDownsamplingTask.js Downsample_Trades_1m

# Run all tasks
docker-compose exec app node src/scripts/runDownsamplingTask.js all
```

## Verifying the Setup

You can verify that everything is set up correctly:

```bash
# Check if InfluxDB is running
docker-compose exec app node src/scripts/checkInfluxDBStatus.js

# Verify downsampling tasks
docker-compose exec app node src/scripts/verifyDownsamplingTasks.js

# Count trades in the database
docker-compose exec app node src/scripts/countTrades.js

# Check downsampled data
docker-compose exec app node src/scripts/checkDownsampledData.js
```

## Production Deployment Considerations

For a production deployment, consider the following:

### Security

1. **Use Strong Passwords**: Change the default passwords in the `docker-compose.yml` file
2. **Secure InfluxDB**: Configure authentication and authorization for InfluxDB
3. **Use HTTPS**: Set up a reverse proxy with SSL/TLS termination
4. **Restrict Access**: Use network policies to restrict access to the services

### Performance

1. **Resource Allocation**: Allocate appropriate CPU and memory resources to the containers
2. **Volume Performance**: Use high-performance storage for the volumes
3. **Network Configuration**: Optimize network settings for high throughput

### Monitoring

1. **Container Monitoring**: Use Docker's built-in health checks and monitoring tools
2. **Application Monitoring**: Implement application-level monitoring and alerting
3. **Log Management**: Set up centralized logging with tools like ELK Stack or Graylog

### Backup and Recovery

1. **Volume Backups**: Regularly back up the InfluxDB volumes
2. **Database Backups**: Use InfluxDB's backup and restore functionality
3. **Disaster Recovery Plan**: Develop a plan for recovering from failures

## Troubleshooting

### Container Fails to Start

If a container fails to start, check the logs:

```bash
docker-compose logs app
```

Common issues include:

1. **Port Conflicts**: Another service is using the same port
2. **Missing Environment Variables**: Required environment variables are not set
3. **Volume Permission Issues**: The container doesn't have permission to access the volumes

### InfluxDB Connection Issues

If the application can't connect to InfluxDB:

1. Check if the InfluxDB container is running:
   ```bash
   docker-compose ps influxdb
   ```

2. Check the InfluxDB logs:
   ```bash
   docker-compose logs influxdb
   ```

3. Verify the InfluxDB environment variables in the `docker-compose.yml` file

### TradingView Library Not Found

If you see a message that the TradingView Charting Library is not installed:

1. Make sure you have downloaded the library from your TradingView account
2. Extract the files to the `public/charting_library` and `public/datafeeds` directories
3. Restart the application:
   ```bash
   docker-compose restart app
   ```

## Conclusion

You should now have a fully functional TradingView InfluxDB POC running in Docker containers. This deployment approach simplifies the setup process and ensures consistent deployment across different environments.

For more information, refer to the other documentation files:

- [API Documentation](api.md)
- [Downsampling System Documentation](downsampling.md)
- [Setup Guide](setup.md)
- [Performance Testing Results](performance.md)
