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
  dark,
}: {
  onSelect: (lng: number, lat: number, cityName: string) => void;
  onTyping?: () => void;
  loading?: boolean;
  dark?: boolean;
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

  const bg = dark ? '#1a1a1a' : '#fff';
  const text = dark ? '#fff' : '#333';
  const placeholder = dark ? '#888' : undefined;
  const border = dark ? '1px solid #333' : 'none';
  const spinnerBorder = dark ? 'border-gray-600 border-t-blue-400' : 'border-gray-300 border-t-blue-500';
  const iconColor = dark ? '#888' : undefined;
  const dropdownBg = dark ? '#1a1a1a' : '#fff';
  const hoverBg = dark ? '#2a2a2a' : '#f5f5f5';
  const divider = dark ? '#333' : '#f0f0f0';
  const primaryColor = dark ? '#fff' : '#202124';
  const secondaryColor = dark ? '#888' : '#666';

  return (
    <div ref={containerRef} className="relative" style={{ width: 400 }}>
      <div className="relative" style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.3)', borderRadius: 8, border }}>
        <div className="absolute top-1/2 -translate-y-1/2" style={{ left: 12, color: iconColor }}>
          {loading ? (
            <div className={`w-5 h-5 border-2 ${spinnerBorder} rounded-full animate-spin`} />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          )}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Search a city..."
          style={{ height: 46, borderRadius: 8, paddingLeft: 40, background: bg, color: text, border: 'none' }}
          className={`w-full pr-4 outline-none text-base ${dark ? 'placeholder-gray-500' : 'placeholder-gray-400'}`}
        />
      </div>
      {open && results.length > 0 && (
        <ul className="absolute top-full mt-1 w-full overflow-hidden z-50" style={{ borderRadius: 8, boxShadow: '0 2px 6px rgba(0,0,0,0.3)', background: dropdownBg, border }}>
          {results.map((r, i) => {
            const commaIdx = r.place_name.indexOf(',');
            const primary = commaIdx > -1 ? r.place_name.substring(0, commaIdx) : r.place_name;
            const secondary = commaIdx > -1 ? r.place_name.substring(commaIdx + 1).trim() : null;
            return (
              <li key={r.id}>
                <button
                  onClick={() => select(r)}
                  className="w-full text-left transition-colors"
                  style={{
                    padding: '14px 20px',
                    borderBottom: i < results.length - 1 ? `1px solid ${divider}` : 'none',
                    background: 'transparent',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ fontSize: 15, fontWeight: 500, color: primaryColor }}>{primary}</div>
                  {secondary && <div style={{ fontSize: 13, color: secondaryColor, marginTop: 2 }}>{secondary}</div>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
