import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const STATS_PASSWORD = process.env.STATS_PASSWORD || 'nomadstats2026';

function PasswordForm() {
  return (
    <div style={{ background: '#111', color: '#fff', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <form method="GET" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 24, marginBottom: 16 }}>🔒 Nomad Stats</h1>
        <input name="password" type="password" placeholder="Password" style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #333', background: '#222', color: '#fff', fontSize: 16, width: 240 }} />
        <br />
        <button type="submit" style={{ marginTop: 12, padding: '10px 24px', borderRadius: 8, background: '#1a73e8', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14 }}>Enter</button>
      </form>
    </div>
  );
}

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ password?: string }> }) {
  const params = await searchParams;
  if (params.password !== STATS_PASSWORD) {
    return <PasswordForm />;
  }

  // Fetch counts
  const [
    { count: totalSearches },
    { count: totalCafeSearches },
    { count: totalCorrections },
    { data: recentActivity },
  ] = await Promise.all([
    supabase.from('analytics_events').select('*', { count: 'exact', head: true }).eq('event_type', 'city_search'),
    supabase.from('analytics_events').select('*', { count: 'exact', head: true }).eq('event_type', 'cafe_search'),
    supabase.from('analytics_events').select('*', { count: 'exact', head: true }).eq('event_type', 'correction_submitted'),
    supabase.from('analytics_events').select('event_type, city_name, created_at, metadata').order('created_at', { ascending: false }).limit(20),
  ]);

  // Top cities
  const { data: cityRows } = await supabase.from('analytics_events')
    .select('city_name, created_at')
    .eq('event_type', 'city_search')
    .not('city_name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);

  const cityMap = new Map<string, { count: number; last: string }>();
  for (const row of cityRows || []) {
    const e = cityMap.get(row.city_name);
    if (e) { e.count++; if (row.created_at > e.last) e.last = row.created_at; }
    else cityMap.set(row.city_name, { count: 1, last: row.created_at });
  }
  const topCitiesData = Array.from(cityMap.entries())
    .map(([city_name, { count, last }]) => ({ city_name, searches: count, last_searched: last }))
    .sort((a, b) => b.searches - a.searches)
    .slice(0, 20);
  const uniqueCityCount = cityMap.size;

  // Daily activity
  const { data: allEvents } = await supabase.from('analytics_events')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1000);

  const dayMap = new Map<string, number>();
  for (const row of allEvents || []) {
    const date = row.created_at.substring(0, 10);
    dayMap.set(date, (dayMap.get(date) || 0) + 1);
  }
  const dailyData = Array.from(dayMap.entries())
    .map(([date, searches]) => ({ date, searches }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);

  // Top café queries
  const { data: cafeEvents } = await supabase.from('analytics_events')
    .select('metadata')
    .eq('event_type', 'cafe_search')
    .order('created_at', { ascending: false })
    .limit(200);

  const qMap = new Map<string, number>();
  for (const row of cafeEvents || []) {
    const q = (row.metadata as Record<string, unknown>)?.query as string;
    if (q) qMap.set(q, (qMap.get(q) || 0) + 1);
  }
  const cafeQueryData = Array.from(qMap.entries())
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const s = {
    page: { background: '#111', color: '#e5e7eb', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '24px 16px' } as React.CSSProperties,
    container: { maxWidth: 900, margin: '0 auto' } as React.CSSProperties,
    h1: { fontSize: 28, fontWeight: 700, color: '#fff', marginBottom: 4 } as React.CSSProperties,
    sub: { fontSize: 13, color: '#666', marginBottom: 32 } as React.CSSProperties,
    cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 32 } as React.CSSProperties,
    card: { background: '#1a1a1a', borderRadius: 12, padding: 20, border: '1px solid #333' } as React.CSSProperties,
    cardNum: { fontSize: 32, fontWeight: 700, color: '#fff' } as React.CSSProperties,
    cardLabel: { fontSize: 13, color: '#888', marginTop: 4 } as React.CSSProperties,
    section: { marginBottom: 32 } as React.CSSProperties,
    sectionTitle: { fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 12 } as React.CSSProperties,
    table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 14 } as React.CSSProperties,
    th: { textAlign: 'left' as const, padding: '8px 12px', borderBottom: '1px solid #333', color: '#888', fontWeight: 500, fontSize: 12, textTransform: 'uppercase' as const } as React.CSSProperties,
    td: { padding: '8px 12px', borderBottom: '1px solid #222', color: '#ccc' } as React.CSSProperties,
    badge: (type: string) => ({
      display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
      background: type === 'city_search' ? '#1a3a5c' : type === 'cafe_search' ? '#3a1a5c' : '#1a5c3a',
      color: type === 'city_search' ? '#5b9bd5' : type === 'cafe_search' ? '#b55bd5' : '#5bd55b',
    } as React.CSSProperties),
  };

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return d; }
  };

  return (
    <div style={s.page}>
      <div style={s.container}>
        <h1 style={s.h1}>☕ Nomad Stats</h1>
        <p style={s.sub}>Last updated: {new Date().toLocaleString('en-GB')}</p>

        <div style={s.cards}>
          <div style={s.card}><div style={s.cardNum}>{totalSearches ?? 0}</div><div style={s.cardLabel}>City searches</div></div>
          <div style={s.card}><div style={s.cardNum}>{uniqueCityCount}</div><div style={s.cardLabel}>Unique cities</div></div>
          <div style={s.card}><div style={s.cardNum}>{totalCafeSearches ?? 0}</div><div style={s.cardLabel}>Café lookups</div></div>
          <div style={s.card}><div style={s.cardNum}>{totalCorrections ?? 0}</div><div style={s.cardLabel}>Corrections</div></div>
        </div>

        {topCitiesData && topCitiesData.length > 0 && (
          <div style={s.section}>
            <h2 style={s.sectionTitle}>Top Cities</h2>
            <table style={s.table}>
              <thead><tr><th style={s.th}>City</th><th style={s.th}>Searches</th><th style={s.th}>Last searched</th></tr></thead>
              <tbody>
                {topCitiesData.map((row, i) => (
                  <tr key={i}><td style={s.td}>{row.city_name}</td><td style={s.td}>{row.searches}</td><td style={s.td}>{formatDate(row.last_searched)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {dailyData && dailyData.length > 0 && (
          <div style={s.section}>
            <h2 style={s.sectionTitle}>Daily Activity (last 30 days)</h2>
            <table style={s.table}>
              <thead><tr><th style={s.th}>Date</th><th style={s.th}>Events</th><th style={s.th}>Bar</th></tr></thead>
              <tbody>
                {dailyData.map((row, i) => {
                  const max = Math.max(...dailyData!.map(r => r.searches));
                  const pct = max > 0 ? (row.searches / max) * 100 : 0;
                  return (
                    <tr key={i}>
                      <td style={s.td}>{row.date}</td>
                      <td style={s.td}>{row.searches}</td>
                      <td style={s.td}><div style={{ background: '#1a73e8', height: 8, borderRadius: 4, width: `${pct}%`, minWidth: 4 }} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {cafeQueryData && cafeQueryData.length > 0 && (
          <div style={s.section}>
            <h2 style={s.sectionTitle}>Top Café Searches</h2>
            <table style={s.table}>
              <thead><tr><th style={s.th}>Query</th><th style={s.th}>Count</th></tr></thead>
              <tbody>
                {cafeQueryData.map((row, i) => (
                  <tr key={i}><td style={s.td}>{row.query}</td><td style={s.td}>{row.count}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={s.section}>
          <h2 style={s.sectionTitle}>Recent Activity</h2>
          <table style={s.table}>
            <thead><tr><th style={s.th}>Type</th><th style={s.th}>City</th><th style={s.th}>Time</th><th style={s.th}>Details</th></tr></thead>
            <tbody>
              {(recentActivity || []).map((row, i) => (
                <tr key={i}>
                  <td style={s.td}><span style={s.badge(row.event_type)}>{row.event_type.replace('_', ' ')}</span></td>
                  <td style={s.td}>{row.city_name || '—'}</td>
                  <td style={s.td}>{formatDate(row.created_at)}</td>
                  <td style={{ ...s.td, fontSize: 12, color: '#666', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{JSON.stringify(row.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
