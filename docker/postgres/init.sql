-- High-Scale Energy Ingestion Engine - Database Schema
-- Hot/Cold Store Architecture with Time-based Partitioning

-- ============================================
-- HOT STORE: Latest Device State (Operational)
-- ============================================

-- Meter State: Latest known AC consumption data
CREATE TABLE meter_state (
    meter_id UUID PRIMARY KEY,
    kwh_consumed_ac DECIMAL(10,3) NOT NULL,
    voltage DECIMAL(6,2) NOT NULL,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vehicle State: Latest known DC delivery and battery data
CREATE TABLE vehicle_state (
    vehicle_id UUID PRIMARY KEY,
    soc DECIMAL(5,2) NOT NULL CHECK (soc >= 0 AND soc <= 100),
    kwh_delivered_dc DECIMAL(10,3) NOT NULL,
    battery_temp DECIMAL(5,2) NOT NULL,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vehicle-Meter Mapping: Correlation between vehicles and meters
-- Supports 1:1 or N:M relationships
CREATE TABLE vehicle_meter_mapping (
    vehicle_id UUID NOT NULL,
    meter_id UUID NOT NULL,
    mapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unmapped_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (vehicle_id, meter_id)
);

-- Indexes: Primary keys provide O(1) lookup, no additional indexes needed for hot store

-- ============================================
-- COLD STORE: Historical Telemetry (Analytics)
-- ============================================

-- Meter Telemetry: Append-only historical AC data
-- Partitioned by month for efficient time-range queries
CREATE TABLE meter_telemetry (
    id BIGSERIAL,
    meter_id UUID NOT NULL,
    kwh_consumed_ac DECIMAL(10,3) NOT NULL,
    voltage DECIMAL(6,2) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (recorded_at);

-- Vehicle Telemetry: Append-only historical DC data
-- Partitioned by month for efficient time-range queries
CREATE TABLE vehicle_telemetry (
    id BIGSERIAL,
    vehicle_id UUID NOT NULL,
    soc DECIMAL(5,2) NOT NULL CHECK (soc >= 0 AND soc <= 100),
    kwh_delivered_dc DECIMAL(10,3) NOT NULL,
    battery_temp DECIMAL(5,2) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (recorded_at);

-- ============================================
-- PARTITIONS: Monthly time-based partitions
-- ============================================

-- Create partitions for current and next month
-- February 2026
CREATE TABLE meter_telemetry_2026_02 PARTITION OF meter_telemetry
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE vehicle_telemetry_2026_02 PARTITION OF vehicle_telemetry
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- March 2026
CREATE TABLE meter_telemetry_2026_03 PARTITION OF meter_telemetry
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE vehicle_telemetry_2026_03 PARTITION OF vehicle_telemetry
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- April 2026 (for future data)
CREATE TABLE meter_telemetry_2026_04 PARTITION OF meter_telemetry
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE vehicle_telemetry_2026_04 PARTITION OF vehicle_telemetry
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- ============================================
-- INDEXES: Optimized for analytics queries
-- ============================================

-- Composite index for time-range queries per device
-- DESC ordering for recent-first access pattern
CREATE INDEX idx_meter_telemetry_meter_time 
    ON meter_telemetry (meter_id, recorded_at DESC);

CREATE INDEX idx_vehicle_telemetry_vehicle_time 
    ON vehicle_telemetry (vehicle_id, recorded_at DESC);

-- Optional: Index on ingested_at for monitoring ingestion lag
CREATE INDEX idx_meter_telemetry_ingested 
    ON meter_telemetry (ingested_at DESC);

CREATE INDEX idx_vehicle_telemetry_ingested 
    ON vehicle_telemetry (ingested_at DESC);

-- ============================================
-- COMMENTS: Schema documentation
-- ============================================

COMMENT ON TABLE meter_state IS 'Hot store: Latest known state per meter (10K rows max)';
COMMENT ON TABLE vehicle_state IS 'Hot store: Latest known state per vehicle (10K rows max)';
COMMENT ON TABLE meter_telemetry IS 'Cold store: Historical meter data (partitioned by month)';
COMMENT ON TABLE vehicle_telemetry IS 'Cold store: Historical vehicle data (partitioned by month)';
COMMENT ON TABLE vehicle_meter_mapping IS 'Correlation mapping between vehicles and meters';

COMMENT ON COLUMN meter_state.last_updated IS 'Timestamp from telemetry payload';
COMMENT ON COLUMN vehicle_state.last_updated IS 'Timestamp from telemetry payload';
COMMENT ON COLUMN meter_telemetry.recorded_at IS 'Timestamp from device (may have clock skew)';
COMMENT ON COLUMN meter_telemetry.ingested_at IS 'Timestamp when server received data';
COMMENT ON COLUMN vehicle_telemetry.recorded_at IS 'Timestamp from device (may have clock skew)';
COMMENT ON COLUMN vehicle_telemetry.ingested_at IS 'Timestamp when server received data';

-- ============================================
-- MAINTENANCE: Partition management helper
-- ============================================

-- Function to create next month's partition
-- Usage: SELECT create_next_month_partition('meter_telemetry', '2026-05-01');
CREATE OR REPLACE FUNCTION create_next_month_partition(
    table_name TEXT,
    partition_start DATE
) RETURNS VOID AS $$
DECLARE
    partition_name TEXT;
    partition_end DATE;
BEGIN
    partition_end := partition_start + INTERVAL '1 month';
    partition_name := table_name || '_' || TO_CHAR(partition_start, 'YYYY_MM');
    
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        table_name,
        partition_start,
        partition_end
    );
    
    RAISE NOTICE 'Created partition: %', partition_name;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust as needed for production)
-- GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO app_user;
