-- Remove duplicate backup_files rows (keep the one with the lowest id per filename)
DELETE FROM backup_files
WHERE id NOT IN (
  SELECT MIN(id) FROM backup_files GROUP BY filename
);

-- Prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_files_filename_unique ON backup_files (filename);
