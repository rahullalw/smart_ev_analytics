# Smart EV Analytics - High-Scale Energy Ingestion Engine

**Production-Grade EV Fleet Telemetry Processing System**

A NestJS-based backend system designed to handle high-throughput ingestion of telemetry data from 10,000+ smart meters and electric vehicles, processing 14.4 million records per day (~14.4K devices × 1,440 minutes/day).

## System Architecture

### Core Design Principles

1. **Hot/Cold Store Separation**
   - **Hot Store**: Latest state for real-time dashboards (max 10K rows)
   - **Cold Store**: Time-partitioned historical data for analytics

2. **Dual-Write Pattern**
   - Atomictic UPSERT to hot store + INSERT to cold store in single transaction
   - Guarantees consistency between operational and analytical datastores

3. **Time-Based Partitioning**
   - Monthly PostgreSQL partitions (~432M rows each)
   - Enables partition pruning for sub-second analytics queries

4. **Explicit Performance Optimization**
   - No ORM overhead - raw SQL with `pg` driver
   - Composite indexes on `(device_id, recorded_at DESC)`
   - Connection pooling (50 connections) for high concurrency

## Project Structure

```
src/
├── database/
│   └── database.module.ts          # Global pg connection pool
├── telemetry/
│   ├── dto/
│   │   └── telemetry.dto.ts        # DTOs with class-validator
│   ├── ingestion.service.ts        # Dual-write transaction logic
│   └── telemetry.module.ts
├── analytics/
│   ├── analytics.service.ts        # Optimized analytical queries
│   └── analytics.module.ts
├── telemetry.controller.ts         # POST /v1/telemetry/meter|vehicle
├── analytics.controller.ts         # GET /v1/analytics/performance/:vehicleId
└── main.ts                         # Global validation pipe

docker/
└── postgres/
    └── init.sql                    # Schema with partitions & indexes

test/
├── data-generator.service.ts       # Load testing utility
└── run-load-test.ts               # Test runner
```

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Docker & Docker Compose
- PostgreSQL client (optional, for manual queries)

### Installation

```bash
# Install dependencies
npm install

# Start PostgreSQL with schema
docker-compose up -d

# Verify database is running
docker exec -it smart_ev_db psql -U admin -d smart_ev -c "\dt"

# Start development server
npm run start:dev
```

The API will be available at `http://localhost:3000`

### API Endpoints

#### Ingestion

```bash
# Meter telemetry
curl -X POST http://localhost:3000/v1/telemetry/meter \
  -H "Content-Type: application/json" \
  -d '{
    "meterId": "550e8400-e29b-41d4-a716-446655440000",
    "kwhConsumedAc": 50.5,
    "voltage": 230,
    "timestamp": "2026-02-09T14:00:00Z"
  }'

# Vehicle telemetry  
curl -X POST http://localhost:3000/v1/telemetry/vehicle \
  -H "Content-Type: application/json" \
  -d '{
    "vehicleId": "660e8400-e29b-41d4-a716-446655440000",
    "soc": 75.5,
    "kwhDeliveredDc": 40.3,
    "batteryTemp": 25.5,
    "timestamp": "2026-02-09T14:00:00Z"
  }'
```

#### Analytics

```bash
# Vehicle performance (last 24 hours)
curl http://localhost:3000/v1/analytics/performance/660e8400-e29b-41d4-a716-446655440000
```

Response:

```json
{
  "vehicleId": "660e8400-e29b-41d4-a716-446655440000",
  "totalAcConsumption": 120.5,
  "totalDcDelivery": 98.3,
  "efficiencyRatio": 0.815,
  "avgBatteryTemp": 26.3,
  "dataPoints": 1440
}
```

## Database Schema

### Hot Store (Operational)

```sql
-- Latest meter state (O(1) lookups)
meter_state (
  meter_id UUID PRIMARY KEY,
  kwh_consumed_ac DECIMAL(10,3),
  voltage DECIMAL(6,2),
  last_updated TIMESTAMPTZ
)

-- Latest vehicle state (O(1) lookups)
vehicle_state (
  vehicle_id UUID PRIMARY KEY,
  soc DECIMAL(5,2),
  kwh_delivered_dc DECIMAL(10,3),
  battery_temp DECIMAL(5,2),
  last_updated TIMESTAMPTZ
)

-- Vehicle-meter correlation mapping
vehicle_meter_mapping (
  vehicle_id UUID,
  meter_id UUID,
  is_active BOOLEAN,
  PRIMARY KEY (vehicle_id, meter_id)
)
```

### Cold Store (Analytics)

```sql
-- Partitioned by recorded_at (monthly)
meter_telemetry (
  id BIGSERIAL,
  meter_id UUID,
  kwh_consumed_ac DECIMAL(10,3),
  voltage DECIMAL(6,2),
  recorded_at TIMESTAMPTZ,  -- Partition key
  ingested_at TIMESTAMPTZ
) PARTITION BY RANGE (recorded_at);

vehicle_telemetry (
  id BIGSERIAL,
  vehicle_id UUID,
  soc DECIMAL(5,2),
  kwh_delivered_dc DECIMAL(10,3),
  battery_temp DECIMAL(5,2),
  recorded_at TIMESTAMPTZ,  -- Partition key
  ingested_at TIMESTAMPTZ
) PARTITION BY RANGE (recorded_at);

-- Composite indexes for time-range queries
CREATE INDEX idx_meter_telemetry_meter_time 
  ON meter_telemetry (meter_id, recorded_at DESC);

CREATE INDEX idx_vehicle_telemetry_vehicle_time 
  ON vehicle_telemetry (vehicle_id, recorded_at DESC);
```

## Performance Characteristics

### Write Path

- **Latency**: ~10-20ms per request (synchronous dual-write)
- **Throughput**: ~5,000 req/sec theoretical max (50 connection pool)
- **Current Load**: ~333 req/sec (10K devices × 2 streams / 60s)
- **Headroom**: 15x capacity for future growth

### Read Path (Analytics)

- **Hot Store**: Microsecond lookups (in-memory, 10K rows)
- **Cold Store**: Sub-second queries via:
  - Partition pruning (24h query = 1-2 partitions only)
  - Index scans (no full table scans)
  - Separate aggregations (avoids Cartesian product)

### Storage

- **Daily Ingestion**: 14.4M rows (~1.4GB uncompressed)
- **Annual Growth**: ~5.2B rows (~520GB)
- **Partition Management**: Drop old partitions after retention period (e.gkeep 90 days = ~140GB active)

## Scaling Strategy

### Horizontal Scaling

1. **App Tier**: Add NestJS instances behind load balancer
2. **Database**: PostgreSQL handles write concurrency natively
3. **Read Replicas**: Route analytics queries to replicas

### Vertical Scaling

- Increase PostgreSQL `shared_buffers` and `work_mem`
- Use larger connection pool (100-200 connections)
- Add NVMe storage for partition hot data

### Future Optimizations (Not Implemented)

1. **Async Cold Store Writes**: Use Redis/RabbitMQ for cold store writes (reduce API latency to ~5ms)
2. **Batch Writes**: Client-side batching (10-50 records/request) + PostgreSQL COPY command
3. **Caching Layer**: Redis for frequently accessed vehicles (1-min TTL)
4. **Compression**: Use PostgreSQL TOAST compression for historical data

## Load Testing

### Quick Test

```bash
# Send single batch (20 records for 10 devices)
npm run test:load single 10

# Run full test suite (mappings + multiple batches)
npm run test:load full 10
```

### Extended Load Test

```bash
# 3-minute load test with 100 devices (200 req/min)
npm run test:load load 100 180
```

## Design Tradeoffs

### Decided

| Decision | Pro | Con | Rationale |
|----------|-----|-----|-----------|
| Synchronous writes | Simple, consistent | Higher latency (10-20ms) | Prototype simplicity; production would use async |
| Monthly partitions | Fewer partitions | Larger partition scans | Balance between maintenance and query performance |
| No batch writes | Real-time data | Higher overhead | Simplifies client; production would batch |
| Raw SQL (no ORM) | Full control, faster | More boilerplate | Performance critical, worth the verbosity |
| 1:1 vehicle-meter | Simple correlation | Doesn't handle shared chargers | Extendable to N:M with session table |

### Rejected

| Approach | Why Rejected |
|----------|--------------|
| Single polymorphic table | Complicates indexing, harder to partition |
| TimescaleDB | Adds dependency, PostgreSQL partitioning sufficient |
| Materialized views | Refresh latency, queries already fast |
| ORM (TypeORM/Prisma) | Hides performance issues, complicates UPSERT |

## Correlation Strategy

**Problem**: AC (meter) and DC (vehicle) data arrive independently with different timestamps.

**Solution**:

1. Use `vehicle_meter_mapping` table for flexible 1:1 or N:M correlation
2. Aggregate separately (`SUM(ac)` and `SUM(dc)` in CTEs)
3. `CROSS JOIN` aggregated results (no Cartesian product)
4. `LEFT JOIN` from vehicle → meter (keeps vehicles without meters)

**Why This Works**:

- Separate aggregations avoid row explosion
- Time-range filtering applies partition pruning
- Handles missing meter data gracefully (returns 0 for AC)

## Monitoring & Observability (Future)

```sql
-- Query performance analysis
EXPLAIN ANALYZE 
SELECT ...;  -- Verify "Index Scan" and partition pruning

-- Ingestion lag monitoring
SELECT 
  AVG(EXTRACT(EPOCH FROM (ingested_at - recorded_at))) AS avg_lag_seconds
FROM vehicle_telemetry
WHERE ingested_at >= NOW() - INTERVAL '1 hour';

-- Partition size monitoring
SELECT 
  tableoid::regclass AS partition,
  pg_size_pretty(pg_total_relation_size(tableoid)) AS size,
  COUNT(*) AS row_count
FROM vehicle_telemetry
GROUP BY tableoid;
```

## Production Checklist

- [ ] Replace `dev_password` with secure credentials
- [ ] Enable SSL for PostgreSQL connections
- [ ] Set up automated partition creation (pg_cron)
- [ ] Configure retention policy (auto-drop old partitions)
- [ ] Add Prometheus metrics for ingestion rate
- [ ] Implement circuit breaker for database failures
- [ ] Set up read replicas for analytics queries
- [ ] Add request rate limiting
- [ ] Configure log aggregation (ELK/DataDog)
- [ ] Implement health check endpoints

## Contributing

### Running Tests

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

### Code Quality

```bash
# Lint
npm run lint

# Format
npm run format
```

## License

UNLICENSED (Private/Internal Use)

---

**Built with**: NestJS 10, PostgreSQL 15, TypeScript 5, pg driver, class-validator

**Architecture**: Hot/Cold Store, Time-based Partitioning, Dual-Write Pattern

**Performance**: 14.4M records/day, <20ms write latency, <1s analytics queries
