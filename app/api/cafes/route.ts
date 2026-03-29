import { supabase } from '@/lib/supabase';
import Anthropic from '@anthropic-ai/sdk';

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ENRICHMENT_BATCH_SIZE = 5;

const TIER1_CITIES = ['london', 'londres'];
const TIER2_CITIES = ['paris', 'berlin', 'barcelona', 'lisbon', 'lisboa', 'amsterdam', 'new york', 'bangkok', 'bali', 'tokyo', 'singapore', 'melbourne', 'medellin', 'medellín', 'rome', 'roma', 'prague', 'praha', 'budapest', 'chiang mai', 'mueang chiang mai', 'เชียงใหม่', 'florence', 'firenze', 'venice', 'venezia', 'naples', 'napoli', 'cologne', 'köln', 'munich', 'münchen', 'vienna', 'wien', 'mexico city', 'cdmx'];

function getTier(city: string): number {
  const c = city.toLowerCase();
  if (TIER1_CITIES.some(t => c.includes(t))) return 1;
  if (TIER2_CITIES.some(t => c.includes(t))) return 2;
  return 3;
}

const TIER2_COORDS: Record<string, [string, number, number][]> = {
  paris: [['Marais', 48.8566, 2.3522], ['Montmartre', 48.8867, 2.3431], ['Saint-Germain', 48.8534, 2.3326], ['Bastille', 48.8533, 2.3692], ['Belleville', 48.8713, 2.3840]],
  berlin: [['Mitte', 52.5200, 13.4050], ['Prenzlauer Berg', 52.5394, 13.4144], ['Kreuzberg', 52.4987, 13.4027], ['Friedrichshain', 52.5163, 13.4543], ['Neukölln', 52.4811, 13.4350]],
  barcelona: [['Gothic', 41.3830, 2.1770], ['Eixample', 41.3947, 2.1534], ['Gracia', 41.4036, 2.1530], ['Poble Nou', 41.3995, 2.1975], ['Barceloneta', 41.3802, 2.1894]],
  amsterdam: [['Jordaan', 52.3752, 4.8826], ['De Pijp', 52.3532, 4.8979], ['Oud-West', 52.3667, 4.8671], ['Oost', 52.3600, 4.9299], ['Centrum', 52.3738, 4.8910]],
  lisbon: [['Alfama', 38.7139, -9.1334], ['Bairro Alto', 38.7107, -9.1440], ['LX Factory', 38.7006, -9.1774], ['Príncipe Real', 38.7151, -9.1490], ['Intendente', 38.7216, -9.1362]],
  'new york': [['Manhattan', 40.7580, -73.9855], ['Brooklyn', 40.6782, -73.9442], ['Williamsburg', 40.7081, -73.9571], ['East Village', 40.7265, -73.9815], ['Soho', 40.7234, -74.0030]],
  bangkok: [['Silom', 13.7244, 100.5286], ['Sukhumvit', 13.7372, 100.5608], ['Ari', 13.7756, 100.5431], ['Thonglor', 13.7305, 100.5843], ['Ekkamai', 13.7213, 100.5844]],
  'chiang mai': [['Old City', 18.7883, 98.9853], ['Nimman', 18.7955, 98.9680], ['Santitham', 18.8005, 98.9780], ['Chang Phueak', 18.8050, 98.9830], ['Night Bazaar', 18.7850, 98.9950]],
};

const LONDON_COORDS: [string, number, number][] = [
  ['Shoreditch', 51.5225, -0.0756], ['Brixton', 51.4613, -0.1156],
  ['Hackney', 51.5450, -0.0553], ['Soho', 51.5137, -0.1340],
  ['Peckham', 51.4740, -0.0697], ['Dalston', 51.5467, -0.0756],
  ['Islington', 51.5362, -0.1033], ['Clerkenwell', 51.5237, -0.1072],
  ['Bethnal Green', 51.5283, -0.0550], ['Notting Hill', 51.5090, -0.2010],
  ['Fitzrovia', 51.5200, -0.1400], ['Bermondsey', 51.4983, -0.0810],
  ['Camden', 51.5390, -0.1426], ['Clapham', 51.4610, -0.1380],
  ['Wimbledon', 51.4214, -0.2064], ['Richmond', 51.4613, -0.3037],
  ['Wandsworth', 51.4567, -0.1920], ['Battersea', 51.4781, -0.1483],
  ['Fulham', 51.4812, -0.1954], ['Chelsea', 51.4875, -0.1687],
  ['Kensington', 51.5006, -0.1927], ['Mayfair', 51.5099, -0.1478],
  ['Marylebone', 51.5196, -0.1533], ['Paddington', 51.5154, -0.1755],
  ['Hammersmith', 51.4927, -0.2236], ['Ealing', 51.5130, -0.3089],
  ['Walthamstow', 51.5820, -0.0174], ['Stratford', 51.5417, -0.0027],
  ['Canary Wharf', 51.5054, -0.0235], ['Greenwich', 51.4826, 0.0077],
  ['Lewisham', 51.4615, -0.0136], ['Tooting', 51.4279, -0.1680],
];

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

const CITY_NAME_MAP: Record<string, string> = {
  lisboa: 'Lisbon', roma: 'Rome', praha: 'Prague', münchen: 'Munich',
  wien: 'Vienna', köln: 'Cologne', moskva: 'Moscow', londres: 'London',
  'mueang chiang mai': 'Chiang Mai', 'chiang mai': 'Chiang Mai', 'เชียงใหม่': 'Chiang Mai',
  firenze: 'Florence', venezia: 'Venice', napoli: 'Naples',
  'cidade do méxico': 'Mexico City', cdmx: 'Mexico City',
  'krung thep': 'Bangkok', 'krung thep maha nakhon': 'Bangkok',
  'new york city': 'New York', nyc: 'New York',
  'los angeles': 'Los Angeles', la: 'Los Angeles',
};

const DISTRICT_PREFIXES = ['Mueang', 'Amphoe', 'District', 'Borough', 'County', 'Municipality'];

function extractCityName(rawCity: string): string {
  const parts = rawCity.split(',').map(p => p.trim());
  if (parts.length > 1 && DISTRICT_PREFIXES.some(p => parts[0].startsWith(p))) {
    return parts[1];
  }
  return parts[0];
}

function normalizeCity(rawCity: string): string {
  const extracted = extractCityName(rawCity);
  const mapped = CITY_NAME_MAP[extracted.toLowerCase()] || extracted;
  console.log(`[City Normalise] Raw: ${rawCity} → Extracted: ${extracted} → English: ${mapped}`);
  return mapped;
}

interface BlogSnippet {
  title: string;
  snippet: string;
  url: string;
}

interface BlogCafeExtracted {
  name: string;
  area: string | null;
  laptop_notes: string | null;
  wifi_notes: string | null;
  source_url: string | null;
}

interface NegativeCafeExtracted {
  name: string;
  issue: string;
  source_url: string | null;
}

interface BlogSearchResult {
  snippets: BlogSnippet[];
  cafes: BlogCafeExtracted[];
  negative_cafes: NegativeCafeExtracted[];
}

async function searchBlogs(city: string, origin: string): Promise<BlogSearchResult> {
  console.log('[Pipeline] searchBlogs() called for city:', city);
  try {
    const res = await fetch(`${origin}/api/search-blogs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city }),
    });
    if (!res.ok) {
      console.error('[Pipeline] Blog search HTTP error:', res.status);
      return { snippets: [], cafes: [], negative_cafes: [] };
    }
    const data = await res.json();
    console.log('[Pipeline] Blog search returned:', data.snippets?.length ?? 0, 'snippets,', data.cafes?.length ?? 0, 'extracted cafés,', data.negative_cafes?.length ?? 0, 'negative');
    return {
      snippets: data.snippets || [],
      cafes: data.cafes || [],
      negative_cafes: data.negative_cafes || [],
    };
  } catch (e) {
    console.error('[Pipeline] Blog search EXCEPTION:', e);
    return { snippets: [], cafes: [], negative_cafes: [] };
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
  const cafeTypesGet = ['cafe', 'coffee_shop'];
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

const REVIEW_WORK_KEYWORDS = ['wifi', 'wi-fi', 'laptop', 'work', 'working', 'remote', 'cowork', 'plug', 'socket', 'outlet', 'study', 'studying'];

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
  const fallback = { laptop_allowed: null, wifi_rating: null, seating_rating: null, confidence: 'unconfirmed' as const, reason: 'no work keywords in reviews', key_quote: null };

  // Pre-filter: only send reviews with work keywords to Claude
  const relevantReviews = reviews.filter(r => {
    const lower = r.toLowerCase();
    return REVIEW_WORK_KEYWORDS.some(kw => lower.includes(kw));
  });

  if (relevantReviews.length === 0 && !blogContext) {
    console.log(`[Pre-filter] ${cafeName} — no work keywords found, skipping enrichment`);
    return fallback;
  }

  console.log(`[Pre-filter] ${cafeName} — found work keywords in ${relevantReviews.length} of ${reviews.length} reviews, sending to Claude`);

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

Reviews: ${JSON.stringify(relevantReviews)}
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
        const rawCity = providedCity || await reverseGeocode(lat, lng) || 'Unknown';
        const city = normalizeCity(rawCity);
        console.log('\n' + '='.repeat(60));
        console.log('[Pipeline START]', new Date().toISOString(), 'City:', city);
        console.log('='.repeat(60) + '\n');

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

        const searchTier = getTier(city);
        const cityLower = city.toLowerCase();

        // Determine neighbourhood coords based on tier
        let areaCoords: [string, number, number][];
        if (searchTier === 1) {
          areaCoords = LONDON_COORDS;
        } else if (searchTier === 2) {
          const match = Object.keys(TIER2_COORDS).find(k => cityLower.includes(k));
          areaCoords = match ? TIER2_COORDS[match] : [['Centre', lat, lng]];
        } else {
          areaCoords = [['Centre', lat, lng]];
        }

        console.log(`[Pipeline] Tier ${searchTier}: ${areaCoords.length} area searches`);

        // Start blog search immediately
        const blogPromise = searchBlogs(city, origin);

        // Google Places nearby: batch 5 concurrent, 1s delay
        const nearbyPlaces: GooglePlace[] = [];
        for (let i = 0; i < areaCoords.length; i += 5) {
          const batch = areaCoords.slice(i, i + 5);
          send({ type: 'status', message: `⭐ Searching ${batch.map(b => b[0]).join(', ')}...` });
          const results = await Promise.all(batch.map(([, lt, ln]) => googleNearbySearch(lt, ln)));
          nearbyPlaces.push(...results.flat());
          if (i + 5 < areaCoords.length) {
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        const blogResult = await blogPromise;
        const blogSnippets = blogResult.snippets;
        const blogExtractedCafes = blogResult.cafes;
        const negativeCafes = blogResult.negative_cafes;
        console.log('[Pipeline] Blog snippets:', blogSnippets.length, '| Extracted cafés:', blogExtractedCafes.length, '| Negative:', negativeCafes.length, '| Nearby places:', nearbyPlaces.length);

        // Build a single blog context string from all snippets
        const blogContextText = blogSnippets.length > 0
          ? blogSnippets.map((s: BlogSnippet) => `${s.title}: ${s.snippet}`).join('\n')
          : '';

        // STEP 3: Google Places
        send({ type: 'status', message: `⭐ Looking up Google ratings...` });

        // Deduplicate nearby places by ID
        const allPlacesMap = new Map<string, GooglePlace>();
        for (const p of nearbyPlaces) {
          if (p.id && !allPlacesMap.has(p.id)) allPlacesMap.set(p.id, p);
        }

        // Filter: only keep places with cafe/coffee_shop type
        const strictCafeTypes = ['cafe', 'coffee_shop'];
        const nonCafeKeywords = ['climbing', 'gym', 'fitness', 'hotel', 'hostel', 'pharmacy', 'bank', 'supermarket', 'market', 'pub', 'wine', 'beer'];
        const allPlaces = Array.from(allPlacesMap.values()).filter(p => {
          const hasType = p.types?.some(t => strictCafeTypes.includes(t));
          if (!hasType) {
            console.log(`[Type Filter] Removed ${p.displayName?.text} — not a café type: ${p.types?.join(', ')}`);
            return false;
          }
          const nameLower = (p.displayName?.text || '').toLowerCase();
          const badKeyword = nonCafeKeywords.find(kw => nameLower.includes(kw));
          if (badKeyword) {
            console.log(`[Type Filter] Removed ${p.displayName?.text} — name contains "${badKeyword}"`);
            return false;
          }
          console.log(`[Type Filter] Kept ${p.displayName?.text}`);
          return true;
        });
        console.log('[Pipeline] Total unique cafés after filtering:', allPlaces.length, searchTier <= 2 ? `(Tier ${searchTier} multi-area)` : '');

        // Build blog match set
        const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim();

        // Use extracted café names if available (London), otherwise fuzzy-match against raw snippets
        const negativeNames = negativeCafes.map(c => normalize(c.name));
        const blogText = blogSnippets.map((s: BlogSnippet) => normalize(s.title + ' ' + s.snippet)).join(' ');
        const blogMatchedIds = new Set<string>();
        const blogMatchData = new Map<string, BlogCafeExtracted>(); // placeId → matched blog café data
        const negativeMatchedIds = new Set<string>();

        for (const p of allPlaces) {
          const name = p.displayName?.text || '';
          const normName = normalize(name);
          const words = normName.split(/\s+/).filter(w => w.length > 3);

          // Check extracted café names first (most reliable) — also find which one matched
          const matchedExtracted = blogExtractedCafes.find(c => {
            const en = normalize(c.name);
            return en.includes(normName) || normName.includes(en) || (words.length >= 2 && words.filter(w => en.includes(w)).length >= 2);
          });
          // Fallback: check raw blog text
          const snippetMatch = blogText.includes(normName) || (words.length >= 2 && words.filter(w => blogText.includes(w)).length >= 2);
          // Check negative
          const negMatch = negativeNames.some(nn => nn.includes(normName) || normName.includes(nn) || (words.length >= 2 && words.filter(w => nn.includes(w)).length >= 2));

          if (negMatch) {
            negativeMatchedIds.add(p.id);
            console.log(`[Negative Match] '${name}' flagged as laptop-unfriendly`);
          } else if (matchedExtracted || snippetMatch) {
            blogMatchedIds.add(p.id);
            if (matchedExtracted) blogMatchData.set(p.id, matchedExtracted);
            console.log(`[Blog Match] '${name}' matched → laptop=true (${matchedExtracted ? 'extracted' : 'snippet'})`);
          } else {
            console.log(`[Blog No Match] '${name}' had no blog match`);
          }
        }

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

        const tier = getTier(city);
        const maxEnrich = tier === 1 ? 200 : tier === 2 ? 50 : 15;
        console.log(`[Pipeline] City: ${city}, Tier: ${tier}, Max enrichment: ${maxEnrich}`);

        const toSkip = workItems.filter(w => w.skipEnrichment);
        // Send all non-skipped cafés to enrichment — the pre-filter inside enrichWithReviews
        // will skip Claude if no reviews contain work keywords
        const toEnrich = workItems
          .filter(w => !w.skipEnrichment && (w.reviewTexts.length > 0 || blogContextText))
          .slice(0, maxEnrich);
        const noEnrich = workItems.filter(w =>
          !w.skipEnrichment && w.reviewTexts.length === 0 && !blogContextText
        );

        console.log(`[Pipeline] Enriching ${toEnrich.length} cafés (pre-filter will skip non-work reviews), skipping ${toSkip.length} (cached), ${noEnrich.length} with no reviews`);

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
          // Rate limit: 8s delay between batches to avoid 429s
          if (i + ENRICHMENT_BATCH_SIZE < toEnrich.length) {
            await new Promise(resolve => setTimeout(resolve, 8000));
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
            // Negative match = red dot
            if (negativeMatchedIds.has(w.place.id)) {
              laptop_allowed = false;
              confidence = 'inferred';
              reason = 'Flagged as laptop-unfriendly online';
            }
            // Blog match = green dot (overrides unless negative)
            else if (blogMatchedIds.has(w.place.id)) {
              laptop_allowed = true;
              confidence = 'inferred';
              reason = `Listed in blog posts about working cafés in ${city}`;
              const blogData = blogMatchData.get(w.place.id);
              if (blogData) {
                if (blogData.laptop_notes || blogData.wifi_notes) {
                  keyQuote = blogData.laptop_notes || blogData.wifi_notes;
                }
              }
            }

            const claudeResult = claudeResults.get(w.place.id);

            if (claudeResult) {
              // Blog match already set laptop=true; only let Claude override if it says false
              if (!blogMatchedIds.has(w.place.id)) {
                laptop_allowed = claudeResult.laptop_allowed;
              } else if (claudeResult.laptop_allowed === false) {
                laptop_allowed = false;
                reason = claudeResult.reason;
              }
              wifi_rating = claudeResult.wifi_rating;
              seating_rating = claudeResult.seating_rating;
              if (!blogMatchedIds.has(w.place.id)) {
                confidence = claudeResult.confidence;
                reason = claudeResult.reason;
              }
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
            blog_sources: blogMatchData.get(w.place.id)?.source_url ? [blogMatchData.get(w.place.id)!.source_url!] : null as string[] | null,
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

        // Check existing cafés to protect user-verified AND previously enriched data
        const enrichedPlaceIds = enrichedCafes.map(c => c.google_place_id).filter(Boolean);
        const { data: existingRows } = await supabase
          .from('cafes')
          .select('google_place_id, user_verified, laptop_allowed, wifi_rating, seating_rating, confidence, enrichment_reason')
          .in('google_place_id', enrichedPlaceIds);

        const existingMap = new Map<string, Record<string, unknown>>();
        if (existingRows) {
          for (const row of existingRows) {
            if (row.google_place_id) existingMap.set(row.google_place_id, row);
          }
        }

        // Build safe upsert: protect user-verified data AND don't overwrite enriched data with nulls
        const safeCafes = enrichedCafes.map(c => {
          const existing = existingMap.get(c.google_place_id);
          if (!existing) return c;

          // User-verified: protect all work fields
          if (existing.user_verified) {
            return {
              ...c,
              laptop_allowed: existing.laptop_allowed as boolean | null,
              wifi_rating: existing.wifi_rating as number | null,
              seating_rating: existing.seating_rating as number | null,
              confidence: existing.confidence as string,
              enrichment_reason: existing.enrichment_reason as string | null,
            };
          }

          // Not user-verified but has existing enriched data: don't overwrite with nulls
          if (existing.laptop_allowed !== null && c.laptop_allowed === null) {
            return {
              ...c,
              laptop_allowed: existing.laptop_allowed as boolean | null,
              wifi_rating: (c.wifi_rating ?? existing.wifi_rating) as number | null,
              seating_rating: (c.seating_rating ?? existing.seating_rating) as number | null,
              confidence: (c.confidence === 'unconfirmed' && existing.confidence !== 'unconfirmed') ? existing.confidence as string : c.confidence,
              enrichment_reason: c.enrichment_reason || existing.enrichment_reason as string | null,
            };
          }

          return c;
        });

        const protectedCount = safeCafes.filter((c, i) => c !== enrichedCafes[i]).length;
        if (protectedCount > 0) {
          console.log(`[Pipeline] Protected ${protectedCount} cafés from data downgrade`);
        }

        console.log('[Upsert] Attempting to save', safeCafes.length, 'cafés');
        const { error: upsertError } = await supabase
          .from('cafes')
          .upsert(safeCafes, { onConflict: 'google_place_id' });

        if (upsertError) {
          console.error('[Upsert ERROR]', upsertError.message, upsertError.details);
          const tempCafes = enrichedCafes.map((c, i) => ({ ...c, id: `temp-${i}` }));
          send({ type: 'cafes', cafes: tempCafes, cached: false });
          send({ type: 'complete' });
          controller.close();
          return;
        }

        console.log('[Upsert] Done — saved', safeCafes.length, 'cafés');

        // Re-fetch all upserted cafés by google_place_id to get real IDs
        const upsertedPlaceIds = safeCafes.map(c => c.google_place_id).filter(Boolean);
        const { data: savedCafes } = await supabase
          .from('cafes')
          .select('*')
          .in('google_place_id', upsertedPlaceIds);

        const finalCafes = savedCafes || [];

        // Save city search cache with ALL café IDs
        const cafeIds = finalCafes.map(c => c.id);
        console.log('[city_searches] Saving', cafeIds.length, 'café IDs for', city);
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
