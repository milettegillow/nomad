'use client';

import { useState, useRef, useEffect } from 'react';

interface CityResult {
  type: 'city';
  id: string;
  place_name: string;
  text: string;
  center: [number, number];
}

interface CafeResult {
  type: 'cafe';
  id: string | null;
  place_id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  photo_name: string | null;
}

type SearchItem = CityResult | CafeResult;

export default function SearchBox({
  onSelectCity,
  onSelectCafe,
  onTyping,
  loading,
  dark,
  mapCenter,
}: {
  onSelectCity: (lng: number, lat: number, cityName: string) => void;
  onSelectCafe: (lat: number, lng: number, placeId: string, name: string, rating: number | null, address: string | null, photoName: string | null, dbId: string | null) => void;
  onTyping?: () => void;
  loading?: boolean;
  dark?: boolean;
  mapCenter?: { lat: number; lng: number } | null;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SearchItem[]>([]);
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
      setItems([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      const [cityRes, cafeRes] = await Promise.all([
        fetchCities(q),
        fetchCafes(q),
      ]);
      // Merge: cities first, then cafés, max 6 total
      const merged: SearchItem[] = [...cityRes.slice(0, 3), ...cafeRes.slice(0, 3)].slice(0, 6);
      setItems(merged);
      setOpen(merged.length > 0);
    }, 250);
  };

  const fetchCities = async (q: string): Promise<CityResult[]> => {
    try {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&limit=3&types=place,locality,neighborhood`
      );
      const data = await res.json();
      return (data.features || []).map((f: { id: string; place_name: string; text: string; center: [number, number] }) => ({
        type: 'city' as const,
        id: f.id,
        place_name: f.place_name,
        text: f.text,
        center: f.center,
      }));
    } catch {
      return [];
    }
  };

  const fetchCafes = async (q: string): Promise<CafeResult[]> => {
    try {
      const locParam = mapCenter ? `&lat=${mapCenter.lat}&lng=${mapCenter.lng}` : '';
      const res = await fetch(`/api/search-place?q=${encodeURIComponent(q)}${locParam}`);
      const data = await res.json();
      return (data.results || []).map((r: { id: string | null; place_id: string; name: string; address: string | null; lat: number; lng: number; rating: number | null; photo_name: string | null }) => ({
        type: 'cafe' as const,
        ...r,
      }));
    } catch {
      return [];
    }
  };

  const selectItem = (item: SearchItem) => {
    if (item.type === 'city') {
      setQuery(item.place_name);
      onSelectCity(item.center[0], item.center[1], item.text);
    } else {
      setQuery(item.name);
      onSelectCafe(item.lat, item.lng, item.place_id, item.name, item.rating, item.address, item.photo_name, item.id);
    }
    setOpen(false);
    setItems([]);
  };

  const d = dark;
  const bg = d ? '#1a1a1a' : '#fff';
  const text = d ? '#fff' : '#333';
  const border = d ? '1px solid #333' : 'none';
  const spinnerBorder = d ? 'border-gray-600 border-t-blue-400' : 'border-gray-300 border-t-blue-500';
  const iconColor = d ? '#888' : undefined;
  const dropdownBg = d ? '#1a1a1a' : '#fff';
  const hoverBg = d ? '#2a2a2a' : '#f5f5f5';
  const dividerColor = d ? '#333' : '#f0f0f0';
  const primaryColor = d ? '#fff' : '#202124';
  const secondaryColor = d ? '#888' : '#666';

  return (
    <div ref={containerRef} className="relative" style={{ width: 400, maxWidth: 'calc(100vw - 24px)' }}>
      <div className="relative" style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.3)', borderRadius: 8, border }}>
        <div className="absolute top-1/2 -translate-y-1/2" style={{ left: 12, color: iconColor }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Search a city or café..."
          style={{ height: 46, borderRadius: 8, paddingLeft: 40, background: bg, color: text, border: 'none' }}
          className={`w-full pr-4 outline-none text-base ${d ? 'placeholder-gray-500' : 'placeholder-gray-400'}`}
        />
      </div>
      {open && items.length > 0 && (
        <ul className="absolute top-full mt-1 w-full overflow-hidden z-50" style={{ borderRadius: 8, boxShadow: '0 2px 6px rgba(0,0,0,0.3)', background: dropdownBg, border }}>
          {items.map((item, i) => {
            const isCity = item.type === 'city';
            const icon = isCity ? '📍' : '☕';
            let primary: string;
            let secondary: string | null;

            if (isCity) {
              const commaIdx = item.place_name.indexOf(',');
              primary = commaIdx > -1 ? item.place_name.substring(0, commaIdx) : item.place_name;
              secondary = commaIdx > -1 ? item.place_name.substring(commaIdx + 1).trim() : null;
            } else {
              primary = item.name + (item.rating != null ? ` ⭐ ${item.rating}` : '');
              secondary = item.address;
            }

            return (
              <li key={isCity ? item.id : item.place_id}>
                <button
                  onClick={() => selectItem(item)}
                  className="w-full text-left transition-colors"
                  style={{
                    padding: '12px 20px',
                    borderBottom: i < items.length - 1 ? `1px solid ${dividerColor}` : 'none',
                    background: 'transparent',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ fontSize: 15, fontWeight: 500, color: primaryColor }}>
                    <span style={{ marginRight: 8 }}>{icon}</span>{primary}
                  </div>
                  {secondary && <div style={{ fontSize: 13, color: secondaryColor, marginTop: 2, paddingLeft: 26 }}>{secondary}</div>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
