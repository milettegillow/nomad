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

export interface NegativeCafe {
  name: string;
  issue: string;
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

function deduplicateByUrl(results: BraveResult[]): BraveResult[] {
  const seen = new Set<string>();
  return results.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

function buildSearchContext(results: BraveResult[]): string {
  return results.map((r, i) => `[Result ${i + 1}] URL: ${r.url}\nTitle: ${r.title}\nSnippet: ${r.description}`).join('\n\n');
}

export async function POST(request: Request) {
  const { city } = await request.json() as { city: string };

  if (!city) {
    return Response.json({ error: 'city required' }, { status: 400 });
  }

  console.log('[Search Blogs] Starting Brave Search for:', city);
  const startTime = Date.now();

  try {
    // 5 parallel Brave Search queries — 3 positive, 2 negative/reddit
    const [results1, results2, results3, results4, results5] = await Promise.all([
      braveSearch(`best cafes to work from in ${city}`),
      braveSearch(`best coworking cafes ${city}`),
      braveSearch(`laptop friendly cafes ${city} wifi`),
      braveSearch(`remote work digital nomad cafe ${city}`),
      braveSearch(`site:reddit.com "${city}" cafe laptop wifi working`),
    ]);

    // Positive results (queries 1-4 + reddit)
    const positiveResults = deduplicateByUrl([...results1, ...results2, ...results3, ...results4, ...results5]);
    // Negative results (reddit can have both positive and negative)
    const negativeResults = deduplicateByUrl([...results5]);

    console.log('[Search Blogs] Positive results:', positiveResults.length, '| Negative results:', negativeResults.length);

    // Extract positive cafés and negative cafés in parallel with Claude
    const [cafes, negativeCafes] = await Promise.all([
      extractPositiveCafes(positiveResults, city),
      extractNegativeCafes(negativeResults, city),
    ]);

    const elapsed = Date.now() - startTime;
    console.log(`[Search Blogs] Found ${cafes.length} positive cafés in ${elapsed}ms: ${cafes.map(c => c.name).join(', ')}`);
    if (negativeCafes.length > 0) {
      console.log(`[Search Blogs] Found ${negativeCafes.length} negative cafés: ${negativeCafes.map(c => `${c.name} (${c.issue})`).join(', ')}`);
    }

    return Response.json({ cafes, negative_cafes: negativeCafes });
  } catch (e) {
    console.error('[Search Blogs] Error:', e);
    return Response.json({ cafes: [], negative_cafes: [] });
  }
}

async function extractPositiveCafes(results: BraveResult[], city: string): Promise<BlogCafe[]> {
  if (results.length === 0) return [];

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: 'You extract café names from search results. Return ONLY valid JSON with no markdown fences or explanation.',
      messages: [{
        role: 'user',
        content: `From these search results about cafes in ${city}, extract a list of specific cafe names that are mentioned as good for working, laptops, or remote work. For each cafe found, note any explicit mentions of wifi quality, laptop policy, or seating.

RULES:
- Only include cafés with SPECIFIC NAMES mentioned in the results. Do not make up names.
- If a result just says "best cafes" but doesn't name specific cafés, skip it.
- source_url: Only assign a source_url to a café if that specific URL's content explicitly mentions that café by name. Do not assign a URL from one article to a café mentioned in a different article. If you cannot confidently attribute a URL to a specific café, set source_url to null.
- wifi_notes, laptop_notes, seating_notes: set to null if not explicitly mentioned in the same result that names the café.

Each search result below has a URL, title, and snippet. Match café names to the specific result that mentions them.

Search results:
${buildSearchContext(results)}

Return ONLY valid JSON:
{ "cafes": [{ "name": "...", "wifi_notes": "...", "laptop_notes": "...", "seating_notes": "...", "source_url": "..." }] }

Return up to 15 cafés.`,
      }],
    });

    const content = response.content[0];
    if (content.type !== 'text') return [];

    const cleaned = content.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return (parsed.cafes || []).map((c: Record<string, unknown>) => ({
      name: typeof c.name === 'string' ? c.name : 'Unknown',
      address: null,
      wifi_notes: typeof c.wifi_notes === 'string' ? c.wifi_notes : null,
      laptop_notes: typeof c.laptop_notes === 'string' ? c.laptop_notes : null,
      seating_notes: typeof c.seating_notes === 'string' ? c.seating_notes : null,
      source_url: typeof c.source_url === 'string' ? c.source_url : null,
    }));
  } catch (e) {
    console.error('[Search Blogs] Positive extraction error:', e);
    return [];
  }
}

async function extractNegativeCafes(results: BraveResult[], city: string): Promise<NegativeCafe[]> {
  if (results.length === 0) return [];

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'You extract café names mentioned negatively for remote work. Return ONLY valid JSON with no markdown fences or explanation.',
      messages: [{
        role: 'user',
        content: `From these search results, extract any specific cafés in ${city} that are mentioned NEGATIVELY for working — e.g. no wifi, no laptops allowed, time limits on staying, asked to leave, bad for remote work. For each café found, note the specific complaint.

Only include cafés with SPECIFIC NAMES and SPECIFIC complaints. Do not make up names.

Search results:
${buildSearchContext(results)}

Return ONLY valid JSON:
{ "negative_cafes": [{ "name": "...", "issue": "..." }] }`,
      }],
    });

    const content = response.content[0];
    if (content.type !== 'text') return [];

    const cleaned = content.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return (parsed.negative_cafes || []).map((c: Record<string, unknown>) => ({
      name: typeof c.name === 'string' ? c.name : 'Unknown',
      issue: typeof c.issue === 'string' ? c.issue : 'unknown issue',
    }));
  } catch (e) {
    console.error('[Search Blogs] Negative extraction error:', e);
    return [];
  }
}
