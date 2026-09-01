-- /history filters on vehicle_id + recorded_at and orders by recorded_at DESC.
-- Without this index every call full-scans tesla_vehicle_snapshots, which is
-- the main driver of D1 rows_read on this database.
CREATE INDEX IF NOT EXISTS idx_tvs_vehicle_time
  ON tesla_vehicle_snapshots(vehicle_id, recorded_at DESC);
