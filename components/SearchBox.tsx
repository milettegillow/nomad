'use client';

import { useState, useRef, useEffect } from 'react';

interface SearchResult {
  id: string;
  place_name: string;
  text: string; // city/place name only
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
    <div ref={containerRef} className="relative" style={{ minWidth: 300 }}>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Search a city or neighborhood…"
          className="w-full px-4 py-2.5 pr-10 rounded-xl bg-black/60 backdrop-blur-xl text-white placeholder-gray-500 border border-white/10 outline-none focus:border-white/25 text-sm transition-colors shadow-lg"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
          </div>
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute top-full mt-1.5 w-full bg-black/85 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden z-50 shadow-2xl">
          {results.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => select(r)}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-200 hover:bg-white/10 transition-colors"
              >
                {r.place_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
