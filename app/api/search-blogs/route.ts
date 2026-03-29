import Anthropic from '@anthropic-ai/sdk';

const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const WORK_KEYWORDS = ['work', 'coworking', 'laptop', 'wifi', 'wi-fi', 'telework', 'nomad', 'remote work', 'study', 'freelanc', 'digital nomad', 'outlet', 'plug'];

const TIER1_CITIES = ['london', 'londres'];
const TIER2_CITIES = ['paris', 'berlin', 'barcelona', 'lisbon', 'lisboa', 'amsterdam', 'new york', 'bangkok', 'bali', 'tokyo', 'singapore', 'melbourne', 'medellin', 'medellín', 'rome', 'roma', 'prague', 'praha', 'budapest', 'chiang mai', 'mueang chiang mai', 'เชียงใหม่', 'florence', 'firenze', 'venice', 'venezia', 'naples', 'napoli', 'cologne', 'köln', 'munich', 'münchen', 'vienna', 'wien', 'mexico city', 'cdmx'];

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

const TIER2_AREAS: Record<string, string[]> = {
  paris: ['Marais', 'Montmartre', 'Saint-Germain', 'Bastille', 'Belleville'],
  berlin: ['Mitte', 'Prenzlauer Berg', 'Kreuzberg', 'Friedrichshain', 'Neukölln'],
  barcelona: ['Gothic Quarter', 'Eixample', 'Gracia', 'Poble Nou', 'Barceloneta'],
  amsterdam: ['Jordaan', 'De Pijp', 'Oud-West', 'Oost', 'Centrum'],
  lisbon: ['Alfama', 'Bairro Alto', 'LX Factory', 'Príncipe Real', 'Intendente'],
  'new york': ['Manhattan', 'Brooklyn', 'Williamsburg', 'East Village', 'Soho'],
  bangkok: ['Silom', 'Sukhumvit', 'Ari', 'Thonglor', 'Ekkamai'],
  'chiang mai': ['Old City', 'Nimman', 'Santitham', 'Chang Phueak', 'Night Bazaar'],
};

const LONDON_AREAS = [
  'Shoreditch', 'Brixton', 'Hackney', 'Soho', 'Peckham', 'Dalston', 'Islington',
  'Clerkenwell', 'Bethnal Green', 'Notting Hill', 'Fitzrovia', 'Bermondsey',
  'Camden', 'Clapham', 'Wimbledon', 'Richmond', 'Wandsworth', 'Battersea',
  'Fulham', 'Chelsea', 'Kensington', 'Mayfair', 'Marylebone', 'Paddington',
  'Hammersmith', 'Ealing', 'Walthamstow', 'Stratford', 'Canary Wharf',
  'Greenwich', 'Lewisham', 'Tooting', 'Stoke Newington', 'Finsbury Park',
  'Archway', 'Kentish Town', 'Crouch End', 'Muswell Hill',
];

const GOOD_DOMAINS = ['timeout.com', 'reddit.com', 'medium.com', 'nomadlist.com', 'theguardian.com', 'londonist.com', 'secretldn.com', 'theinfatuation.com', 'yelp.com', 'tripadvisor.com', 'workfrom.co', 'foursquare.com'];
const SKIP_DOMAINS = ['booking.com', 'hotels.com', 'instagram.com', 'twitter.com', 'facebook.com', 'pinterest.com', 'youtube.com', 'tiktok.com'];
const URL_KEYWORDS = ['best', 'top', 'guide', 'work', 'cafe', 'coffee', 'laptop', 'remote', 'nomad', 'cowork', 'study', 'freelanc'];

function getTier(city: string): number {
  const c = city.toLowerCase();
  if (TIER1_CITIES.some(t => c.includes(t))) return 1;
  if (TIER2_CITIES.some(t => c.includes(t))) return 2;
  return 3;
}

interface BraveResult { title: string; url: string; description: string; }

async function braveSearch(query: string): Promise<BraveResult[]> {
  const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
  try {
    console.log('[Brave Key Check] Key length:', process.env.BRAVE_SEARCH_API_KEY?.length);
    console.log('[Brave Key Check] Key starts with:', process.env.BRAVE_SEARCH_API_KEY?.slice(0, 4));
    console.log('[Brave Key Check] Header being sent:', JSON.stringify({ 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY?.slice(0, 4) + '...' }));
    const res = await fetch(searchUrl, {
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': BRAVE_SEARCH_API_KEY },
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[Brave] ${res.status} for "${query.substring(0, 50)}": ${errBody.substring(0, 200)}`);
      return [];
    }
    const data = await res.json();
    const results = (data.web?.results || []).map((r: { title: string; url: string; description: string }) => ({
      title: r.title || '', url: r.url || '', description: r.description || '',
    }));
    return results;
  } catch { return []; }
}

function scoreUrl(r: BraveResult): number {
  const urlLower = r.url.toLowerCase();
  const titleLower = (r.title + ' ' + r.description).toLowerCase();
  if (SKIP_DOMAINS.some(d => urlLower.includes(d))) return -1;
  let score = 0;
  if (GOOD_DOMAINS.some(d => urlLower.includes(d))) score += 5;
  score += URL_KEYWORDS.filter(kw => urlLower.includes(kw) || titleLower.includes(kw)).length;
  return score;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRedditText(json: unknown): string {
  const texts: string[] = [];
  function walk(obj: unknown) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    const rec = obj as Record<string, unknown>;
    if (typeof rec.body === 'string') texts.push(rec.body);
    if (typeof rec.selftext === 'string') texts.push(rec.selftext);
    if (typeof rec.title === 'string') texts.push(rec.title);
    for (const v of Object.values(rec)) walk(v);
  }
  walk(json);
  return texts.join('\n\n');
}

async function fetchPageContent(url: string): Promise<string | null> {
  const isReddit = url.includes('reddit.com');
  const charLimit = isReddit ? 8000 : 3000;

  try {
    let fetchUrl = url;
    if (isReddit) {
      fetchUrl = url.replace(/\?.*$/, '') + '.json';
      console.log(`[Fetch] Reddit URL — using 8000 char limit and JSON endpoint`);
    }

    const res = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    let text: string;
    if (isReddit) {
      try {
        const json = await res.json();
        text = extractRedditText(json).slice(0, charLimit);
      } catch {
        // Fallback to HTML stripping if JSON parse fails
        const html = await res.text();
        text = stripHtml(html).slice(0, charLimit);
      }
    } else {
      const html = await res.text();
      text = stripHtml(html).slice(0, charLimit);
    }

    console.log(`[Fetch] Got content from ${url.substring(0, 60)} — ${text.length} chars${isReddit ? ' (Reddit JSON)' : ''}`);
    return text;
  } catch (e) {
    console.log(`[Fetch] Failed: ${url.substring(0, 60)} — ${e instanceof Error ? e.message : 'unknown'}`);
    return null;
  }
}

async function fetchUrlsBatched(urls: string[], batchSize = 10): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map(async url => {
      const content = await fetchPageContent(url);
      if (content) results.set(url, content);
    }));
    void settled;
    if (i + batchSize < urls.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return results;
}

export interface BlogSnippet { title: string; snippet: string; url: string; }
export interface BlogCafeExtracted { name: string; area: string | null; laptop_notes: string | null; wifi_notes: string | null; source_url: string | null; }
export interface NegativeCafeExtracted { name: string; issue: string; source_url: string | null; }

export async function POST(request: Request) {
  const { city } = await request.json() as { city: string };
  if (!city) return Response.json({ error: 'city required' }, { status: 400 });

  const tier = getTier(city);
  const searchCity = normalizeCity(city);
  const cityLower = city.toLowerCase();
  console.log(`[Search Blogs] City: ${city} → ${searchCity}, Tier: ${tier}`);
  const startTime = Date.now();

  try {
    // Build queries
    const positiveQueries = [
      `best cafes to work from in ${searchCity}`,
      `laptop friendly cafes ${searchCity} wifi`,
      `best coffee shops remote work ${searchCity}`,
      `site:reddit.com best cafes work ${searchCity}`,
      `site:reddit.com ${searchCity} cafe laptop wifi`,
      `site:reddit.com ${searchCity} cafe wifi laptop working`,
      `site:reddit.com best coffee shop ${searchCity} study`,
    ];

    if (tier <= 2) {
      positiveQueries.push(
        `digital nomad cafes ${searchCity}`, `best coworking cafes ${searchCity}`,
        `best cafes to study in ${searchCity}`, `freelancer cafes ${searchCity}`,
        `best independent cafes ${searchCity} wifi`,
      );
      const areas = tier === 1 ? LONDON_AREAS : (TIER2_AREAS[cityLower] || []);
      for (const area of areas) {
        positiveQueries.push(`best cafes to work from in ${area} ${searchCity}`);
      }
    }

    if (tier === 1) {
      positiveQueries.push(
        'best coffee shops for remote work London', 'best independent cafes London wifi',
        'work from cafe London guide', 'best cafes for freelancers London',
        'London cafe wifi laptop friendly guide 2024', 'London cafe wifi laptop friendly guide 2025',
        'best cafes to work from London reddit', 'site:reddit.com r/london best coffee shop work',
      );
    }

    const negativeQueries = [
      `site:reddit.com ${searchCity} cafe no laptops`,
      `${searchCity} cafe no laptop policy`,
      `${searchCity} cafe asked to leave working`,
    ];
    if (tier <= 2) {
      negativeQueries.push(`${searchCity} cafe time limit laptop`, `${searchCity} cafe anti laptop`);
    }
    if (tier === 1) {
      negativeQueries.push('site:reddit.com London cafe kicked out working', 'London cafe no wifi policy');
    }

    console.log(`[Search Blogs] ${positiveQueries.length} positive + ${negativeQueries.length} negative queries`);

    // Run all Brave searches in parallel
    const [posResults, negResults] = await Promise.all([
      Promise.all(positiveQueries.map(q => braveSearch(q))),
      Promise.all(negativeQueries.map(q => braveSearch(q))),
    ]);

    const dedup = (results: BraveResult[][]) => {
      const seen = new Set<string>();
      return results.flat().filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; });
    };

    const uniquePositive = dedup(posResults).filter(r => WORK_KEYWORDS.some(kw => (r.title + ' ' + r.description).toLowerCase().includes(kw)));
    const uniqueNegative = dedup(negResults);

    console.log(`[Search Blogs] ${uniquePositive.length} positive, ${uniqueNegative.length} negative snippets`);

    const snippets: BlogSnippet[] = uniquePositive.map(r => ({ title: r.title, snippet: r.description, url: r.url }));

    // Tier 3: no full-page fetch, no Claude — just return raw snippets
    if (tier === 3) {
      // Still fetch top 5 URLs for richer context
      const scored = uniquePositive.filter(r => scoreUrl(r) >= 0).sort((a, b) => scoreUrl(b) - scoreUrl(a)).slice(0, 5);
      const pageContent = await fetchUrlsBatched(scored.map(r => r.url));
      console.log(`[Fetch] Got full content from ${pageContent.size} of ${scored.length} URLs`);

      // Combine snippets + page content for raw return
      const fullSnippets: BlogSnippet[] = snippets.map(s => {
        const page = pageContent.get(s.url);
        return page ? { ...s, snippet: s.snippet + '\n\n' + page.substring(0, 500) } : s;
      });

      return Response.json({ snippets: fullSnippets, cafes: [], negative_cafes: [] });
    }

    // Tier 1 & 2: fetch full page content from top URLs
    const maxUrls = tier === 1 ? 96 : 15;
    const scored = uniquePositive
      .filter(r => scoreUrl(r) >= 0)
      .sort((a, b) => scoreUrl(b) - scoreUrl(a))
      .slice(0, maxUrls);

    console.log(`[Fetch] Fetching full content from ${scored.length} URLs...`);
    const pageContent = await fetchUrlsBatched(scored.map(r => r.url));
    console.log(`[Fetch] Got full content from ${pageContent.size} of ${scored.length} URLs`);

    // Build combined context: snippets + full page content
    const snippetContext = uniquePositive.slice(0, 100).map((r, i) => `[Snippet ${i + 1}] ${r.title}\n${r.description}\nURL: ${r.url}`).join('\n\n');

    const pageContext = Array.from(pageContent.entries())
      .map(([url, text]) => `[FULL PAGE: ${url}]\n${text}`)
      .join('\n\n---\n\n');

    const combinedContext = `SEARCH SNIPPETS:\n${snippetContext}\n\nFULL PAGE CONTENT:\n${pageContext}`;

    // Claude extraction
    let cafes: BlogCafeExtracted[] = [];
    if (combinedContext.length > 100) {
      try {
        // Truncate to ~30k chars to stay within Claude limits
        const truncated = combinedContext.substring(0, 30000);
        const res = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: `You are extracting café names from blog posts and search results about work-friendly cafés.
Extract EVERY café name mentioned in a positive working context — wifi, laptops, remote work, studying, coworking.
Be thorough — aim to find every single café mentioned.
For ${searchCity} results, also extract which area/borough the café is in if mentioned.
Return ONLY valid JSON — no text before or after the JSON.`,
          messages: [{ role: 'user', content: `Extract ALL café names from these results about ${searchCity}:\n\n${truncated}\n\nReturn ONLY valid JSON:\n{ "cafes": [{ "name": "...", "area": "...", "laptop_notes": "...", "source_url": "..." }] }` }],
        });
        const text = res.content[0];
        if (text.type === 'text') {
          const cleaned = text.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          cafes = (JSON.parse(cleaned).cafes || [])
            .map((c: Record<string, unknown>) => ({ name: String(c.name || ''), area: c.area ? String(c.area) : null, laptop_notes: c.laptop_notes ? String(c.laptop_notes) : null, wifi_notes: c.wifi_notes ? String(c.wifi_notes) : null, source_url: c.source_url ? String(c.source_url) : null }))
            .filter((c: BlogCafeExtracted) => c.name.length > 0);
        }
      } catch (e) { console.error('[Search Blogs] Claude extraction error:', e); }
    }

    // Negative extraction
    let negative_cafes: NegativeCafeExtracted[] = [];
    if (uniqueNegative.length > 0) {
      const negContext = uniqueNegative.slice(0, 50).map((r, i) => `[${i + 1}] ${r.title}\n${r.description}\nURL: ${r.url}`).join('\n\n');
      try {
        const res = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: 'Extract café names mentioned negatively. Return ONLY valid JSON, no markdown.',
          messages: [{ role: 'user', content: `Extract café names mentioned NEGATIVELY for working in ${searchCity} — no laptops, time limits, asked to leave, no wifi.\n\n${negContext}\n\nReturn ONLY valid JSON:\n{ "negative_cafes": [{ "name": "...", "issue": "...", "source_url": "..." }] }` }],
        });
        const text = res.content[0];
        if (text.type === 'text') {
          const cleaned = text.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          negative_cafes = (JSON.parse(cleaned).negative_cafes || [])
            .map((c: Record<string, unknown>) => ({ name: String(c.name || ''), issue: String(c.issue || ''), source_url: c.source_url ? String(c.source_url) : null }))
            .filter((c: NegativeCafeExtracted) => c.name.length > 0);
        }
      } catch (e) { console.error('[Search Blogs] Claude negative extraction error:', e); }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Step 1] Found ${cafes.length} work-friendly cafés in ${searchCity} from ${pageContent.size} pages + ${uniquePositive.length} snippets (${elapsed}ms)`);
    console.log(`[Step 2] Found ${negative_cafes.length} negative signals`);

    return Response.json({ snippets, cafes, negative_cafes });
  } catch (e) {
    console.error('[Search Blogs] Error:', e);
    return Response.json({ snippets: [], cafes: [], negative_cafes: [] });
  }
}
