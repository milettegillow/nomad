import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY!;
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

export interface BlogCafe {
  name: string;
  address: string | null;
  wifi_notes: string | null;
  laptop_notes: string | null;
  seating_notes: string | null;
  source_url: string | null;
}

interface BraveResult {
  title: string;
  url: string;
  description: string;
}

async function braveSearch(query: string): Promise<BraveResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_SEARCH_API_KEY,
      },
    });
    if (!res.ok) {
      console.error('[Brave Search] Error:', res.status, await res.text().catch(() => ''));
      return [];
    }
    const data = await res.json();
    const results: BraveResult[] = (data.web?.results || []).map((r: { title: string; url: string; description: string }) => ({
      title: r.title || '',
      url: r.url || '',
      description: r.description || '',
    }));
    console.log(`[Brave Search] Fetched ${results.length} results for query: "${query}"`);
    return results;
  } catch (e) {
    console.error('[Brave Search] Fetch error for query:', query, e);
    return [];
  }
}

export async function POST(request: Request) {
  const { city } = await request.json() as { city: string };

  if (!city) {
    return Response.json({ error: 'city required' }, { status: 400 });
  }

  console.log('[Search Blogs] Starting Brave Search for:', city);
  const startTime = Date.now();

  try {
    // 3 parallel Brave Search queries
    const [results1, results2, results3] = await Promise.all([
      braveSearch(`best cafes to work from in ${city}`),
      braveSearch(`laptop friendly cafes wifi ${city}`),
      braveSearch(`remote work cafe coworking ${city}`),
    ]);

    const allResults = [...results1, ...results2, ...results3];
    console.log('[Search Blogs] Total Brave results:', allResults.length);

    if (allResults.length === 0) {
      console.log('[Search Blogs] No search results found');
      return Response.json({ cafes: [] });
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    const uniqueResults = allResults.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    // Build context for Claude
    const searchContext = uniqueResults
      .map(r => `[${r.title}](${r.url})\n${r.description}`)
      .join('\n\n');

    console.log('[Search Blogs] Sending', uniqueResults.length, 'unique results to Claude');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: 'You extract café names from search results. Return ONLY valid JSON with no markdown fences or explanation.',
      messages: [{
        role: 'user',
        content: `From these search results about cafes in ${city}, extract a list of specific cafe names that are mentioned as good for working, laptops, or remote work. For each cafe found, note any explicit mentions of wifi quality, laptop policy, or seating.

Only include cafés with SPECIFIC NAMES mentioned in the results. Do not make up names. If a result just says "best cafes in ${city}" but doesn't name any, skip it.

Search results:
${searchContext}

Return ONLY valid JSON:
{ "cafes": [{ "name": "...", "wifi_notes": "...", "laptop_notes": "...", "seating_notes": "...", "source_url": "..." }] }

wifi_notes, laptop_notes, seating_notes should be null if not explicitly mentioned. source_url should be the URL of the article where the café was found. Return up to 15 cafés.`,
      }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      console.log('[Search Blogs] No text response from Claude');
      return Response.json({ cafes: [] });
    }

    const cleaned = content.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const cafes: BlogCafe[] = (parsed.cafes || []).map((c: Record<string, unknown>) => ({
      name: typeof c.name === 'string' ? c.name : 'Unknown',
      address: null,
      wifi_notes: typeof c.wifi_notes === 'string' ? c.wifi_notes : null,
      laptop_notes: typeof c.laptop_notes === 'string' ? c.laptop_notes : null,
      seating_notes: typeof c.seating_notes === 'string' ? c.seating_notes : null,
      source_url: typeof c.source_url === 'string' ? c.source_url : null,
    }));

    const elapsed = Date.now() - startTime;
    console.log(`[Search Blogs] Found ${cafes.length} cafés in ${elapsed}ms: ${cafes.map(c => c.name).join(', ')}`);
    return Response.json({ cafes });
  } catch (e) {
    console.error('[Search Blogs] Error:', e);
    return Response.json({ cafes: [] });
  }
}
