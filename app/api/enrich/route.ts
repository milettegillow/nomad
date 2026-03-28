import { supabase } from '@/lib/supabase';
import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function needsEnrichment(cafe: { confidence: string; last_updated: string }): boolean {
  if (cafe.confidence === 'unconfirmed') return true;
  // Verified by community — never override
  if (cafe.confidence === 'verified') return false;
  const age = Date.now() - new Date(cafe.last_updated).getTime();
  return age > SEVEN_DAYS_MS;
}

async function fetchReviewsForPlace(googlePlaceId: string): Promise<{ reviews: string[]; types: string[] }> {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${googlePlaceId}`, {
      headers: {
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'reviews,types',
      },
    });
    if (!res.ok) return { reviews: [], types: [] };
    const data = await res.json();
    const reviews = (data.reviews || [])
      .slice(0, 5)
      .map((r: { text?: { text: string } }) => r.text?.text)
      .filter((t: string | undefined): t is string => !!t);
    return { reviews, types: data.types || [] };
  } catch {
    return { reviews: [], types: [] };
  }
}

async function enrichWithReviews(
  reviews: string[],
  types: string[],
  cafeName: string
): Promise<{
  laptop_allowed: boolean | null;
  wifi_rating: number | null;
  seating_rating: number | null;
  confidence: 'inferred' | 'unconfirmed';
}> {
  const fallback = { laptop_allowed: null, wifi_rating: null, seating_rating: null, confidence: 'unconfirmed' as const };

  if (reviews.length === 0 && types.length === 0) return fallback;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: 'You are analyzing café data to determine work-friendliness. Return ONLY a valid JSON object with no markdown, no explanation, just the JSON.',
      messages: [{
        role: 'user',
        content: `Based on these Google Maps reviews and place types, determine:
- laptop_allowed: true if reviews mention working, laptops, remote work, studying, good for work. false if reviews mention being asked to leave, no laptops, time limits. null if unclear.
- wifi_rating: 1-5 integer based on wifi quality mentions, null if no wifi info
- seating_rating: 1-5 integer (5=lots of seating/spacious, 1=very few seats/cramped), null if unclear
- confidence: 'inferred' if you found clear signals for at least 2 fields, 'unconfirmed' if mostly unclear

Reviews: ${JSON.stringify(reviews)}
Place types: ${JSON.stringify(types)}

Return only JSON.`,
      }],
    });

    const content = response.content[0];
    if (content.type !== 'text') return fallback;

    const parsed = JSON.parse(content.text);
    return {
      laptop_allowed: typeof parsed.laptop_allowed === 'boolean' ? parsed.laptop_allowed : null,
      wifi_rating: typeof parsed.wifi_rating === 'number' && parsed.wifi_rating >= 1 && parsed.wifi_rating <= 5 ? parsed.wifi_rating : null,
      seating_rating: typeof parsed.seating_rating === 'number' && parsed.seating_rating >= 1 && parsed.seating_rating <= 5 ? parsed.seating_rating : null,
      confidence: parsed.confidence === 'inferred' ? 'inferred' : 'unconfirmed',
    };
  } catch (e) {
    console.error('[Enrich] Review enrichment error for:', cafeName, e);
    return fallback;
  }
}

async function enrichWithBlogSearch(cafe: { name: string; address?: string | null }): Promise<{
  laptop_allowed: boolean | null;
  wifi_rating: number | null;
  seating_rating: number | null;
  blog_sources: string[];
  work_summary: string | null;
} | null> {
  try {
    const userMessage = `Search for blog posts, reviews, and travel guides about '${cafe.name}' in '${cafe.address || 'unknown location'}'. Look for information about: whether laptops are allowed, wifi quality, seating availability, and general work-friendliness.

Return a JSON object:
{
  "laptop_allowed": true/false/null,
  "wifi_rating": 1-5/null,
  "seating_rating": 1-5/null,
  "blog_sources": ["url1", "url2"],
  "summary": "one sentence summary of work-friendliness"
}`;

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

    let currentResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'You are researching a specific café to determine if it is good for working remotely. Search for blog posts, travel guides, and reviews about this café. Return ONLY a valid JSON object.',
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
    });

    while (currentResponse.stop_reason === 'tool_use') {
      const toolBlocks = currentResponse.content.filter(
        (b): b is Anthropic.ContentBlock & { type: 'tool_use' } => b.type === 'tool_use'
      );

      messages.push({ role: 'assistant', content: currentResponse.content });
      messages.push({
        role: 'user',
        content: toolBlocks.map((tb) => ({
          type: 'tool_result' as const,
          tool_use_id: tb.id,
          content: 'Continue with the search results.',
        })),
      });

      currentResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: 'You are researching a specific café to determine if it is good for working remotely. Search for blog posts, travel guides, and reviews about this café. Return ONLY a valid JSON object.',
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages,
      });
    }

    let resultText: string | null = null;
    for (const block of currentResponse.content) {
      if (block.type === 'text') resultText = block.text;
    }

    if (!resultText) return null;

    const cleaned = resultText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      laptop_allowed: typeof parsed.laptop_allowed === 'boolean' ? parsed.laptop_allowed : null,
      wifi_rating: typeof parsed.wifi_rating === 'number' && parsed.wifi_rating >= 1 && parsed.wifi_rating <= 5 ? parsed.wifi_rating : null,
      seating_rating: typeof parsed.seating_rating === 'number' && parsed.seating_rating >= 1 && parsed.seating_rating <= 5 ? parsed.seating_rating : null,
      blog_sources: Array.isArray(parsed.blog_sources) ? parsed.blog_sources.slice(0, 5) : [],
      work_summary: typeof parsed.summary === 'string' ? parsed.summary : null,
    };
  } catch (e) {
    console.error('[Enrich] Blog search error for:', cafe.name, e);
    return null;
  }
}

export async function POST(request: Request) {
  const { cafeIds } = await request.json() as { cafeIds: string[] };

  if (!cafeIds || cafeIds.length === 0) {
    return Response.json({ error: 'cafeIds required' }, { status: 400 });
  }

  console.log('[Enrich] === START SSE for', cafeIds.length, 'cafes ===');

  // Fetch all cafes from Supabase
  const { data: cafes, error } = await supabase
    .from('cafes')
    .select('*')
    .in('id', cafeIds);

  if (error || !cafes) {
    return Response.json({ error: 'Failed to fetch cafes' }, { status: 500 });
  }

  // Filter to only those needing enrichment
  const toEnrich = cafes.filter(needsEnrichment);
  console.log('[Enrich]', toEnrich.length, 'of', cafes.length, 'need enrichment');

  if (toEnrich.length === 0) {
    // Return a quick SSE stream with just complete
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete' })}\n\n`));
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream may be closed
        }
      };

      for (const cafe of toEnrich) {
        // Phase 1: Google review enrichment
        send({ type: 'status', message: `🔍 Analyzing reviews for ${cafe.name}...` });

        let reviewData = { reviews: [] as string[], types: [] as string[] };
        if (cafe.google_place_id) {
          reviewData = await fetchReviewsForPlace(cafe.google_place_id);
        }

        const reviewEnrichment = await enrichWithReviews(reviewData.reviews, reviewData.types, cafe.name);

        // Update Supabase with review enrichment
        const reviewUpdate: Record<string, unknown> = { last_updated: new Date().toISOString() };
        if (reviewEnrichment.laptop_allowed !== null) reviewUpdate.laptop_allowed = reviewEnrichment.laptop_allowed;
        if (reviewEnrichment.wifi_rating !== null) reviewUpdate.wifi_rating = reviewEnrichment.wifi_rating;
        if (reviewEnrichment.seating_rating !== null) reviewUpdate.seating_rating = reviewEnrichment.seating_rating;
        if (reviewEnrichment.confidence === 'inferred') reviewUpdate.confidence = 'inferred';

        await supabase.from('cafes').update(reviewUpdate).eq('id', cafe.id);

        // Re-fetch and send updated cafe
        const { data: updated1 } = await supabase.from('cafes').select('*').eq('id', cafe.id).single();
        if (updated1) {
          send({ type: 'cafe_updated', cafe: updated1 });
        }

        // Phase 2: Blog search enrichment
        send({ type: 'status', message: `📰 Searching blogs for ${cafe.name}...` });

        const blogResult = await enrichWithBlogSearch(cafe);

        if (blogResult) {
          const blogUpdate: Record<string, unknown> = { last_updated: new Date().toISOString() };
          const currentCafe = updated1 || cafe;

          // Only fill null fields
          if (blogResult.laptop_allowed !== null && currentCafe.laptop_allowed === null) {
            blogUpdate.laptop_allowed = blogResult.laptop_allowed;
          }
          if (blogResult.wifi_rating !== null && currentCafe.wifi_rating === null) {
            blogUpdate.wifi_rating = blogResult.wifi_rating;
          }
          if (blogResult.seating_rating !== null && currentCafe.seating_rating === null) {
            blogUpdate.seating_rating = blogResult.seating_rating;
          }
          if (blogResult.blog_sources.length > 0) {
            blogUpdate.blog_sources = blogResult.blog_sources;
          }
          if (blogResult.work_summary) {
            blogUpdate.work_summary = blogResult.work_summary;
          }
          if (currentCafe.confidence === 'unconfirmed' && Object.keys(blogUpdate).length > 1) {
            blogUpdate.confidence = 'inferred';
          }

          await supabase.from('cafes').update(blogUpdate).eq('id', cafe.id);

          const { data: updated2 } = await supabase.from('cafes').select('*').eq('id', cafe.id).single();
          if (updated2) {
            send({ type: 'cafe_updated', cafe: updated2 });
          }
        }
      }

      send({ type: 'status', message: '✓ Done' });
      send({ type: 'complete' });
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
