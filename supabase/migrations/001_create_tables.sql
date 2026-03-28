-- Create cafes table
create table if not exists cafes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat float not null,
  lng float not null,
  address text,
  foursquare_id text unique,
  google_place_id text,
  laptop_allowed boolean,
  wifi_rating int check (wifi_rating between 1 and 5),
  seating_rating int check (seating_rating between 1 and 5),
  google_rating float,
  foursquare_rating float,
  confidence text not null default 'unconfirmed' check (confidence in ('verified', 'inferred', 'unconfirmed')),
  last_updated timestamp with time zone default now()
);

-- Create submissions table
create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references cafes(id) on delete cascade,
  laptop_allowed boolean,
  wifi_rating int check (wifi_rating between 1 and 5),
  seating_rating int check (seating_rating between 1 and 5),
  notes text,
  created_at timestamp with time zone default now()
);

-- Index for geo queries
create index if not exists idx_cafes_lat_lng on cafes (lat, lng);
