ALTER TABLE cafes ADD COLUMN IF NOT EXISTS user_verified boolean DEFAULT false;
ALTER TABLE cafes ADD COLUMN IF NOT EXISTS user_verified_at timestamp with time zone;
