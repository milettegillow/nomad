import { supabase } from '@/lib/supabase';

const FOURSQUARE_API_KEY = process.env.FOURSQUARE_API_KEY!;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;

const WIFI_TAGS = ['wifi', 'wi-fi', 'free wifi', 'internet', 'wireless'];
const LAPTOP_TAGS = ['laptop', 'laptop friendly', 'work', 'coworking', 'remote work', 'study', 'workspace', 'digital nomad'];

function inferLaptopFriendly(tastes: string[], categories: { name: string }[]): boolean | null {
  const all = [
    ...tastes.map(t => t.toLowerCase()),
    ...categories.map(c => c.name.toLowerCase()),
  ];
  if (all.some(tag => LAPTOP_TAGS.some(lt => tag.includes(lt)))) return true;
  return null;
}

function inferHasWifi(tastes: string[]): boolean | null {
  const lower = tastes.map(t => t.toLowerCase());
  if (lower.some(tag => WIFI_TAGS.some(wt => tag.includes(wt)))) return true;
  return null;
}

async function fetchFoursquareCafes(lat: number, lng: number) {
  const url = new URL('https://api.foursquare.com/v3/places/search');
  url.searchParams.set('query', 'cafe');
  url.searchParams.set('ll', `${lat},${lng}`);
  url.searchParams.set('radius', '2000');
  url.searchParams.set('limit', '20');
  url.searchParams.set('fields', 'fsq_id,name,geocodes,location,rating,photos,tastes,categories');

  console.log('[Foursquare] Request URL:', url.toString());

  const res = await fetch(url.toString(), {
    headers: { Authorization: FOURSQUARE_API_KEY, Accept: 'application/json' },
  });

  console.log('[Foursquare] Response status:', res.status);

  if (!res.ok) {
    const body = await res.text();
    console.error('[Foursquare] Error body:', body);
    return [];
  }

  const data = await res.json();
  console.log('[Foursquare] Results count:', data.results?.length ?? 0);
  return data.results || [];
}

async function fetchGooglePlace(name: string, lat: number, lng: number) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  url.searchParams.set('query', `${name} cafe`);
  url.searchParams.set('location', `${lat},${lng}`);
  url.searchParams.set('radius', '500');
  url.searchParams.set('key', GOOGLE_PLACES_API_KEY);

  try {
    const res = await fetch(url.toString());
    console.log('[Google Places] Search for:', name, '- status:', res.status);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      return {
        place_id: data.results[0].place_id,
        rating: data.results[0].rating ?? null,
        address: data.results[0].formatted_address ?? null,
      };
    }
  } catch (e) {
    console.error('[Google Places] Error:', e);
  }
  return null;
}

export async function GET(request: Request) {
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
    return Response.json(existing);
  }

  // Fetch from Foursquare
  console.log('[/api/cafes] Not enough cached results, fetching from Foursquare...');
  const fsqResults = await fetchFoursquareCafes(lat, lng);

  if (fsqResults.length === 0) {
    console.log('[/api/cafes] No Foursquare results, returning existing:', existing?.length ?? 0);
    return Response.json(existing || []);
  }

  const upsertPromises = fsqResults.map(async (place: Record<string, unknown>) => {
    const fsqId = place.fsq_id as string;
    const placeName = place.name as string;
    const geocodes = place.geocodes as { main?: { latitude: number; longitude: number } };
    const location = place.location as { formatted_address?: string };
    const tastes = (place.tastes as string[]) || [];
    const categories = (place.categories as { name: string }[]) || [];
    const fsqRating = (place.rating as number) ?? null;

    const placeLat = geocodes?.main?.latitude ?? lat;
    const placeLng = geocodes?.main?.longitude ?? lng;

    const google = await fetchGooglePlace(placeName, placeLat, placeLng);

    const laptopAllowed = inferLaptopFriendly(tastes, categories);
    const hasWifi = inferHasWifi(tastes);

    return {
      name: placeName,
      lat: placeLat,
      lng: placeLng,
      address: google?.address || location?.formatted_address || null,
      foursquare_id: fsqId,
      google_place_id: google?.place_id || null,
      laptop_allowed: laptopAllowed,
      wifi_rating: hasWifi ? 3 : null,
      seating_rating: null as number | null,
      google_rating: google?.rating ?? null,
      foursquare_rating: fsqRating ? fsqRating / 2 : null,
      confidence: 'unconfirmed' as const,
      last_updated: new Date().toISOString(),
    };
  });

  const cafesToUpsert = await Promise.all(upsertPromises);
  console.log('[/api/cafes] Upserting', cafesToUpsert.length, 'cafes to Supabase');

  if (cafesToUpsert.length > 0) {
    const { error: upsertError } = await supabase
      .from('cafes')
      .upsert(cafesToUpsert, { onConflict: 'foursquare_id' });

    if (upsertError) {
      console.error('[/api/cafes] Upsert error:', upsertError);
      // Even if upsert fails, return the data we fetched so the user sees something
      console.log('[/api/cafes] Returning fetched data directly (upsert failed)');
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
    return Response.json(cafesToUpsert.map((c, i) => ({ ...c, id: `temp-${i}` })));
  }

  console.log('[/api/cafes] Returning', allCafes?.length ?? 0, 'total cafes');
  return Response.json(allCafes || []);
}
