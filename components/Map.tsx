'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Cafe } from '@/lib/types';
import SearchBox from './SearchBox';
import Filters from './Filters';
import CorrectionPanel from './CorrectionPanel';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

const LIGHT_STYLE = 'mapbox://styles/miletteriis/cmnal77gg004p01s4cwqed436';
const DARK_STYLE = 'mapbox://styles/mapbox/dark-v11';

function markerColor(cafe: Cafe): string {
  if (cafe.laptop_allowed === true) return '#34a853';
  if (cafe.laptop_allowed === false) return '#ea4335';
  return '#fbbc04';
}

function confidenceBadge(confidence: string, dark: boolean) {
  const muted = dark ? '#888' : '#999';
  switch (confidence) {
    case 'verified':
      return `<span style="color:#16a34a;font-size:13px;font-weight:500">✓ Verified</span> <span style="color:${muted};font-size:12px">via community</span>`;
    case 'inferred':
      return `<span style="color:#d97706;font-size:13px;font-weight:500">~ Likely</span> <span style="color:${muted};font-size:12px">via reviews</span>`;
    default:
      return `<span style="color:${muted};font-size:13px">? Unconfirmed</span>`;
  }
}

function dots(rating: number | null, dark: boolean) {
  if (rating == null) return `<span style="color:${dark ? '#666' : '#999'}">?</span>`;
  const filled = dark ? '#e5e7eb' : '#333';
  const empty = dark ? '#444' : '#ccc';
  return `<span style="letter-spacing:2px;color:${filled}">${'●'.repeat(rating)}<span style="color:${empty}">${'○'.repeat(5 - rating)}</span></span>`;
}

function sourceLabel(confidence: string, dark: boolean) {
  const c = dark ? '#888' : '#999';
  if (confidence === 'verified') return `<span style="color:${c};font-size:11px;margin-left:4px">via community</span>`;
  if (confidence === 'inferred') return `<span style="color:${c};font-size:11px;margin-left:4px">via reviews</span>`;
  return '';
}

function laptopLabel(cafe: Cafe, dark: boolean) {
  if (cafe.laptop_allowed === true) return `<span style="color:#16a34a">✓ Allowed</span>${sourceLabel(cafe.confidence, dark)}`;
  if (cafe.laptop_allowed === false) return `<span style="color:#dc2626">✗ Not allowed</span>${sourceLabel(cafe.confidence, dark)}`;
  return `<span style="color:${dark ? '#666' : '#999'}">? Unknown</span>`;
}

function wifiLabel(cafe: Cafe, dark: boolean) {
  const muted = dark ? '#888' : '#999';
  if (cafe.wifi_rating != null) return `<span style="color:#16a34a">✓ Available</span> <span style="color:${muted};font-size:13px">(${cafe.wifi_rating}/5)</span>${sourceLabel(cafe.confidence, dark)}`;
  return `<span style="color:${dark ? '#666' : '#999'}">? Unknown</span>`;
}

function popupHTML(cafe: Cafe, dark: boolean) {
  const bg = dark ? '#1a1a1a' : '#ffffff';
  const text = dark ? '#e5e7eb' : '#333333';
  const nameColor = dark ? '#fff' : '#1a1a1a';
  const addrColor = dark ? '#999' : '#666';
  const reasonColor = dark ? '#888' : '#666';
  const linkColor = '#1a73e8';
  const btnBg = dark ? '#2a2a2a' : '#f8f8f8';
  const btnBorder = dark ? '#444' : '#e0e0e0';
  const btnText = dark ? '#e5e7eb' : '#333';
  const btnHover = dark ? '#333' : '#f0f0f0';
  const ttBg = dark ? '#111' : '#fff';
  const ttBorder = dark ? '#333' : '#e0e0e0';
  const ttText = dark ? '#e5e7eb' : '#333';
  const ttShadow = dark ? '0 4px 12px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.15)';
  const qBorder = dark ? '#444' : '#ddd';

  const popupBorder = dark ? '1px solid #333333' : '1px solid #e8e8e8';

  return `
    <div style="font-family:system-ui;color:${text};min-width:240px;background:${bg};border:${popupBorder};border-radius:12px;padding:16px">
      ${cafe.photo_url ? `<div style="margin:-16px -16px 12px -16px"><img src="${cafe.photo_url}" alt="" style="width:100%;height:140px;object-fit:cover;border-radius:12px 12px 0 0;display:block" /></div>` : ''}
      <div style="font-weight:700;font-size:16px;margin-bottom:6px;color:${nameColor}">${cafe.name}</div>
      ${cafe.address ? `<div style="font-size:14px;color:${addrColor};margin-bottom:12px;line-height:1.4">${cafe.address}</div>` : ''}
      ${cafe.google_rating != null ? `<div style="font-size:26px;margin-bottom:10px;line-height:1">⭐ ${cafe.google_rating.toFixed(1)}</div>` : ''}
      <div style="font-size:15px;margin-bottom:7px;line-height:1.6">Laptop: ${laptopLabel(cafe, dark)}</div>
      <div style="font-size:15px;margin-bottom:7px;line-height:1.6">WiFi: ${wifiLabel(cafe, dark)}</div>
      <div style="font-size:15px;margin-bottom:10px;line-height:1.6">Seating: ${dots(cafe.seating_rating, dark)}${cafe.seating_rating != null ? sourceLabel(cafe.confidence, dark) : ''}</div>
      <div style="margin-top:12px;margin-bottom:8px">${confidenceBadge(cafe.confidence, dark)}</div>
      ${cafe.enrichment_reason ? `<div style="font-size:12px;color:${reasonColor};font-style:italic;margin-bottom:6px;line-height:1.4">${cafe.enrichment_reason}${cafe.key_review_quote ? ` <span style="cursor:help;color:${dark ? '#666' : '#999'};font-size:11px;border:1px solid ${qBorder};border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;margin-left:6px;vertical-align:middle;position:relative;font-style:normal" onmouseenter="this.querySelector('.tt').style.display='block'" onmouseleave="this.querySelector('.tt').style.display='none'">?<div class="tt" style="display:none;position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:${ttBg};color:${ttText};font-size:11px;padding:8px 10px;border-radius:8px;width:220px;z-index:9999;border:1px solid ${ttBorder};font-style:italic;line-height:1.4;box-shadow:${ttShadow};white-space:normal"><div style="color:${dark ? '#666' : '#999'};font-size:10px;margin-bottom:4px;font-style:normal">Key review:</div>"${cafe.key_review_quote}"</div></span>` : ''}</div>` : ''}
      ${cafe.google_place_id ? `<div style="margin-bottom:8px"><a href="https://www.google.com/maps/place/?q=place_id:${cafe.google_place_id}" target="_blank" rel="noopener noreferrer" tabindex="-1" style="outline:none;text-decoration:none;color:${linkColor};font-size:13px">${cafe.enrichment_reason?.toLowerCase().includes('review') ? '📍 View Google reviews' : '📍 View on Google Maps'}</a></div>` : ''}
      <button
        data-cafe-id="${cafe.id}"
        class="suggest-correction-btn"
        style="width:100%;padding:10px 16px;background:${btnBg};color:${btnText};border:1px solid ${btnBorder};border-radius:12px;cursor:pointer;font-size:13px;font-weight:500;transition:background 0.15s"
        onmouseover="this.style.background='${btnHover}'"
        onmouseout="this.style.background='${btnBg}'"
      >Suggest a correction</button>
    </div>
  `;
}

export default function Map() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<globalThis.Map<string, { marker: mapboxgl.Marker; el: HTMLDivElement; cafe: Cafe }>>(new globalThis.Map());
  const [cafes, setCafes] = useState<Cafe[]>([]);
  const [correctionCafe, setCorrectionCafe] = useState<Cafe | null>(null);
  const [filters, setFilters] = useState({ laptop: false, wifi: false, seating: false });
  const [loadingCafes, setLoadingCafes] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [firstSearchCity, setFirstSearchCity] = useState<string | null>(null);
  const [locationState, setLocationState] = useState<'pending' | 'locating' | 'granted' | 'failed'>('pending');
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const skipNextMoveEnd = useRef(false);
  const pipelineAbortRef = useRef<AbortController | null>(null);

  // Load dark mode preference
  useEffect(() => {
    const saved = localStorage.getItem('nomad-dark-mode');
    if (saved === 'true') setDarkMode(true);
  }, []);

  // Toggle dark mode
  const toggleDarkMode = useCallback(() => {
    setDarkMode(prev => {
      const next = !prev;
      localStorage.setItem('nomad-dark-mode', String(next));
      if (map.current) {
        map.current.setStyle(next ? DARK_STYLE : LIGHT_STYLE);
      }
      // Update popup CSS class on body
      document.body.classList.toggle('nomad-dark', next);
      return next;
    });
  }, []);

  // Re-render markers after style change
  useEffect(() => {
    if (!map.current) return;
    const m = map.current;
    const onStyleLoad = () => {
      // Markers are re-added by the cafes/filters effect
      // Force re-render by setting cafes to a new array reference
      setCafes(prev => [...prev]);
    };
    m.on('style.load', onStyleLoad);
    return () => { m.off('style.load', onStyleLoad); };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const searchCity = useCallback(async (lat: number, lng: number, city?: string) => {
    setLoadingCafes(true);
    setStatusMessage(`📍 Searching ${city || 'this area'}...`);

    pipelineAbortRef.current?.abort();
    const abort = new AbortController();
    pipelineAbortRef.current = abort;

    try {
      const res = await fetch('/api/cafes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, city }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        showToast('Search failed — check console');
        setLoadingCafes(false);
        setStatusMessage(null);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'first_search') setFirstSearchCity(event.city as string);
            else if (event.type === 'status') setStatusMessage(event.message);
            else if (event.type === 'cafes') { setFirstSearchCity(null); setCafes(event.cafes as Cafe[]); }
            else if (event.type === 'error') showToast(event.message || 'Something went wrong');
            else if (event.type === 'complete') setTimeout(() => setStatusMessage(null), 2000);
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') showToast('Network error — check console');
    } finally {
      setLoadingCafes(false);
    }
  }, [showToast]);

  const searchCityRef = useRef(searchCity);
  useEffect(() => { searchCityRef.current = searchCity; }, [searchCity]);

  const flyToAndSearch = useCallback((lng: number, lat: number, city?: string) => {
    if (!map.current) return;
    skipNextMoveEnd.current = true;
    setOverlayDismissed(true);
    map.current.flyTo({ center: [lng, lat], zoom: 14, duration: 1500 });
    searchCityRef.current(lat, lng, city);
  }, []);

  const requestLocation = useCallback(async () => {
    setLocationState('locating');
    try {
      const res = await fetch('/api/geolocate', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || typeof data.lat !== 'number' || typeof data.lng !== 'number') {
        setLocationState('failed');
        return;
      }
      setLocationState('granted');
      setOverlayDismissed(true);
      if (map.current) {
        skipNextMoveEnd.current = true;
        map.current.flyTo({ center: [data.lng, data.lat], zoom: 14, duration: 1500 });
      }
      searchCityRef.current(data.lat, data.lng);
    } catch {
      setLocationState('failed');
    }
  }, []);

  // Initialize map
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    const savedDark = localStorage.getItem('nomad-dark-mode') === 'true';
    if (savedDark) document.body.classList.add('nomad-dark');

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: savedDark ? DARK_STYLE : LIGHT_STYLE,
      center: [0, 20],
      zoom: 2,
    });
    map.current = m;

    m.dragRotate.disable();
    m.touchZoomRotate.disableRotation();
    m.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

    m.on('load', () => {
      requestLocation();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Correction clicks
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('.suggest-correction-btn') as HTMLElement | null;
      if (!btn) return;
      const cafeId = btn.dataset.cafeId;
      const cafe = cafes.find(c => c.id === cafeId);
      if (cafe) setCorrectionCafe(cafe);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [cafes]);

  // Update markers
  useEffect(() => {
    if (!map.current) return;

    markersRef.current.forEach(({ marker }) => marker.remove());
    markersRef.current.clear();

    const filtered = cafes.filter(cafe => {
      if (filters.laptop && cafe.laptop_allowed !== true) return false;
      if (filters.wifi && cafe.wifi_rating == null) return false;
      if (filters.seating && cafe.seating_rating == null) return false;
      return true;
    });

    filtered.forEach(cafe => {
      const el = document.createElement('div');
      el.className = 'cafe-marker';
      el.style.width = '18px';
      el.style.height = '18px';
      el.style.borderRadius = '50%';
      el.style.backgroundColor = markerColor(cafe);
      el.style.border = '2px solid #fff';
      el.style.cursor = 'pointer';
      el.style.boxShadow = `0 0 8px ${markerColor(cafe)}90, 0 1px 3px rgba(0,0,0,0.4)`;
      el.style.transition = 'background-color 0.3s, box-shadow 0.3s';

      const popup = new mapboxgl.Popup({
        offset: 12,
        closeButton: true,
        maxWidth: '320px',
        anchor: 'bottom',
        className: 'nomad-popup',
      }).setHTML(popupHTML(cafe, darkMode));

      const marker = new mapboxgl.Marker(el)
        .setLngLat([cafe.lng, cafe.lat])
        .setPopup(popup)
        .addTo(map.current!);

      el.addEventListener('click', () => {
        map.current?.panTo([cafe.lng, cafe.lat], { offset: [0, 150] });
      });

      markersRef.current.set(cafe.id, { marker, el, cafe });
    });
  }, [cafes, filters, darkMode]);

  const handleSearch = (lng: number, lat: number, cityName: string) => {
    flyToAndSearch(lng, lat, cityName);
  };

  const handleMyLocation = async () => {
    try {
      const res = await fetch('/api/geolocate', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || typeof data.lat !== 'number' || typeof data.lng !== 'number') {
        showToast('Location unavailable — try searching instead');
        return;
      }
      setLocationState('granted');
      setOverlayDismissed(true);
      if (map.current) {
        skipNextMoveEnd.current = true;
        map.current.flyTo({ center: [data.lng, data.lat], zoom: 14, duration: 1500 });
      }
      searchCityRef.current(data.lat, data.lng);
    } catch {
      showToast('Location unavailable — try searching instead');
    }
  };

  const showSearchOverlay = locationState === 'failed' && cafes.length === 0 && !overlayDismissed;

  // Theme-aware colors
  const d = darkMode;
  const cardBg = d ? '#1a1a1a' : '#fff';
  const cardText = d ? '#e5e7eb' : '#333';
  const cardTextMuted = d ? '#888' : '#5f6368';
  const cardTextFaint = d ? '#666' : '#80868b';
  const cardBorder = d ? '1px solid #333' : 'none';
  const cardShadow = '0 2px 6px rgba(0,0,0,0.3)';
  const pillBg = d ? '#1a1a1a' : '#fff';
  const pillText = d ? '#e5e7eb' : '#333';
  const pillTextMuted = d ? '#888' : '#5f6368';
  const btnBg = d ? '#1a1a1a' : '#fff';
  const btnText = d ? '#e5e7eb' : '#333';
  const btnBorder = d ? '1px solid #333' : 'none';

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Search box */}
      <div className="absolute z-30" style={{ top: 10, left: 10 }}>
        <SearchBox
          onSelect={handleSearch}
          onTyping={() => setOverlayDismissed(true)}
          loading={loadingCafes}
          dark={darkMode}
        />
      </div>

      {/* Top-right button group: [🌙] [📍 My location] */}
      <div className="absolute z-20" style={{ top: 10, right: 10, display: 'flex', gap: 8 }}>
        <button
          onClick={toggleDarkMode}
          className="cursor-pointer"
          style={{ height: 46, borderRadius: 8, boxShadow: cardShadow, border: btnBorder, background: btnBg, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 0 }}
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <div style={{ width: 52, height: 28, borderRadius: 14, background: darkMode ? '#333' : '#e0e0e0', position: 'relative', transition: 'background 0.25s', flexShrink: 0 }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: darkMode ? 27 : 3, transition: 'left 0.25s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
              {darkMode ? '🌙' : '☀️'}
            </div>
          </div>
        </button>
        <button
          onClick={handleMyLocation}
          className="transition-colors cursor-pointer"
          style={{ height: 46, padding: '0 16px', borderRadius: 8, boxShadow: cardShadow, border: btnBorder, background: btnBg, color: btnText, fontSize: 16 }}
          title="Go to my location"
        >
        📍 My location
        </button>
      </div>

      {/* First search overlay */}
      {firstSearchCity && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="text-center pointer-events-auto animate-fade-in" style={{ background: cardBg, borderRadius: 12, padding: '40px 48px', maxWidth: 480, boxShadow: cardShadow, border: cardBorder }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <p style={{ fontSize: 22, fontWeight: 700, color: cardText, marginBottom: 12 }}>
              You&apos;re the first to search {firstSearchCity}!
            </p>
            <p style={{ fontSize: 16, color: cardTextMuted, lineHeight: 1.6 }}>
              Sit tight while we find the best work cafés — this takes a minute but you&apos;re making it faster for everyone who comes after you ☕
            </p>
            {statusMessage && (
              <p style={{ fontSize: 14, color: cardTextFaint, marginTop: 20 }} className="animate-fade-in">{statusMessage}</p>
            )}
          </div>
        </div>
      )}

      {/* Status bar */}
      {statusMessage && !firstSearchCity && (
        <div className="absolute left-1/2 -translate-x-1/2 z-20 animate-fade-in whitespace-nowrap" style={{ top: 66, background: pillBg, borderRadius: 20, padding: '10px 20px', fontSize: 14, fontWeight: 500, color: pillText, boxShadow: cardShadow, border: cardBorder }}>
          {statusMessage}
        </div>
      )}

      {/* Location toast */}
      {locationState === 'locating' && !statusMessage && (
        <div className="absolute left-1/2 -translate-x-1/2 z-20 animate-fade-in" style={{ top: 66, background: pillBg, borderRadius: 20, padding: '10px 20px', fontSize: 14, fontWeight: 500, color: pillTextMuted, boxShadow: cardShadow, border: cardBorder }}>
          📍 Finding your location...
        </div>
      )}

      {/* Search prompt */}
      {showSearchOverlay && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="text-center pointer-events-auto animate-fade-in" style={{ background: cardBg, borderRadius: 12, padding: '32px 40px', boxShadow: cardShadow, border: cardBorder }}>
            <p style={{ fontSize: 20, fontWeight: 600, color: cardText }}>Search a city above to find work-friendly cafés 🔍</p>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-16 right-4 z-30 animate-fade-in" style={{ background: cardBg, borderRadius: 8, padding: '12px 20px', fontSize: 14, color: cardText, boxShadow: cardShadow, border: cardBorder }}>
          {toast}
        </div>
      )}

      {/* Filter toolbar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
        <Filters filters={filters} onChange={setFilters} dark={darkMode} />
      </div>

      {correctionCafe && (
        <CorrectionPanel
          cafe={correctionCafe}
          darkMode={darkMode}
          onClose={() => setCorrectionCafe(null)}
          onSubmitted={() => {
            setCorrectionCafe(null);
            if (map.current) {
              const center = map.current.getCenter();
              searchCityRef.current(center.lat, center.lng);
            }
          }}
        />
      )}
    </div>
  );
}
