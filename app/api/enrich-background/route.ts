import { supabase } from '@/lib/supabase';
import Anthropic from '@anthropic-ai/sdk';

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const { cafeIds } = await request.json() as { cafeIds: string[] };

  if (!cafeIds || cafeIds.length === 0) {
    return Response.json({ error: 'cafeIds required' }, { status: 400 });
  }

  console.log('[Background Enrich] Starting for', cafeIds.length, 'cafés');

  const { data: cafes } = await supabase
    .from('cafes')
    .select('*')
    .in('id', cafeIds);

  if (!cafes) {
    return Response.json({ error: 'No cafés found' }, { status: 404 });
  }

  // Filter to only unconfirmed or stale
  const toEnrich = cafes.filter(c => {
    if (c.confidence === 'verified') return false;
    if (c.confidence === 'unconfirmed') return true;
    return (Date.now() - new Date(c.last_updated).getTime()) > SEVEN_DAYS_MS;
  }).slice(0, 5);

  console.log('[Background Enrich] Enriching', toEnrich.length, 'of', cafes.length);

  for (const cafe of toEnrich) {
    try {
      // Fetch reviews from Google Places
      let reviews: string[] = [];
      let types: string[] = [];
      if (cafe.google_place_id) {
        try {
          const res = await fetch(`https://places.googleapis.com/v1/places/${cafe.google_place_id}`, {
            headers: {
              'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
              'X-Goog-FieldMask': 'reviews,types',
            },
          });
          if (res.ok) {
            const data = await res.json();
            reviews = (data.reviews || [])
              .slice(0, 5)
              .map((r: { text?: { text: string } }) => r.text?.text)
              .filter((t: string | undefined): t is string => !!t);
            types = data.types || [];
          }
        } catch { /* skip */ }
      }

      if (reviews.length < 3) {
        console.log('[Background Enrich] Skipping', cafe.name, '— only', reviews.length, 'reviews');
        continue;
      }

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: 'You are analyzing café reviews to determine work-friendliness. Make reasonable inferences from context. Return ONLY a valid JSON object.',
        messages: [{
          role: 'user',
          content: `Analyze these reviews for "${cafe.name}".

LAPTOP_ALLOWED:
- true if reviews mention ANY of: "work", "study", "laptop", "wifi", "quiet", "coworking", "nomad", "remote", "productive", "freelancer", "outlet", "plug"
- false ONLY if reviews explicitly say: "no wifi", "no laptops", "asked to leave", "time limit", "too noisy to work"
- null only if reviews contain nothing about the work environment

WIFI_RATING: 1-5 if mentioned, null if not
SEATING_RATING: 1-5 if mentioned, null if not
CONFIDENCE: 'inferred' if laptop_allowed is true or false, 'unconfirmed' if null
REASON: Brief explanation
KEY_QUOTE: Most relevant verbatim sentence from reviews (max 150 chars), null if none

Reviews: ${JSON.stringify(reviews)}
Place types: ${JSON.stringify(types)}

Return JSON: { "laptop_allowed": ..., "wifi_rating": ..., "seating_rating": ..., "confidence": "...", "reason": "...", "key_quote": ... }`,
        }],
      });

      const content = response.content[0];
      if (content.type !== 'text') continue;

      const cleaned = content.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);

      const update: Record<string, unknown> = {
        last_updated: new Date().toISOString(),
      };

      if (typeof parsed.laptop_allowed === 'boolean') update.laptop_allowed = parsed.laptop_allowed;
      if (typeof parsed.wifi_rating === 'number' && parsed.wifi_rating >= 1 && parsed.wifi_rating <= 5) update.wifi_rating = parsed.wifi_rating;
      if (typeof parsed.seating_rating === 'number' && parsed.seating_rating >= 1 && parsed.seating_rating <= 5) update.seating_rating = parsed.seating_rating;
      if (parsed.confidence === 'inferred') update.confidence = 'inferred';
      if (typeof parsed.reason === 'string') update.enrichment_reason = parsed.reason;
      if (typeof parsed.key_quote === 'string' && parsed.key_quote.length > 0) update.key_review_quote = parsed.key_quote.substring(0, 150);

      await supabase.from('cafes').update(update).eq('id', cafe.id);
      console.log('[Background Enrich]', cafe.name, '→ laptop=', parsed.laptop_allowed, 'confidence=', parsed.confidence);

    } catch (e) {
      console.error('[Background Enrich] Error for', cafe.name, ':', e);
    }

    // 2 second delay between enrichments
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('[Background Enrich] Complete');
  return Response.json({ ok: true });
}
