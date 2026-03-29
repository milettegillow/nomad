const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY!;

const WORK_KEYWORDS = ['work', 'coworking', 'laptop', 'wifi', 'wi-fi', 'telework', 'nomad', 'remote work', 'study', 'freelanc', 'digital nomad', 'outlet', 'plug'];

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

function snippetHasWorkKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return WORK_KEYWORDS.some(kw => lower.includes(kw));
}

export interface BlogSnippet {
  title: string;
  snippet: string;
  url: string;
}

export async function POST(request: Request) {
  const { city } = await request.json() as { city: string };

  if (!city) {
    return Response.json({ error: 'city required' }, { status: 400 });
  }

  const isLondon = city.toLowerCase().includes('london');
  console.log(`[Search Blogs] Starting Brave Search for: ${city}${isLondon ? ' [LONDON DEEP SEARCH]' : ''}`);
  const startTime = Date.now();

  try {
    const queries = isLondon
      ? [
          `best cafes to work from in London`,
          `best coworking cafes London 2024 2025`,
          `laptop friendly cafes London wifi`,
          `best coffee shops for remote work London`,
          `digital nomad cafes London`,
          `best cafes to study in London`,
          `London cafes good for working from laptop reddit`,
          `best neighbourhood cafes work London Shoreditch Soho Hackney Brixton`,
        ]
      : [
          `best cafes to work from in ${city}`,
          `best coworking cafes ${city}`,
          `laptop friendly cafes ${city} wifi`,
          `remote work digital nomad cafe ${city}`,
          `site:reddit.com "${city}" cafe laptop wifi working`,
        ];

    if (isLondon) {
      console.log(`[London Special] Running expanded search with ${queries.length} queries`);
    }

    const allQueryResults = await Promise.all(queries.map(q => braveSearch(q)));
    const allResults = allQueryResults.flat();

    // Deduplicate by URL
    const seen = new Set<string>();
    const unique = allResults.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    // Filter to snippets that contain work keywords
    const workSnippets: BlogSnippet[] = unique
      .filter(r => snippetHasWorkKeyword(r.title + ' ' + r.description))
      .map(r => ({ title: r.title, snippet: r.description, url: r.url }));

    const elapsed = Date.now() - startTime;
    console.log(`[Search Blogs] ${workSnippets.length} work-related snippets from ${unique.length} unique results in ${elapsed}ms`);

    return Response.json({ snippets: workSnippets });
  } catch (e) {
    console.error('[Search Blogs] Error:', e);
    return Response.json({ snippets: [] });
  }
}
