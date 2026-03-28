'use client';

import { useState, useRef, useEffect } from 'react';

interface SearchResult {
  id: string;
  place_name: string;
  text: string;
  center: [number, number];
}

export default function SearchBox({
  onSelect,
  onTyping,
  loading,
}: {
  onSelect: (lng: number, lat: number, cityName: string) => void;
  onTyping?: () => void;
  loading?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = (q: string) => {
    setQuery(q);
    if (q.trim()) onTyping?.();
    clearTimeout(timerRef.current);
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&limit=8&types=place,locality,neighborhood`
      );
      const data = await res.json();
      if (data.features) {
        setResults(
          data.features.map((f: { id: string; place_name: string; text: string; center: [number, number] }) => ({
            id: f.id,
            place_name: f.place_name,
            text: f.text,
            center: f.center,
          }))
        );
        setOpen(true);
      }
    }, 200);
  };

  const select = (result: SearchResult) => {
    setQuery(result.place_name);
    setOpen(false);
    setResults([]);
    onSelect(result.center[0], result.center[1], result.text);
  };

  return (
    <div ref={containerRef} className="relative" style={{ width: 400 }}>
      <div className="relative" style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.3)', borderRadius: 8 }}>
        <div className="absolute top-1/2 -translate-y-1/2 text-gray-400" style={{ left: 12 }}>
          {loading ? (
            <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          )}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Search a city..."
          style={{ height: 46, borderRadius: 8, paddingLeft: 40 }}
          className="w-full pr-4 bg-white text-gray-800 placeholder-gray-400 border-none outline-none text-base"
        />
      </div>
      {open && results.length > 0 && (
        <ul className="absolute top-full mt-1 w-full bg-white overflow-hidden z-50" style={{ borderRadius: 8, boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>
          {results.map((r, i) => {
            const commaIdx = r.place_name.indexOf(',');
            const primary = commaIdx > -1 ? r.place_name.substring(0, commaIdx) : r.place_name;
            const secondary = commaIdx > -1 ? r.place_name.substring(commaIdx + 1).trim() : null;
            return (
              <li key={r.id}>
                <button
                  onClick={() => select(r)}
                  className="w-full text-left hover:bg-gray-100 transition-colors"
                  style={{
                    padding: '14px 20px',
                    borderBottom: i < results.length - 1 ? '1px solid #f0f0f0' : 'none',
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 500, color: '#202124' }}>{primary}</div>
                  {secondary && <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>{secondary}</div>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
