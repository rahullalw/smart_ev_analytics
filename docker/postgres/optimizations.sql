-- Database Optimization Scripts
-- Apply these optimizations for improved performance

-- ============================================
-- Optimization 1: Index on vehicle_meter_mapping.meter_id
-- ============================================
-- This index speeds up JOINs from meter_telemetry -> vehicle_meter_mapping
-- Partial index only includes active mappings for smaller size
CREATE INDEX IF NOT EXISTS idx_vehicle_meter_mapping_meter_id 
    ON vehicle_meter_mapping (meter_id) 
    WHERE is_active = TRUE;

-- ============================================
-- Optimization 2: FILLFACTOR for Hot Store Tables
-- ============================================
-- Reserve 30% free space on each page for in-place UPDATEs
-- Reduces page splits and contention on high-update tables
ALTER TABLE meter_state SET (fillfactor = 70);
ALTER TABLE vehicle_state SET (fillfactor = 70);

-- Note: To apply FILLFACTOR changes, run VACUUM FULL during maintenance window
-- VACUUM FULL meter_state;
-- VACUUM FULL vehicle_state;

-- ============================================
-- Verification Queries
-- ============================================

-- Verify new index exists
SELECT schemaname, tablename, indexname, indexdef 
FROM pg_indexes 
WHERE indexname = 'idx_vehicle_meter_mapping_meter_id';

-- Verify FILLFACTOR settings
SELECT 
  c.relname as tablename,
  c.reloptions 
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname IN ('meter_state', 'vehicle_state')
  AND n.nspname = 'public';

-- Check hot update percentage (should be >90% after FILLFACTOR tuning)
SELECT 
  schemaname, 
  relname as tablename,
  n_tup_upd as total_updates,
  n_tup_hot_upd as hot_updates,
  ROUND(100.0 * n_tup_hot_upd / NULLIF(n_tup_upd, 0), 2) as hot_update_pct
FROM pg_stat_user_tables
WHERE relname IN ('meter_state', 'vehicle_state');
