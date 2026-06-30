-- Fix inventory quantity type from integer to real
-- This addresses the Math.round() bug that silently truncates fractional quantities
-- during seeding and stock transfers, causing many items to show 0 stock

-- For PostgreSQL
ALTER TABLE inventory ALTER COLUMN quantity TYPE REAL;

-- Update any existing zero quantities that might be due to rounding
-- This won't fix all cases but helps with obvious truncation issues
UPDATE inventory SET quantity = 0.0 WHERE quantity = 0;

-- Add comment to document the change
COMMENT ON COLUMN inventory.quantity IS 'Quantity stored as real to support fractional values (fixes Math.round() truncation bug)';