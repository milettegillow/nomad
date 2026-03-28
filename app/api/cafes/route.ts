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
  editorialSummary?: { text: string };
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

  console.log('[Google Places] Request URL:', url);
  console.log('[Google Places] Request body:', JSON.stringify(body));

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.regularOpeningHours,places.types,places.editorialSummary',
      },
      body: JSON.stringify(body),
    });

    console.log('[Google Places] Response status:', res.status);

    const text = await res.text();
    console.log('[Google Places] Raw response (first 500 chars):', text.substring(0, 500));

    if (!res.ok) {
      console.error('[Google Places] Error response:', res.status, text);
      return [];
    }

    if (!text) {
      console.error('[Google Places] Empty response body');
      return [];
    }

    const data = JSON.parse(text);
    const places: GooglePlace[] = data.places || [];
    console.log('[Google Places] Results count:', places.length);
    if (places.length > 0) {
      console.log('[Google Places] First result:', places[0].displayName?.text, '—', places[0].formattedAddress);
    }
    return places;
  } catch (e) {
    console.error('[Google Places] Fetch/parse error:', e);
    return [];
  }
}

export async function GET(request: Request) {
  console.log('[/api/cafes] === Route handler START ===');

  try {
    const { searchParams } = new URL(request.url);
    const lat = parseFloat(searchParams.get('lat') || '');
    const lng = parseFloat(searchParams.get('lng') || '');

    console.log('[/api/cafes] Incoming params — lat:', searchParams.get('lat'), 'lng:', searchParams.get('lng'), '→ parsed:', lat, lng);

    if (isNaN(lat) || isNaN(lng)) {
      console.error('[/api/cafes] Invalid lat/lng');
      return Response.json({ error: 'lat and lng required' }, { status: 400 });
    }

    // ~2000m in degrees (rough approximation)
    const latDelta = 0.018;
    const lngDelta = 0.018 / Math.cos((lat * Math.PI) / 180);

    const { data: existing, error } = await supabase
      .from('cafes')
      .select('*')
      .gte('lat', lat - latDelta)
      .lte('lat', lat + latDelta)
      .gte('lng', lng - lngDelta)
      .lte('lng', lng + lngDelta);

    console.log('[/api/cafes] Supabase query — found:', existing?.length ?? 0, 'error:', error?.message ?? 'none');

    if (error) {
      console.error('[/api/cafes] Supabase query error:', error);
      return Response.json({ error: 'Database error', details: error.message }, { status: 500 });
    }

    if (existing && existing.length >= 10) {
      console.log('[/api/cafes] Returning', existing.length, 'cached cafes from Supabase');
      console.log('[/api/cafes] === Route handler END (cached) ===');
      return Response.json(existing);
    }

    // Fetch from Google Places
    console.log('[/api/cafes] Not enough cached results, fetching from Google Places...');
    const places = await fetchGoogleCafes(lat, lng);

    if (places.length === 0) {
      console.log('[/api/cafes] No Google Places results, returning existing:', existing?.length ?? 0);
      console.log('[/api/cafes] === Route handler END (no results) ===');
      return Response.json(existing || []);
    }

    const cafesToUpsert = places
      .map((place) => {
        try {
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
          };
        } catch (e) {
          console.error('[/api/cafes] Error processing place:', place.displayName?.text, e);
          return null;
        }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    console.log('[/api/cafes] Processed', cafesToUpsert.length, 'of', places.length, 'Google Places results');

    if (cafesToUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from('cafes')
        .upsert(cafesToUpsert, { onConflict: 'google_place_id' });

      if (upsertError) {
        console.error('[/api/cafes] Upsert error:', upsertError);
        console.log('[/api/cafes] === Route handler END (upsert failed, returning temp) ===');
        return Response.json(cafesToUpsert.map((c, i) => ({ ...c, id: `temp-${i}` })));
      }
    }

    // Re-fetch all cafes in the area
    const { data: allCafes, error: refetchError } = await supabase
      .from('cafes')
      .select('*')
      .gte('lat', lat - latDelta)
      .lte('lat', lat + latDelta)
      .gte('lng', lng - lngDelta)
      .lte('lng', lng + lngDelta);

    if (refetchError) {
      console.error('[/api/cafes] Re-fetch error:', refetchError);
      console.log('[/api/cafes] === Route handler END (refetch failed, returning temp) ===');
      return Response.json(cafesToUpsert.map((c, i) => ({ ...c, id: `temp-${i}` })));
    }

    console.log('[/api/cafes] Returning', allCafes?.length ?? 0, 'total cafes');
    console.log('[/api/cafes] === Route handler END (success) ===');
    return Response.json(allCafes || []);

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error('[/api/cafes] UNHANDLED ERROR:', message);
    if (stack) console.error('[/api/cafes] Stack:', stack);
    return Response.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
