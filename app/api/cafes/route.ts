import { supabase } from '@/lib/supabase';
import Anthropic from '@anthropic-ai/sdk';

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CLAUDE_CALLS = 15;
const MIN_REVIEWS_FOR_CLAUDE = 3;
const ENRICHMENT_BATCH_SIZE = 3;

// --- Helpers ---

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place&access_token=${MAPBOX_TOKEN}`
    );
    const data = await res.json();
    return data.features?.[0]?.text || null;
  } catch {
    return null;
  }
}

interface BlogSnippet {
  title: string;
  snippet: string;
  url: string;
}

async function searchBlogs(city: string, origin: string): Promise<BlogSnippet[]> {
  console.log('[Pipeline] searchBlogs() called for city:', city);
  try {
    const res = await fetch(`${origin}/api/search-blogs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city }),
    });
    if (!res.ok) {
      console.error('[Pipeline] Blog search HTTP error:', res.status);
      return [];
    }
    const data = await res.json();
    console.log('[Pipeline] Blog search returned:', data.snippets?.length ?? 0, 'work-related snippets');
    return data.snippets || [];
  } catch (e) {
    console.error('[Pipeline] Blog search EXCEPTION:', e);
    return [];
  }
}

interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  reviews?: { text?: { text: string } }[];
  types?: string[];
  photos?: { name: string }[];
}

async function googleNearbySearch(lat: number, lng: number): Promise<GooglePlace[]> {
  const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.reviews,places.types,places.photos';
  console.log('[FieldMask]', fieldMask);
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify({
        includedTypes: ['cafe'],
        maxResultCount: 20,
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 2000 },
        },
      }),
    });
    const data = await res.json();
    return data.places || [];
  } catch {
    return [];
  }
}

// --- Lightweight GET for pan-based loading ---

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat') || '');
  const lng = parseFloat(searchParams.get('lng') || '');

  console.log('[Pan Search] Incoming request — lat:', lat, 'lng:', lng);

  if (isNaN(lat) || isNaN(lng)) {
    return Response.json({ error: 'lat and lng required' }, { status: 400 });
  }

  const latDelta = 0.018;
  const lngDelta = 0.018 / Math.cos((lat * Math.PI) / 180);

  // Check Supabase for existing cafés in this area
  const { data: existing } = await supabase
    .from('cafes')
    .select('*')
    .gte('lat', lat - latDelta)
    .lte('lat', lat + latDelta)
    .gte('lng', lng - lngDelta)
    .lte('lng', lng + lngDelta);

  console.log('[Pan Search] Supabase found:', existing?.length ?? 0, 'existing cafés');

  // Always fetch from Google Places to discover new cafés
  const rawPlaces = await googleNearbySearch(lat, lng);
  const cafeTypesGet = ['cafe', 'coffee_shop', 'bakery', 'food', 'restaurant', 'bar'];
  const nonCafeKwGet = ['climbing', 'gym', 'fitness', 'hotel', 'hostel', 'pharmacy', 'bank', 'supermarket', 'market', 'pub', 'wine', 'beer'];
  const places = rawPlaces.filter(p => {
    if (!p.types?.some(t => cafeTypesGet.includes(t))) return false;
    const n = (p.displayName?.text || '').toLowerCase();
    return !nonCafeKwGet.some(kw => n.includes(kw));
  });
  console.log('[Pan Search] Google Places returned:', rawPlaces.length, '→ filtered to', places.length, 'cafés');

  if (places.length === 0) {
    console.log('[Pan Search] Returning', existing?.length ?? 0, 'existing only');
    return Response.json(existing || []);
  }

  const cafesToUpsert = places.map(place => ({
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
    blog_sources: null as string[] | null,
    work_summary: null as string | null,
    enrichment_reason: null as string | null,
    key_review_quote: null as string | null,
    photo_url: null as string | null,
    photo_name: place.photos?.[0]?.name || null,
  }));

  await supabase
    .from('cafes')
    .upsert(cafesToUpsert, { onConflict: 'google_place_id', ignoreDuplicates: true });

  // Re-fetch to get all cafés including existing enriched ones
  const { data: allCafes } = await supabase
    .from('cafes')
    .select('*')
    .gte('lat', lat - latDelta)
    .lte('lat', lat + latDelta)
    .gte('lng', lng - lngDelta)
    .lte('lng', lng + lngDelta);

  console.log('[Pan] Returning', allCafes?.length ?? 0, 'cafés (fetched', places.length, 'from Google)');
  return Response.json(allCafes || []);
}

async function enrichWithReviews(
  cafeName: string,
  reviews: string[],
  types: string[],
  blogContext: string
): Promise<{
  laptop_allowed: boolean | null;
  wifi_rating: number | null;
  seating_rating: number | null;
  confidence: 'inferred' | 'unconfirmed';
  reason: string;
  key_quote: string | null;
}> {
  const fallback = { laptop_allowed: null, wifi_rating: null, seating_rating: null, confidence: 'unconfirmed' as const, reason: 'no data', key_quote: null };

  if (reviews.length < MIN_REVIEWS_FOR_CLAUDE && !blogContext) {
    return fallback;
  }

  const blogSection = blogContext
    ? `\nHere are raw search snippets mentioning this area. Only use these if they explicitly name this specific café "${cafeName}":\n${blogContext}`
    : '';

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: 'You are analyzing café reviews to determine work-friendliness. Make reasonable inferences from context. Return ONLY a valid JSON object.',
      messages: [{
        role: 'user',
        content: `Analyze these reviews for "${cafeName}".

LAPTOP_ALLOWED:
- true if reviews mention ANY of: "work", "study", "laptop", "wifi", "quiet", "coworking", "nomad", "remote", "productive", "freelancer", "outlet", "plug", or if people seem to spend long periods there.
- false ONLY if reviews explicitly say: "no wifi", "no laptops", "asked to leave", "time limit", "too noisy to work", "not suitable for work".
- null only if reviews contain absolutely nothing about the work environment.

WIFI_RATING:
- 4-5 if reviews say "fast wifi", "great wifi", "strong wifi", "reliable internet"
- 2-3 if reviews say "ok wifi", "slow wifi", "decent wifi"
- 1 if reviews say "terrible wifi", "wifi doesn't work"
- null only if wifi is not mentioned at all

SEATING_RATING:
- 4-5 if reviews mention "spacious", "plenty of seats", "lots of tables", "big space", "outlets everywhere"
- 2-3 if reviews mention "average space", "some seating"
- 1-2 if reviews mention "small", "few seats", "cramped", "tiny"
- null only if seating/space is not mentioned

CONFIDENCE: 'inferred' if laptop_allowed is true or false. 'unconfirmed' if null.
REASON: Brief explanation of your laptop_allowed decision.
KEY_QUOTE: Copy the single most relevant sentence verbatim from the reviews provided that best justifies your laptop_allowed decision. This must be an exact copy of text from the reviews, not a summary. Max 150 characters. If no relevant quote exists, set to null.

Reviews: ${JSON.stringify(reviews)}
Place types: ${JSON.stringify(types)}${blogSection}

Return JSON: { "laptop_allowed": ..., "wifi_rating": ..., "seating_rating": ..., "confidence": "...", "reason": "...", "key_quote": ... }`,
      }],
    });

    const content = response.content[0];
    if (content.type !== 'text') return fallback;

    const cleaned = content.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      laptop_allowed: typeof parsed.laptop_allowed === 'boolean' ? parsed.laptop_allowed : null,
      wifi_rating: typeof parsed.wifi_rating === 'number' && parsed.wifi_rating >= 1 && parsed.wifi_rating <= 5 ? parsed.wifi_rating : null,
      seating_rating: typeof parsed.seating_rating === 'number' && parsed.seating_rating >= 1 && parsed.seating_rating <= 5 ? parsed.seating_rating : null,
      confidence: parsed.confidence === 'inferred' ? 'inferred' : 'unconfirmed',
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'unknown',
      key_quote: typeof parsed.key_quote === 'string' && parsed.key_quote.length > 0 ? parsed.key_quote.substring(0, 150) : null,
    };
  } catch (e) {
    console.error('[Pipeline] Review enrichment error for', cafeName, ':', e);
    return fallback;
  }
}

// --- Main handler ---

export async function POST(request: Request) {
  const { lat, lng, city: providedCity } = await request.json() as { lat: number; lng: number; city?: string };

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return Response.json({ error: 'lat and lng required' }, { status: 400 });
  }

  const origin = new URL(request.url).origin;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* stream closed */ }
      };

      try {
        const city = providedCity || await reverseGeocode(lat, lng) || 'Unknown';
        console.log('[Pipeline] Start for city:', city, 'at', lat, lng);

        // STEP 1: Check city cache
        send({ type: 'status', message: `📍 Finding cafés in ${city}...` });

        const { data: cached } = await supabase
          .from('city_searches')
          .select('*')
          .eq('city_name', city)
          .single();

        if (cached && cached.cafe_ids?.length > 0) {
          const age = Date.now() - new Date(cached.last_searched).getTime();
          if (age < SEVEN_DAYS_MS) {
            console.log('[Pipeline] Cache hit for', city, '—', cached.cafe_ids.length, 'cafes');
            const { data: cachedCafes } = await supabase
              .from('cafes')
              .select('*')
              .in('id', cached.cafe_ids);

            if (cachedCafes && cachedCafes.length > 0) {
              send({ type: 'status', message: `✓ Found ${cachedCafes.length} cafés in ${city}` });
              send({ type: 'cafes', cafes: cachedCafes, cached: true });
              send({ type: 'complete' });
              supabase.from('analytics_events').insert({ event_type: 'city_search', city_name: city, metadata: { cafe_count: cachedCafes.length, was_cached: true, is_first_search: false } }).then(() => {}, () => {});
              controller.close();
              return;
            }
          }
        }

        // First user in this city!
        send({ type: 'first_search', city });

        // STEP 2: Blog search + Google Nearby in PARALLEL
        send({ type: 'status', message: `📰 Searching blogs for best work cafés in ${city}...` });
        console.log('[Pipeline] Starting blog search + nearby search in parallel for:', city);

        const isLondon = city.toLowerCase().includes('london');

        // Run blog search + Google Places nearby in parallel
        const nearbySearches: Promise<GooglePlace[]>[] = isLondon
          ? [
              googleNearbySearch(51.5074, -0.1278),   // Central London
              googleNearbySearch(51.5250, -0.0740),   // Shoreditch/Hackney
              googleNearbySearch(51.4613, -0.1156),   // Brixton/Peckham
            ]
          : [googleNearbySearch(lat, lng)];

        if (isLondon) {
          console.log(`[London Special] Running expanded search with 3 neighbourhoods`);
        }

        const [blogSnippets, ...nearbyResults] = await Promise.all([
          searchBlogs(city, origin),
          ...nearbySearches,
        ]);

        const nearbyPlaces = nearbyResults.flat();
        console.log('[Pipeline] Blog snippets:', blogSnippets.length, '| Nearby places:', nearbyPlaces.length);

        // Build a single blog context string from all snippets
        const blogContextText = blogSnippets.length > 0
          ? blogSnippets.map(s => `${s.title}: ${s.snippet}`).join('\n')
          : '';

        // STEP 3: Google Places
        send({ type: 'status', message: `⭐ Looking up Google ratings...` });

        // Deduplicate nearby places by ID
        const allPlacesMap = new Map<string, GooglePlace>();
        for (const p of nearbyPlaces) {
          if (p.id && !allPlacesMap.has(p.id)) allPlacesMap.set(p.id, p);
        }

        // Filter out non-cafés
        const cafeTypes = ['cafe', 'coffee_shop', 'bakery', 'food', 'restaurant', 'bar'];
        const nonCafeKeywords = ['climbing', 'gym', 'fitness', 'hotel', 'hostel', 'pharmacy', 'bank', 'supermarket', 'market', 'pub', 'wine', 'beer'];
        const allPlaces = Array.from(allPlacesMap.values()).filter(p => {
          const hasType = p.types?.some(t => cafeTypes.includes(t));
          if (!hasType) {
            console.log(`[Filter] Removed ${p.displayName?.text} — no café type`);
            return false;
          }
          const nameLower = (p.displayName?.text || '').toLowerCase();
          const badKeyword = nonCafeKeywords.find(kw => nameLower.includes(kw));
          if (badKeyword) {
            console.log(`[Filter] Removed ${p.displayName?.text} — name contains "${badKeyword}"`);
            return false;
          }
          return true;
        });
        console.log('[Pipeline] Total unique cafés after filtering:', allPlaces.length, isLondon ? '(London multi-area)' : '');

        if (allPlaces.length === 0) {
          send({ type: 'status', message: 'No cafés found in this area' });
          send({ type: 'cafes', cafes: [], cached: false });
          send({ type: 'complete' });
          controller.close();
          return;
        }

        // Debug: log raw photo data from first 3 places
        allPlaces.slice(0, 3).forEach(p => {
          console.log('[Photo Debug]', p.displayName?.text, 'photos:', JSON.stringify(p.photos?.slice(0, 1)));
        });

        // Check existing Supabase data
        const placeIds = allPlaces.map(p => p.id).filter(Boolean);
        const { data: existingCafes } = await supabase
          .from('cafes')
          .select('*')
          .in('google_place_id', placeIds);

        const existingByPlaceId = new Map<string, Record<string, unknown>>();
        if (existingCafes) {
          for (const c of existingCafes) {
            if (c.google_place_id) existingByPlaceId.set(c.google_place_id, c);
          }
        }

        // STEP 4: Enrichment
        send({ type: 'status', message: `🤖 Analysing Google reviews...` });

        interface CafeWorkItem {
          place: GooglePlace;
          existing: Record<string, unknown> | undefined;
          skipEnrichment: boolean;
          reviewTexts: string[];
        }

        const workItems: CafeWorkItem[] = allPlaces.map(place => {
          const existing = existingByPlaceId.get(place.id);
          const existingIsFresh = existing
            && existing.confidence !== 'unconfirmed'
            && (Date.now() - new Date(existing.last_updated as string).getTime()) < SEVEN_DAYS_MS;

          const reviewTexts = (place.reviews || [])
            .slice(0, 5)
            .map(r => r.text?.text)
            .filter((t): t is string => !!t);

          return {
            place,
            existing,
            skipEnrichment: !!existingIsFresh,
            reviewTexts,
          };
        });

        const toSkip = workItems.filter(w => w.skipEnrichment);
        const toEnrich = workItems
          .filter(w => !w.skipEnrichment && (w.reviewTexts.length >= MIN_REVIEWS_FOR_CLAUDE || blogContextText))
          .slice(0, MAX_CLAUDE_CALLS);
        const noEnrich = workItems.filter(w =>
          !w.skipEnrichment && w.reviewTexts.length < MIN_REVIEWS_FOR_CLAUDE && !blogContextText
        );

        console.log(`[Pipeline] Enriching ${toEnrich.length} cafés, skipping ${toSkip.length} (cached), ${noEnrich.length} with <${MIN_REVIEWS_FOR_CLAUDE} reviews (unconfirmed)`);

        // Run Claude enrichment in batches of 3 with 2s delay between
        const claudeResults = new Map<string, Awaited<ReturnType<typeof enrichWithReviews>>>();
        for (let i = 0; i < toEnrich.length; i += ENRICHMENT_BATCH_SIZE) {
          const batch = toEnrich.slice(i, i + ENRICHMENT_BATCH_SIZE);
          console.log(`[Pipeline] Enrichment batch ${Math.floor(i / ENRICHMENT_BATCH_SIZE) + 1}: ${batch.map(w => w.place.displayName?.text).join(', ')}`);
          const results = await Promise.all(
            batch.map(w => enrichWithReviews(
              w.place.displayName?.text || 'Unknown',
              w.reviewTexts,
              w.place.types || [],
              blogContextText,
            ))
          );
          for (let j = 0; j < batch.length; j++) {
            claudeResults.set(batch[j].place.id, results[j]);
          }
          // Rate limit: 2s delay between batches
          if (i + ENRICHMENT_BATCH_SIZE < toEnrich.length) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        // Build final café records
        const enrichedCafes = workItems.map(w => {
          const placeName = w.place.displayName?.text || 'Unknown';
          let laptop_allowed: boolean | null = null;
          let wifi_rating: number | null = null;
          let seating_rating: number | null = null;
          let confidence: string = 'unconfirmed';
          let reason = 'no data';
          let keyQuote: string | null = null;

          if (w.skipEnrichment && w.existing) {
            laptop_allowed = w.existing.laptop_allowed as boolean | null;
            wifi_rating = w.existing.wifi_rating as number | null;
            seating_rating = w.existing.seating_rating as number | null;
            confidence = w.existing.confidence as string;
            reason = (w.existing.enrichment_reason as string) || 'cached';
            keyQuote = (w.existing.key_review_quote as string) || null;
          } else {
            const claudeResult = claudeResults.get(w.place.id);

            if (claudeResult) {
              laptop_allowed = claudeResult.laptop_allowed;
              wifi_rating = claudeResult.wifi_rating;
              seating_rating = claudeResult.seating_rating;
              confidence = claudeResult.confidence;
              reason = claudeResult.reason;
              keyQuote = claudeResult.key_quote;
            }

            // Preserve non-null fields from existing stale data
            if (w.existing) {
              if (laptop_allowed === null && w.existing.laptop_allowed !== null) {
                laptop_allowed = w.existing.laptop_allowed as boolean;
              }
              if (wifi_rating === null && w.existing.wifi_rating !== null) {
                wifi_rating = w.existing.wifi_rating as number;
              }
              if (seating_rating === null && w.existing.seating_rating !== null) {
                seating_rating = w.existing.seating_rating as number;
              }
              if (w.existing.confidence === 'verified') {
                confidence = 'verified';
              }
            }
          }

          const photoName = w.place.photos?.[0]?.name || (w.existing?.photo_name as string | null) || null;

          console.log(`[Pipeline] ${placeName}: laptop=${laptop_allowed} wifi=${wifi_rating} confidence=${confidence}`);
          console.log(`[Pipeline] ${placeName} reason: ${reason}`);
          console.log(`[Photo] ${placeName}: ${photoName || 'none'}`);

          return {
            name: placeName,
            lat: w.place.location?.latitude ?? lat,
            lng: w.place.location?.longitude ?? lng,
            address: w.place.formattedAddress || null,
            foursquare_id: null as string | null,
            google_place_id: w.place.id,
            laptop_allowed,
            wifi_rating,
            seating_rating,
            google_rating: w.place.rating ?? null,
            foursquare_rating: null as number | null,
            confidence,
            last_updated: new Date().toISOString(),
            blog_sources: null as string[] | null,
            work_summary: null as string | null,
            enrichment_reason: reason,
            key_review_quote: keyQuote,
            photo_url: null as string | null,
            photo_name: photoName,
          };
        });

        // STEP 5: Save to Supabase
        // Save silently — no status message for saving

        if (enrichedCafes.length > 0) {
          console.log('[Upsert Example]', JSON.stringify(enrichedCafes[0], null, 2));
        }

        const { error: upsertError } = await supabase
          .from('cafes')
          .upsert(enrichedCafes, { onConflict: 'google_place_id' });

        if (upsertError) {
          console.error('[Pipeline] Upsert error:', upsertError);
          const tempCafes = enrichedCafes.map((c, i) => ({ ...c, id: `temp-${i}` }));
          send({ type: 'cafes', cafes: tempCafes, cached: false });
          send({ type: 'complete' });
          controller.close();
          return;
        }

        // Re-fetch to get real IDs
        const latDelta = 0.025;
        const lngDelta = 0.025 / Math.cos((lat * Math.PI) / 180);
        const { data: savedCafes } = await supabase
          .from('cafes')
          .select('*')
          .gte('lat', lat - latDelta)
          .lte('lat', lat + latDelta)
          .gte('lng', lng - lngDelta)
          .lte('lng', lng + lngDelta);

        const finalCafes = savedCafes || [];

        // Save city search cache
        const cafeIds = finalCafes.map(c => c.id);
        await supabase
          .from('city_searches')
          .upsert(
            { city_name: city, last_searched: new Date().toISOString(), cafe_ids: cafeIds },
            { onConflict: 'city_name' }
          );

        console.log('[Pipeline] Complete —', finalCafes.length, 'cafés saved for', city);

        // STEP 6: Return
        send({ type: 'status', message: `✓ Found ${finalCafes.length} cafés` });
        send({ type: 'cafes', cafes: finalCafes, cached: false });
        send({ type: 'complete' });
        supabase.from('analytics_events').insert({ event_type: 'city_search', city_name: city, metadata: { cafe_count: finalCafes.length, was_cached: false, is_first_search: true } }).then(() => {}, () => {});

      } catch (e) {
        console.error('[Pipeline] Error:', e);
        send({ type: 'error', message: e instanceof Error ? e.message : 'Pipeline failed' });
        send({ type: 'complete' });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
