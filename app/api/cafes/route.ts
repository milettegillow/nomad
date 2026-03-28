import { supabase } from '@/lib/supabase';

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;

interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: unknown;
  types?: string[];
  reviews?: { text?: { text: string }; rating?: number }[];
}

async function fetchGoogleCafes(lat: number, lng: number): Promise<GooglePlace[]> {
  const url = 'https://places.googleapis.com/v1/places:searchNearby';
  const body = {
    includedTypes: ['cafe'],
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 2000,
      },
    },
  };

  console.log('[Google Places] Searching near:', lat, lng);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.regularOpeningHours,places.types,places.reviews',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok || !text) {
      console.error('[Google Places] Error:', res.status, text?.substring(0, 300));
      return [];
    }

    const data = JSON.parse(text);
    const places: GooglePlace[] = data.places || [];
    console.log('[Google Places] Found', places.length, 'cafes');
    return places;
  } catch (e) {
    console.error('[Google Places] Fetch error:', e);
    return [];
  }
}

export async function GET(request: Request) {
  console.log('[/api/cafes] === START ===');

  try {
    const { searchParams } = new URL(request.url);
    const lat = parseFloat(searchParams.get('lat') || '');
    const lng = parseFloat(searchParams.get('lng') || '');

    if (isNaN(lat) || isNaN(lng)) {
      return Response.json({ error: 'lat and lng required' }, { status: 400 });
    }

    const latDelta = 0.018;
    const lngDelta = 0.018 / Math.cos((lat * Math.PI) / 180);

    const { data: existing, error } = await supabase
      .from('cafes')
      .select('*')
      .gte('lat', lat - latDelta)
      .lte('lat', lat + latDelta)
      .gte('lng', lng - lngDelta)
      .lte('lng', lng + lngDelta);

    if (error) {
      console.error('[/api/cafes] Supabase error:', error);
      return Response.json({ error: 'Database error', details: error.message }, { status: 500 });
    }

    if (existing && existing.length >= 10) {
      console.log('[/api/cafes] Returning', existing.length, 'cached cafes');
      return Response.json(existing);
    }

    // Fetch from Google Places — no enrichment, just basic data
    const places = await fetchGoogleCafes(lat, lng);

    if (places.length === 0) {
      return Response.json(existing || []);
    }

    // Store reviews as JSON for the enrich endpoint to use later
    const cafesToUpsert = places
      .map((place) => {
        try {
          // Extract review texts to store temporarily
          const reviewTexts = (place.reviews || [])
            .slice(0, 5)
            .map(r => r.text?.text)
            .filter((t): t is string => !!t);

          return {
            name: place.displayName?.text || 'Unknown',
            lat: place.location?.latitude ?? lat,
            lng: place.location?.longitude ?? lng,
            address: place.formattedAddress || null,
            foursquare_id: null as string | null,
            google_place_id: place.id,
            laptop_allowed: null as boolean | null,
            wifi_rating: null as number | null,
            seating_rating: null as number | null,
            google_rating: place.rating ?? null,
            foursquare_rating: null as number | null,
            confidence: 'unconfirmed' as const,
            last_updated: new Date().toISOString(),
            // Store review texts and types for enrichment
            _reviews: reviewTexts,
            _types: place.types || [],
          };
        } catch (e) {
          console.error('[/api/cafes] Error processing place:', place.displayName?.text, e);
          return null;
        }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    // Separate internal fields before upserting
    const forSupabase = cafesToUpsert.map(({ _reviews, _types, ...rest }) => {
      void _reviews;
      void _types;
      return rest;
    });

    if (forSupabase.length > 0) {
      const { error: upsertError } = await supabase
        .from('cafes')
        .upsert(forSupabase, { onConflict: 'google_place_id' });

      if (upsertError) {
        console.error('[/api/cafes] Upsert error:', upsertError);
        return Response.json(forSupabase.map((c, i) => ({ ...c, id: `temp-${i}` })));
      }
    }

    // Re-fetch to get IDs
    const { data: allCafes } = await supabase
      .from('cafes')
      .select('*')
      .gte('lat', lat - latDelta)
      .lte('lat', lat + latDelta)
      .gte('lng', lng - lngDelta)
      .lte('lng', lng + lngDelta);

    console.log('[/api/cafes] Returning', allCafes?.length ?? 0, 'cafes');
    return Response.json(allCafes || []);

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[/api/cafes] UNHANDLED ERROR:', message);
    return Response.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
