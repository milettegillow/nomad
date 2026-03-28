import { supabase } from '@/lib/supabase';
import Anthropic from '@anthropic-ai/sdk';

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CLAUDE_CALLS = 15;
const MIN_REVIEWS_FOR_CLAUDE = 3;
const ENRICHMENT_BATCH_SIZE = 5;

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

interface BlogCafe {
  name: string;
  address: string | null;
  wifi_notes: string | null;
  laptop_notes: string | null;
  seating_notes: string | null;
  source_url: string | null;
}

function normalizeName(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '').trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return na.includes(nb) || nb.includes(na) ||
    na.split(' ').some(word => word.length > 3 && nb.includes(word));
}

function blogHasExplicitWorkMention(bc: BlogCafe): boolean {
  const notes = [bc.laptop_notes, bc.wifi_notes].filter(Boolean).join(' ').toLowerCase();
  const workKeywords = ['laptop', 'remote work', 'coworking', 'work from', 'study', 'freelanc', 'digital nomad', 'wifi', 'outlets', 'plug'];
  return workKeywords.some(kw => notes.includes(kw));
}

interface NegativeCafe {
  name: string;
  issue: string;
}

interface BlogSearchResult {
  cafes: BlogCafe[];
  negative_cafes: NegativeCafe[];
}

async function searchBlogs(city: string, origin: string): Promise<BlogSearchResult> {
  console.log('[Pipeline] searchBlogs() called for city:', city, 'origin:', origin);
  try {
    const url = `${origin}/api/search-blogs`;
    console.log('[Pipeline] Fetching blog search at:', url);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city }),
    });
    console.log('[Pipeline] Blog search response status:', res.status);
    if (!res.ok) {
      const text = await res.text();
      console.error('[Pipeline] Blog search HTTP error:', res.status, text.substring(0, 200));
      return { cafes: [], negative_cafes: [] };
    }
    const data = await res.json();
    console.log('[Pipeline] Blog search returned:', data.cafes?.length ?? 0, 'positive cafés,', data.negative_cafes?.length ?? 0, 'negative cafés');
    return {
      cafes: data.cafes || [],
      negative_cafes: data.negative_cafes || [],
    };
  } catch (e) {
    console.error('[Pipeline] Blog search EXCEPTION:', e);
    return { cafes: [], negative_cafes: [] };
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
}

async function googleTextSearch(query: string, lat: number, lng: number): Promise<GooglePlace[]> {
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.reviews,places.types',
      },
      body: JSON.stringify({
        textQuery: query,
        locationBias: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 5000 },
        },
        maxResultCount: 5,
      }),
    });
    const data = await res.json();
    return data.places || [];
  } catch {
    return [];
  }
}

async function googleNearbySearch(lat: number, lng: number): Promise<GooglePlace[]> {
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.reviews,places.types',
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

async function enrichWithReviews(
  cafeName: string,
  reviews: string[],
  types: string[],
  blogNotes: BlogCafe | null,
  isBlogResult: boolean,
  negativeIssue: string | null
): Promise<{
  laptop_allowed: boolean | null;
  wifi_rating: number | null;
  seating_rating: number | null;
  work_summary: string | null;
  confidence: 'inferred' | 'unconfirmed';
  reason: string;
}> {
  // Blog results are automatically laptop-friendly — they were found in "best work cafés" lists
  if (isBlogResult && reviews.length < MIN_REVIEWS_FOR_CLAUDE) {
    const summary = blogNotes
      ? [blogNotes.laptop_notes, blogNotes.wifi_notes].filter(Boolean).join('. ') || 'Recommended for remote work in blog articles'
      : 'Recommended for remote work in blog articles';
    return {
      laptop_allowed: true,
      wifi_rating: blogNotes?.wifi_notes ? 3 : null,
      seating_rating: blogNotes?.seating_notes ? 3 : null,
      work_summary: summary,
      confidence: 'inferred',
      reason: 'found in work-friendly café blog list',
    };
  }

  const fallback = { laptop_allowed: null, wifi_rating: null, seating_rating: null, work_summary: null, confidence: 'unconfirmed' as const, reason: 'no data' };

  const hasBlogNotes = blogNotes && (blogNotes.wifi_notes || blogNotes.laptop_notes || blogNotes.seating_notes);

  const blogContext = hasBlogNotes
    ? `\nBlog/article notes about this café:\n- Laptops: ${blogNotes!.laptop_notes || 'not mentioned'}\n- WiFi: ${blogNotes!.wifi_notes || 'not mentioned'}\n- Seating: ${blogNotes!.seating_notes || 'not mentioned'}\nThese blog notes are strong evidence — use them.`
    : '';

  const blogResultContext = isBlogResult
    ? '\nIMPORTANT: This café was found in a blog search for "best cafés to work from". This is strong evidence it is laptop-friendly. Set laptop_allowed=true unless reviews explicitly contradict this.'
    : '';

  const negativeContext = negativeIssue
    ? `\nWARNING: This café has been flagged negatively online: "${negativeIssue}". Weight this heavily — if reviews also suggest it is unfriendly for work, set laptop_allowed=false.`
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
- true if reviews mention ANY of: "work", "study", "laptop", "wifi", "quiet", "coworking", "nomad", "remote", "productive", "good atmosphere to work", "freelancer", "outlet", "plug", or if people seem to spend long periods there.
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

WORK_SUMMARY: One sentence describing work-friendliness. Be specific about what was mentioned.
CONFIDENCE: 'inferred' if laptop_allowed is true or false. 'unconfirmed' if null.
REASON: Brief explanation of your laptop_allowed decision.

Reviews: ${JSON.stringify(reviews)}
Place types: ${JSON.stringify(types)}${blogContext}${blogResultContext}${negativeContext}

Return JSON: { "laptop_allowed": ..., "wifi_rating": ..., "seating_rating": ..., "work_summary": "...", "confidence": "...", "reason": "..." }`,
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
      work_summary: typeof parsed.work_summary === 'string' ? parsed.work_summary : null,
      confidence: parsed.confidence === 'inferred' ? 'inferred' : 'unconfirmed',
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'unknown',
    };
  } catch (e) {
    console.error('[Pipeline] Review enrichment error for', cafeName, ':', e);
    // If it's a blog result and Claude failed, still mark as laptop-friendly
    if (isBlogResult) {
      return { laptop_allowed: true, wifi_rating: null, seating_rating: null, work_summary: 'Recommended for remote work in blog articles', confidence: 'inferred', reason: 'blog result (Claude failed)' };
    }
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
        send({ type: 'status', message: `📍 Checking cache for ${city}...` });

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
              send({ type: 'status', message: `✓ ${cachedCafes.length} cafés loaded from cache` });
              send({ type: 'cafes', cafes: cachedCafes, cached: true });
              send({ type: 'complete' });
              controller.close();
              return;
            }
          }
        }

        // First user in this city!
        send({ type: 'first_search', city });

        // STEP 2 & 3: Blog search + Google Nearby in PARALLEL
        send({ type: 'status', message: `📰 Searching blogs for best work cafés in ${city}...` });
        console.log('[Pipeline] Starting blog search + nearby search in parallel for:', city);

        const [blogSearchResult, nearbyPlaces] = await Promise.all([
          searchBlogs(city, origin),
          googleNearbySearch(lat, lng),
        ]);

        const blogCafes = blogSearchResult.cafes;
        const negativeCafes = blogSearchResult.negative_cafes;

        // Filter blog cafés to only those with explicit work mentions
        const workBlogCafes = blogCafes.filter(blogHasExplicitWorkMention);
        const nonWorkBlogCafes = blogCafes.filter((bc: BlogCafe) => !blogHasExplicitWorkMention(bc));

        console.log(`[Pipeline] Blog search: found ${workBlogCafes.length} cafés with explicit work mentions: ${workBlogCafes.map((c: BlogCafe) => c.name).join(', ')}`);
        console.log(`[Pipeline] Blog cafés found: ${blogCafes.map((c: BlogCafe) => c.name).join(', ') || 'none'}`);
        if (nonWorkBlogCafes.length > 0) {
          console.log(`[Pipeline] Blog search: ${nonWorkBlogCafes.length} cafés without work mentions: ${nonWorkBlogCafes.map((c: BlogCafe) => c.name).join(', ')}`);
        }
        if (negativeCafes.length > 0) {
          console.log(`[Pipeline] Negative cafés found: ${negativeCafes.map((c: NegativeCafe) => `${c.name} (${c.issue})`).join(', ')}`);
        }
        console.log('[Pipeline] Nearby search found:', nearbyPlaces.length, 'places');

        // Google Text Search for blog-mentioned cafés
        send({ type: 'status', message: `⭐ Looking up Google ratings...` });

        const blogPlaces: GooglePlace[] = [];
        const batchSize = 3;
        for (let i = 0; i < blogCafes.length; i += batchSize) {
          const batch = blogCafes.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map(bc => googleTextSearch(`${bc.name} cafe ${city}`, lat, lng))
          );
          for (const r of results) blogPlaces.push(...r);
        }

        // Deduplicate by place_id, blog places first
        const allPlacesMap = new Map<string, GooglePlace>();
        for (const p of [...blogPlaces, ...nearbyPlaces]) {
          if (p.id && !allPlacesMap.has(p.id)) allPlacesMap.set(p.id, p);
        }
        const allPlaces = Array.from(allPlacesMap.values());
        console.log('[Pipeline] Total unique places:', allPlaces.length);

        if (allPlaces.length === 0) {
          send({ type: 'status', message: 'No cafés found in this area' });
          send({ type: 'cafes', cafes: [], cached: false });
          send({ type: 'complete' });
          controller.close();
          return;
        }

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

        // STEP 4: Determine which cafés need enrichment
        send({ type: 'status', message: `🤖 Analysing Google reviews...` });

        // Separate into: skip (fresh), enrich-with-claude (3+ reviews), enrich-blog-only, no-data
        interface CafeWorkItem {
          place: GooglePlace;
          existing: Record<string, unknown> | undefined;
          blogNotes: BlogCafe | null;
          isWorkMentioned: boolean;
          negativeIssue: string | null;
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

          const placeName = place.displayName?.text || '';
          const negMatch = negativeCafes.find((nc: NegativeCafe) => namesMatch(nc.name, placeName));

          if (negMatch) {
            console.log(`[Pipeline] ${placeName}: NEGATIVE FLAG — ${negMatch.issue}`);
          }

          return {
            place,
            existing,
            blogNotes: blogCafes.find(bc => namesMatch(bc.name, placeName)) || null,
            isWorkMentioned: workBlogCafes.some(bc => namesMatch(bc.name, placeName)),
            negativeIssue: negMatch?.issue || null,
            skipEnrichment: !!existingIsFresh,
            reviewTexts,
          };
        });

        const toSkip = workItems.filter(w => w.skipEnrichment);
        const toEnrichWithClaude = workItems
          .filter(w => !w.skipEnrichment && (w.reviewTexts.length >= MIN_REVIEWS_FOR_CLAUDE || w.blogNotes))
          .slice(0, MAX_CLAUDE_CALLS);
        const noClaudeItems = workItems.filter(w => !w.skipEnrichment && w.reviewTexts.length < MIN_REVIEWS_FOR_CLAUDE && !w.blogNotes);

        console.log(`[Pipeline] Enriching ${toEnrichWithClaude.length} cafés, skipping ${toSkip.length} (already enriched), ${noClaudeItems.length} with <${MIN_REVIEWS_FOR_CLAUDE} reviews (left unconfirmed)`);

        // Run Claude enrichment in batches of ENRICHMENT_BATCH_SIZE
        const claudeResults = new Map<string, Awaited<ReturnType<typeof enrichWithReviews>>>();
        for (let i = 0; i < toEnrichWithClaude.length; i += ENRICHMENT_BATCH_SIZE) {
          const batch = toEnrichWithClaude.slice(i, i + ENRICHMENT_BATCH_SIZE);
          const results = await Promise.all(
            batch.map(w => enrichWithReviews(
              w.place.displayName?.text || 'Unknown',
              w.reviewTexts,
              w.place.types || [],
              w.blogNotes,
              w.isWorkMentioned,
              w.negativeIssue,
            ))
          );
          for (let j = 0; j < batch.length; j++) {
            claudeResults.set(batch[j].place.id, results[j]);
          }
        }

        // Build final café records
        const enrichedCafes = workItems.map(w => {
          const placeName = w.place.displayName?.text || 'Unknown';
          let laptop_allowed: boolean | null = null;
          let wifi_rating: number | null = null;
          let seating_rating: number | null = null;
          let confidence: string = 'unconfirmed';
          let workSummary: string | null = null;
          let reason = 'no data';

          if (w.skipEnrichment && w.existing) {
            // Use existing fresh data as-is
            laptop_allowed = w.existing.laptop_allowed as boolean | null;
            wifi_rating = w.existing.wifi_rating as number | null;
            seating_rating = w.existing.seating_rating as number | null;
            confidence = w.existing.confidence as string;
            workSummary = w.existing.work_summary as string | null;
            reason = 'cached';
          } else {
            const claudeResult = claudeResults.get(w.place.id);

            if (claudeResult) {
              laptop_allowed = claudeResult.laptop_allowed;
              wifi_rating = claudeResult.wifi_rating;
              seating_rating = claudeResult.seating_rating;
              confidence = claudeResult.confidence;
              workSummary = claudeResult.work_summary;
              reason = claudeResult.reason;
            }

            // Blog result: set laptop_allowed=true if Claude didn't already determine it
            if (w.isWorkMentioned && laptop_allowed === null) {
              laptop_allowed = true;
              confidence = 'inferred';
              reason = 'found in work-friendly café blog list';
              if (!workSummary) workSummary = 'Recommended for remote work in blog articles';
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
              if (!workSummary && w.existing.work_summary) {
                workSummary = w.existing.work_summary as string;
              }
            }

            // Build work_summary from blog notes if still null
            if (!workSummary && w.blogNotes) {
              const parts: string[] = [];
              if (w.blogNotes.laptop_notes) parts.push(w.blogNotes.laptop_notes);
              if (w.blogNotes.wifi_notes) parts.push(w.blogNotes.wifi_notes);
              if (parts.length > 0) workSummary = parts.join('. ');
            }
          }

          // Use existing reason if cached
          if (w.skipEnrichment && w.existing?.enrichment_reason) {
            reason = w.existing.enrichment_reason as string;
          }

          console.log(`[Pipeline] ${placeName}: laptop=${laptop_allowed} wifi=${wifi_rating} confidence=${confidence}`);
          console.log(`[Pipeline] ${placeName} reason: ${reason}`);
          console.log(`[Pipeline] ${placeName} was in blog results: ${w.isWorkMentioned}`);

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
            blog_sources: w.blogNotes?.source_url ? [w.blogNotes.source_url] : (w.existing?.blog_sources as string[] | null) || null,
            work_summary: workSummary,
            enrichment_reason: reason,
          };
        });

        // STEP 5: Save to Supabase
        send({ type: 'status', message: `💾 Saving ${enrichedCafes.length} cafés...` });

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
