CREATE TABLE IF NOT EXISTS city_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_name text UNIQUE,
  last_searched timestamp with time zone DEFAULT now(),
  cafe_ids uuid[]
);
