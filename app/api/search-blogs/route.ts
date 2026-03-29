import Anthropic from '@anthropic-ai/sdk';

const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const WORK_KEYWORDS = ['work', 'coworking', 'laptop', 'wifi', 'wi-fi', 'telework', 'nomad', 'remote work', 'study', 'freelanc', 'digital nomad', 'outlet', 'plug'];

const TIER1_CITIES = ['london'];
const TIER2_CITIES = ['paris', 'berlin', 'barcelona', 'lisbon', 'amsterdam', 'new york', 'bangkok', 'bali', 'tokyo', 'singapore', 'melbourne', 'medellin', 'medellín', 'rome', 'prague', 'budapest'];

const TIER2_AREAS: Record<string, string[]> = {
  paris: ['Marais', 'Montmartre', 'Saint-Germain', 'Bastille', 'Belleville'],
  berlin: ['Mitte', 'Prenzlauer Berg', 'Kreuzberg', 'Friedrichshain', 'Neukölln'],
  barcelona: ['Gothic Quarter', 'Eixample', 'Gracia', 'Poble Nou', 'Barceloneta'],
  amsterdam: ['Jordaan', 'De Pijp', 'Oud-West', 'Oost', 'Centrum'],
  lisbon: ['Alfama', 'Bairro Alto', 'LX Factory', 'Príncipe Real', 'Intendente'],
  'new york': ['Manhattan', 'Brooklyn', 'Williamsburg', 'East Village', 'Soho'],
  bangkok: ['Silom', 'Sukhumvit', 'Ari', 'Thonglor', 'Ekkamai'],
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

function getTier(city: string): number {
  const c = city.toLowerCase();
  if (TIER1_CITIES.some(t => c.includes(t))) return 1;
  if (TIER2_CITIES.some(t => c.includes(t))) return 2;
  return 3;
}

interface BraveResult { title: string; url: string; description: string; }

async function braveSearch(query: string): Promise<BraveResult[]> {
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': BRAVE_SEARCH_API_KEY },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.web?.results || []).map((r: { title: string; url: string; description: string }) => ({
      title: r.title || '', url: r.url || '', description: r.description || '',
    }));
  } catch { return []; }
}

export interface BlogSnippet { title: string; snippet: string; url: string; }
export interface BlogCafeExtracted { name: string; area: string | null; laptop_notes: string | null; wifi_notes: string | null; source_url: string | null; }
export interface NegativeCafeExtracted { name: string; issue: string; source_url: string | null; }

export async function POST(request: Request) {
  const { city } = await request.json() as { city: string };
  if (!city) return Response.json({ error: 'city required' }, { status: 400 });

  const tier = getTier(city);
  const cityLower = city.toLowerCase();
  console.log(`[Search Blogs] City: ${city}, Tier: ${tier}`);
  const startTime = Date.now();

  try {
    // Base queries (all tiers — includes Reddit)
    const positiveQueries = [
      `best cafes to work from in ${city}`,
      `laptop friendly cafes ${city} wifi`,
      `best coffee shops remote work ${city}`,
      `site:reddit.com best cafes work ${city}`,
      `site:reddit.com ${city} cafe laptop wifi`,
      `site:reddit.com ${city} cafe wifi laptop working`,
      `site:reddit.com best coffee shop ${city} study`,
    ];

    // Tier 2 additions
    if (tier <= 2) {
      positiveQueries.push(
        `digital nomad cafes ${city}`,
        `best coworking cafes ${city}`,
        `best cafes to study in ${city}`,
        `freelancer cafes ${city}`,
        `best independent cafes ${city} wifi`,
      );
      // Neighbourhood queries
      const areas = tier === 1 ? LONDON_AREAS : (TIER2_AREAS[cityLower] || []);
      for (const area of areas) {
        positiveQueries.push(`best cafes to work from in ${area} ${city}`);
      }
    }

    // Tier 1 London extras
    if (tier === 1) {
      positiveQueries.push(
        'best coffee shops for remote work London',
        'best independent cafes London wifi',
        'work from cafe London guide',
        'best cafes for freelancers London',
        'London cafe wifi laptop friendly guide 2024',
        'London cafe wifi laptop friendly guide 2025',
        'best cafes to work from London reddit',
        'site:reddit.com r/london best coffee shop work',
      );
    }

    // Negative queries (all tiers)
    const negativeQueries = [
      `site:reddit.com ${city} cafe no laptops`,
      `${city} cafe no laptop policy`,
      `${city} cafe asked to leave working`,
    ];
    if (tier <= 2) {
      negativeQueries.push(
        `${city} cafe time limit laptop`,
        `${city} cafe anti laptop`,
      );
    }
    if (tier === 1) {
      negativeQueries.push(
        'site:reddit.com London cafe kicked out working',
        'London cafe no wifi policy',
      );
    }

    console.log(`[Search Blogs] Running ${positiveQueries.length} positive + ${negativeQueries.length} negative queries`);

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

    // Tier 3: no Claude extraction, just return raw snippets
    if (tier === 3) {
      return Response.json({ snippets, cafes: [], negative_cafes: [] });
    }

    // Tier 1 & 2: Claude extraction
    const posContext = uniquePositive.slice(0, 200).map((r, i) => `[${i + 1}] ${r.title}\n${r.description}\nURL: ${r.url}`).join('\n\n');
    let cafes: BlogCafeExtracted[] = [];
    if (posContext) {
      try {
        const res = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: 'You are extracting café names from search results. Be VERY generous — extract ANY café, coffee shop, or workspace that is mentioned positively in the context of working, wifi, laptops, or studying. Include cafés mentioned in passing comments, not just dedicated blog posts. For Reddit results especially, extract any café name mentioned even once in a positive working context. Return ONLY valid JSON, no markdown.',
          messages: [{ role: 'user', content: `Extract ALL café names from these search results about ${city}. Include every café, coffee shop, or coworking space mentioned in a positive work context — even if only mentioned once in a Reddit comment.\n\nSearch results:\n${posContext}\n\nReturn ONLY valid JSON:\n{ "cafes": [{ "name": "...", "area": "...", "laptop_notes": "...", "wifi_notes": "...", "source_url": "..." }] }` }],
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

    let negative_cafes: NegativeCafeExtracted[] = [];
    if (uniqueNegative.length > 0) {
      const negContext = uniqueNegative.slice(0, 50).map((r, i) => `[${i + 1}] ${r.title}\n${r.description}\nURL: ${r.url}`).join('\n\n');
      try {
        const res = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: 'Extract café names mentioned negatively. Return ONLY valid JSON, no markdown.',
          messages: [{ role: 'user', content: `Extract café names mentioned NEGATIVELY for working in ${city} — no laptops, time limits, asked to leave, no wifi.\n\nSearch results:\n${negContext}\n\nReturn ONLY valid JSON:\n{ "negative_cafes": [{ "name": "...", "issue": "...", "source_url": "..." }] }` }],
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
    console.log(`[Step 1] Found ${cafes.length} work-friendly cafés in ${city} (${elapsed}ms)`);
    console.log(`[Step 2] Found ${negative_cafes.length} negative signals`);

    return Response.json({ snippets, cafes, negative_cafes });
  } catch (e) {
    console.error('[Search Blogs] Error:', e);
    return Response.json({ snippets: [], cafes: [], negative_cafes: [] });
  }
}
