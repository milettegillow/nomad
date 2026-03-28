import { supabase } from '@/lib/supabase';
import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

interface BlogEnrichmentResult {
  laptop_allowed: boolean | null;
  wifi_rating: number | null;
  seating_rating: number | null;
  blog_sources: string[];
  summary: string | null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cafeId: string }> }
) {
  const { cafeId } = await params;
  console.log('[Blog Enrichment] === START for cafe:', cafeId, '===');

  try {
    // Fetch cafe from Supabase
    const { data: cafe, error } = await supabase
      .from('cafes')
      .select('*')
      .eq('id', cafeId)
      .single();

    if (error || !cafe) {
      console.error('[Blog Enrichment] Cafe not found:', cafeId, error);
      return Response.json({ error: 'Cafe not found' }, { status: 404 });
    }

    // Skip if already enriched with blog data
    if (cafe.work_summary && cafe.confidence !== 'unconfirmed') {
      console.log('[Blog Enrichment] Already enriched, skipping:', cafe.name);
      return Response.json({ skipped: true });
    }

    console.log('[Blog Enrichment] Searching blogs for:', cafe.name, 'at', cafe.address);

    const userMessage = `Search for blog posts, reviews, and travel guides about '${cafe.name}' in '${cafe.address || 'unknown location'}'. Look for information about: whether laptops are allowed, wifi quality, seating availability, and general work-friendliness.

Return a JSON object:
{
  "laptop_allowed": true/false/null,
  "wifi_rating": 1-5/null,
  "seating_rating": 1-5/null,
  "blog_sources": ["url1", "url2"],
  "summary": "one sentence summary of work-friendliness"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'You are researching a specific café to determine if it is good for working remotely. Search for blog posts, travel guides, and reviews about this café. Return ONLY a valid JSON object.',
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: userMessage }],
    });

    // Extract the final text response (after tool use)
    let resultText: string | null = null;
    for (const block of response.content) {
      if (block.type === 'text') {
        resultText = block.text;
      }
    }

    // If the model needs to continue after tool use, keep going
    let currentResponse = response;
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

    while (currentResponse.stop_reason === 'tool_use') {
      // Collect tool results
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

      for (const block of currentResponse.content) {
        if (block.type === 'text') {
          resultText = block.text;
        }
      }
    }

    if (!resultText) {
      console.log('[Blog Enrichment] No text response from AI for:', cafe.name);
      return Response.json({ error: 'No enrichment data' }, { status: 500 });
    }

    console.log('[Blog Enrichment] Raw AI response:', resultText.substring(0, 500));

    let parsed: BlogEnrichmentResult;
    try {
      // Strip markdown code fences if present
      const cleaned = resultText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('[Blog Enrichment] Failed to parse AI response:', resultText);
      return Response.json({ error: 'Parse error' }, { status: 500 });
    }

    // Check if blog enrichment found stronger signals than existing
    const hasNewSignals =
      (parsed.laptop_allowed !== null && cafe.laptop_allowed === null) ||
      (parsed.wifi_rating !== null && cafe.wifi_rating === null) ||
      (parsed.seating_rating !== null && cafe.seating_rating === null) ||
      (parsed.summary && !cafe.work_summary);

    if (!hasNewSignals && parsed.blog_sources.length === 0) {
      console.log('[Blog Enrichment] No new signals for:', cafe.name);
      return Response.json({ skipped: true, reason: 'no new signals' });
    }

    // Build update — only override null fields (don't overwrite existing enrichment or community data)
    const update: Record<string, unknown> = {
      last_updated: new Date().toISOString(),
    };

    if (parsed.laptop_allowed !== null && cafe.laptop_allowed === null) {
      update.laptop_allowed = parsed.laptop_allowed;
    }
    if (parsed.wifi_rating !== null && cafe.wifi_rating === null) {
      update.wifi_rating = Math.min(5, Math.max(1, parsed.wifi_rating));
    }
    if (parsed.seating_rating !== null && cafe.seating_rating === null) {
      update.seating_rating = Math.min(5, Math.max(1, parsed.seating_rating));
    }
    if (parsed.blog_sources && parsed.blog_sources.length > 0) {
      update.blog_sources = parsed.blog_sources.slice(0, 5); // Limit to 5 sources
    }
    if (parsed.summary) {
      update.work_summary = parsed.summary;
    }

    // Upgrade confidence if we found real data
    if (cafe.confidence === 'unconfirmed' && Object.keys(update).length > 2) {
      update.confidence = 'inferred';
    }

    const { error: updateError } = await supabase
      .from('cafes')
      .update(update)
      .eq('id', cafeId);

    if (updateError) {
      console.error('[Blog Enrichment] Update error:', updateError);
      return Response.json({ error: 'Update failed', details: updateError.message }, { status: 500 });
    }

    console.log('[Blog Enrichment] Updated cafe:', cafe.name, 'with:', Object.keys(update).join(', '));
    console.log('[Blog Enrichment] === END for cafe:', cafeId, '===');
    return Response.json({ success: true, updated: Object.keys(update) });

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[Blog Enrichment] UNHANDLED ERROR:', message);
    return Response.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
