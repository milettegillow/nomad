export interface Cafe {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  foursquare_id?: string;
  google_place_id?: string;
  laptop_allowed: boolean | null;
  wifi_rating: number | null;
  seating_rating: number | null;
  google_rating: number | null;
  foursquare_rating: number | null;
  confidence: 'verified' | 'inferred' | 'unconfirmed';
  last_updated: string;
  blog_sources?: string[];
  work_summary?: string;
  enrichment_reason?: string;
  key_review_quote?: string;
  photo_url?: string;
  photo_name?: string;
}

export interface Submission {
  id: string;
  cafe_id: string;
  laptop_allowed: boolean | null;
  wifi_rating: number | null;
  seating_rating: number | null;
  notes: string | null;
  created_at: string;
}
