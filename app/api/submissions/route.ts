import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('[Submissions] Incoming:', JSON.stringify(body));

    const { cafe_id, laptop_allowed, wifi_rating, seating_rating, notes } = body;

    if (!cafe_id) {
      return Response.json({ error: 'cafe_id required' }, { status: 400 });
    }

    // Resolve temp/search IDs to real Supabase UUIDs
    let resolvedCafeId = cafe_id;
    if (cafe_id.startsWith('search-') || cafe_id.startsWith('temp-')) {
      const googlePlaceId = cafe_id.replace(/^(search-|temp-)/, '');
      console.log('[Submissions] Resolving temp ID via google_place_id:', googlePlaceId);

      const { data: cafe } = await supabase
        .from('cafes')
        .select('id')
        .eq('google_place_id', googlePlaceId)
        .single();

      if (cafe) {
        resolvedCafeId = cafe.id;
        console.log('[Submissions] Resolved to:', resolvedCafeId);
      } else {
        console.error('[Submissions] Café not found in DB for google_place_id:', googlePlaceId);
        return Response.json({ error: 'Café not found. Try searching for it again.' }, { status: 404 });
      }
    }

    // Verify café exists before inserting submission
    const { data: cafeExists } = await supabase
      .from('cafes')
      .select('id')
      .eq('id', resolvedCafeId)
      .single();

    if (!cafeExists) {
      console.error('[Submissions] café_id not found in cafes table:', resolvedCafeId);
      return Response.json({ error: 'Café not found in database.' }, { status: 404 });
    }

    console.log('[Submissions] Inserting for café:', resolvedCafeId);

    const { error: insertError } = await supabase
      .from('submissions')
      .insert({
        cafe_id: resolvedCafeId,
        laptop_allowed: laptop_allowed ?? null,
        wifi_rating: wifi_rating ?? null,
        seating_rating: seating_rating ?? null,
        notes: notes || null,
      });

    if (insertError) {
      console.error('[Submissions] Insert FAILED:', JSON.stringify(insertError, null, 2));
      if (insertError.code === '23503') {
        return Response.json({ error: 'Foreign key error — café not in database.', code: insertError.code }, { status: 400 });
      }
      return Response.json({ error: insertError.message, code: insertError.code, details: insertError }, { status: 500 });
    }

    console.log('[Submissions] Insert OK');
    supabase.from('analytics_events').insert({ event_type: 'correction_submitted', city_name: null, metadata: { laptop_allowed, has_wifi_rating: wifi_rating !== null, has_seating_rating: seating_rating !== null, has_notes: !!notes } }).then(() => {}, () => {});

    // Immediately update café with submitted values (first submission takes effect)
    const cafeUpdate: Record<string, unknown> = {};
    if (laptop_allowed !== null && laptop_allowed !== undefined) cafeUpdate.laptop_allowed = laptop_allowed;
    if (wifi_rating !== null && wifi_rating !== undefined) cafeUpdate.wifi_rating = wifi_rating;
    if (seating_rating !== null && seating_rating !== undefined) cafeUpdate.seating_rating = seating_rating;

    if (Object.keys(cafeUpdate).length > 0) {
      cafeUpdate.enrichment_reason = notes ? `Reported by a user: ${notes}` : 'Reported by a user';
      cafeUpdate.confidence = 'inferred';
      cafeUpdate.user_verified = true;
      cafeUpdate.user_verified_at = new Date().toISOString();

      await supabase
        .from('cafes')
        .update(cafeUpdate)
        .eq('id', resolvedCafeId);
      console.log('[Submissions] Updated café with:', Object.keys(cafeUpdate).join(', '));
    }

    // Upgrade to verified if 3+ submissions agree
    const { data: allSubs } = await supabase
      .from('submissions')
      .select('laptop_allowed')
      .eq('cafe_id', resolvedCafeId)
      .not('laptop_allowed', 'is', null);

    if (allSubs && allSubs.length >= 3) {
      const yesCount = allSubs.filter(s => s.laptop_allowed === true).length;
      const noCount = allSubs.filter(s => s.laptop_allowed === false).length;

      if (yesCount >= 3) {
        await supabase.from('cafes').update({ laptop_allowed: true, confidence: 'verified', enrichment_reason: 'Verified by community', user_verified: true, user_verified_at: new Date().toISOString() }).eq('id', resolvedCafeId);
        console.log('[Submissions] Café VERIFIED as laptop-friendly');
      } else if (noCount >= 3) {
        await supabase.from('cafes').update({ laptop_allowed: false, confidence: 'verified', enrichment_reason: 'Verified by community', user_verified: true, user_verified_at: new Date().toISOString() }).eq('id', resolvedCafeId);
        console.log('[Submissions] Café VERIFIED as NOT laptop-friendly');
      }
    }

    return Response.json({ success: true });

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[Submissions] UNHANDLED ERROR:', message);
    return Response.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
