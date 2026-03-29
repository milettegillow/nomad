import { supabase } from '@/lib/supabase';

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const lat = parseFloat(searchParams.get('lat') || '');
  const lng = parseFloat(searchParams.get('lng') || '');

  if (!q) {
    return Response.json({ results: [] });
  }

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.photos',
      },
      body: JSON.stringify({
        textQuery: q + ' cafe',
        maxResultCount: 3,
        ...(lat && lng ? {
          locationBias: {
            circle: { center: { latitude: lat, longitude: lng }, radius: 50000 },
          },
        } : {}),
      }),
    });

    if (!res.ok) {
      return Response.json({ results: [] });
    }

    const data = await res.json();
    const cafeTypes = ['cafe', 'restaurant', 'food', 'establishment'];
    const places = (data.places || [])
      .filter((p: { types?: string[] }) =>
        p.types?.some((t: string) => cafeTypes.includes(t))
      );

    // Upsert each café to Supabase so it has a real ID for submissions
    const results = [];
    for (const p of places) {
      const cafeData = {
        name: p.displayName?.text || 'Unknown',
        lat: p.location?.latitude || 0,
        lng: p.location?.longitude || 0,
        address: p.formattedAddress || null,
        google_place_id: p.id,
        google_rating: p.rating ?? null,
        photo_name: p.photos?.[0]?.name || null,
        foursquare_id: null,
        laptop_allowed: null,
        wifi_rating: null,
        seating_rating: null,
        foursquare_rating: null,
        confidence: 'unconfirmed',
        last_updated: new Date().toISOString(),
      };

      // Try to find existing first
      const { data: existing } = await supabase
        .from('cafes')
        .select('id')
        .eq('google_place_id', p.id)
        .single();

      let cafeId: string | null = existing?.id || null;

      if (cafeId) {
        // Update non-enrichment fields only
        await supabase
          .from('cafes')
          .update({ google_rating: cafeData.google_rating, photo_name: cafeData.photo_name, address: cafeData.address })
          .eq('id', cafeId);
        console.log('[Search Place] Updated existing café:', cafeData.name, 'id:', cafeId);
      } else {
        // Insert new
        const { data: inserted, error: insertErr } = await supabase
          .from('cafes')
          .insert(cafeData)
          .select('id')
          .single();

        if (insertErr) {
          console.error('[Search Place] Insert error for', cafeData.name, ':', insertErr);
        } else {
          cafeId = inserted?.id || null;
          console.log('[Search Place] Saved new café:', cafeData.name, 'id:', cafeId);
        }
      }

      results.push({
        id: cafeId,
        place_id: p.id,
        name: p.displayName?.text || 'Unknown',
        address: p.formattedAddress || null,
        lat: p.location?.latitude || 0,
        lng: p.location?.longitude || 0,
        rating: p.rating ?? null,
        photo_name: p.photos?.[0]?.name || null,
      });
    }

    console.log('[Search Place] Returned', results.length, 'cafés, all saved to Supabase');
    supabase.from('analytics_events').insert({ event_type: 'cafe_search', city_name: null, metadata: { query: q } }).then(() => {}, () => {});
    return Response.json({ results });
  } catch (e) {
    console.error('[Search Place] Error:', e);
    return Response.json({ results: [] });
  }
}
