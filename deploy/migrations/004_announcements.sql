-- Add can_announce column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_announce BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing admins should automatically have can_announce = TRUE
UPDATE users SET can_announce = TRUE WHERE role = 'admin';
