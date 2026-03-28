'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Cafe } from '@/lib/types';
import SearchBox from './SearchBox';
import Filters from './Filters';
import CorrectionPanel from './CorrectionPanel';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

function markerColor(cafe: Cafe): string {
  if (cafe.laptop_allowed === true) return '#22c55e';
  if (cafe.laptop_allowed === false) return '#ef4444';
  return '#eab308';
}

function confidenceBadge(confidence: string) {
  switch (confidence) {
    case 'verified':
      return '<span style="color:#22c55e;font-size:11px">✓ Verified</span> <span style="color:#6b7280;font-size:10px">via community</span>';
    case 'inferred':
      return '<span style="color:#eab308;font-size:11px">~ Likely</span> <span style="color:#6b7280;font-size:10px">via reviews</span>';
    default:
      return '<span style="color:#9ca3af;font-size:11px">? Unconfirmed</span>';
  }
}

function dots(rating: number | null) {
  if (rating == null) return '<span style="color:#6b7280">?</span>';
  return '<span style="letter-spacing:2px">' + '●'.repeat(rating) + '○'.repeat(5 - rating) + '</span>';
}

function sourceLabel(confidence: string) {
  if (confidence === 'verified') return '<span style="color:#6b7280;font-size:10px;margin-left:4px">via community</span>';
  if (confidence === 'inferred') return '<span style="color:#6b7280;font-size:10px;margin-left:4px">via reviews</span>';
  return '';
}

function laptopLabel(cafe: Cafe) {
  if (cafe.laptop_allowed === true) return `<span style="color:#22c55e">✓ Allowed</span>${sourceLabel(cafe.confidence)}`;
  if (cafe.laptop_allowed === false) return `<span style="color:#ef4444">✗ Not allowed</span>${sourceLabel(cafe.confidence)}`;
  return '<span style="color:#9ca3af">? Unknown</span>';
}

function wifiLabel(cafe: Cafe) {
  if (cafe.wifi_rating != null) return `<span style="color:#22c55e">✓ Available</span> <span style="color:#9ca3af;font-size:11px">(${cafe.wifi_rating}/5)</span>${sourceLabel(cafe.confidence)}`;
  return '<span style="color:#9ca3af">? Unknown</span>';
}

function popupHTML(cafe: Cafe) {
  return `
    <div style="font-family:system-ui;color:#e5e7eb;min-width:200px">
      <div style="font-weight:600;font-size:15px;margin-bottom:6px;color:#fff">${cafe.name}</div>
      ${cafe.address ? `<div style="font-size:12px;color:#9ca3af;margin-bottom:8px">${cafe.address}</div>` : ''}
      ${cafe.google_rating != null ? `<div style="font-size:18px;margin-bottom:6px">⭐ ${cafe.google_rating.toFixed(1)}</div>` : ''}
      <div style="font-size:13px;margin-bottom:4px">Laptop: ${laptopLabel(cafe)}</div>
      <div style="font-size:13px;margin-bottom:4px">WiFi: ${wifiLabel(cafe)}</div>
      <div style="font-size:13px;margin-bottom:4px">Seating: ${dots(cafe.seating_rating)}${cafe.seating_rating != null ? sourceLabel(cafe.confidence) : ''}</div>
      <div style="margin-bottom:4px">${confidenceBadge(cafe.confidence)}</div>
      ${cafe.enrichment_reason ? `<div style="font-size:11px;color:#6b7280;font-style:italic;margin-bottom:4px">${cafe.enrichment_reason}</div>` : ''}
      ${cafe.blog_sources && cafe.blog_sources.length > 0 ? `<div style="margin-bottom:4px"><a href="${cafe.blog_sources[0]}" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:#60a5fa;text-decoration:none">📰 Source</a></div>` : ''}
      ${cafe.work_summary ? `<div style="font-size:12px;color:#9ca3af;font-style:italic;margin-bottom:8px">${cafe.work_summary}</div>` : '<div style="margin-bottom:4px"></div>'}
      <button
        data-cafe-id="${cafe.id}"
        class="suggest-correction-btn"
        style="width:100%;padding:6px 12px;background:#374151;color:#e5e7eb;border:1px solid #4b5563;border-radius:6px;cursor:pointer;font-size:12px;transition:background 0.15s"
        onmouseover="this.style.background='#4b5563'"
        onmouseout="this.style.background='#374151'"
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
  const skipNextMoveEnd = useRef(false);
  const pipelineAbortRef = useRef<AbortController | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Main pipeline — SSE stream from /api/cafes
  const searchCity = useCallback(async (lat: number, lng: number, city?: string) => {
    console.log('[Map] searchCity —', city || 'unknown', 'at', lat, lng);
    setLoadingCafes(true);
    setStatusMessage(`📍 Searching ${city || 'this area'}...`);

    // Abort any previous pipeline
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
        console.error('[Map] Pipeline SSE error:', res.status);
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

            if (event.type === 'first_search') {
              console.log('[Map] First search for city:', event.city);
              setFirstSearchCity(event.city as string);
            } else if (event.type === 'status') {
              console.log('[Map] Status:', event.message);
              setStatusMessage(event.message);
            } else if (event.type === 'cafes') {
              console.log('[Map] Received', event.cafes.length, 'cafés', event.cached ? '(cached)' : '(fresh)');
              setFirstSearchCity(null); // Dismiss first-search overlay
              setCafes(event.cafes as Cafe[]);
            } else if (event.type === 'error') {
              console.error('[Map] Pipeline error:', event.message);
              showToast(event.message || 'Something went wrong');
            } else if (event.type === 'complete') {
              console.log('[Map] Pipeline complete');
              setTimeout(() => setStatusMessage(null), 2000);
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        console.error('[Map] Pipeline fetch error:', e);
        showToast('Network error — check console');
      }
    } finally {
      setLoadingCafes(false);
    }
  }, [showToast]);

  // Ref so map init effect can call the latest version
  const searchCityRef = useRef(searchCity);
  useEffect(() => { searchCityRef.current = searchCity; }, [searchCity]);

  const flyToAndSearch = useCallback((lng: number, lat: number, city?: string) => {
    if (!map.current) return;
    skipNextMoveEnd.current = true;
    setOverlayDismissed(true);
    map.current.flyTo({ center: [lng, lat], zoom: 14, duration: 1500 });
    searchCityRef.current(lat, lng, city);
  }, []);

  // Geolocation via Google API
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
      // No city name from geolocate — the server will reverse geocode
      searchCityRef.current(data.lat, data.lng);
    } catch {
      setLocationState('failed');
    }
  }, []);

  // Initialize map
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [0, 20],
      zoom: 2,
    });
    map.current = m;

    m.dragRotate.disable();
    m.touchZoomRotate.disableRotation();
    m.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

    // No moveend auto-fetch — the new pipeline is city-based, not pan-based
    m.on('load', () => {
      requestLocation();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle correction button clicks
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
      el.style.width = '14px';
      el.style.height = '14px';
      el.style.borderRadius = '50%';
      el.style.backgroundColor = markerColor(cafe);
      el.style.border = '2px solid rgba(0,0,0,0.3)';
      el.style.cursor = 'pointer';
      el.style.boxShadow = `0 0 6px ${markerColor(cafe)}80`;
      el.style.transition = 'background-color 0.3s, box-shadow 0.3s';

      const popup = new mapboxgl.Popup({
        offset: 12,
        closeButton: true,
        maxWidth: '280px',
      }).setHTML(popupHTML(cafe));

      const marker = new mapboxgl.Marker(el)
        .setLngLat([cafe.lng, cafe.lat])
        .setPopup(popup)
        .addTo(map.current!);

      markersRef.current.set(cafe.id, { marker, el, cafe });
    });
  }, [cafes, filters]);

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

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Search box — top left */}
      <div className="absolute top-4 left-4 z-30">
        <SearchBox
          onSelect={handleSearch}
          onTyping={() => setOverlayDismissed(true)}
          loading={loadingCafes}
        />
      </div>

      {/* My location button — top right */}
      <button
        onClick={handleMyLocation}
        className="absolute top-4 right-4 z-20 px-3 py-2.5 rounded-xl bg-black/60 backdrop-blur-xl text-sm text-gray-300 hover:text-white border border-white/10 hover:border-white/25 transition-all shadow-lg cursor-pointer"
        title="Go to my location"
      >
        📍 My location
      </button>

      {/* First search overlay — prominent card */}
      {firstSearchCity && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="text-center px-8 py-10 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl pointer-events-auto animate-fade-in max-w-md">
            <div className="text-4xl mb-4">🎉</div>
            <p className="text-white font-semibold text-lg mb-2">
              You&apos;re the first person to search {firstSearchCity} on Nomad!
            </p>
            <p className="text-gray-400 text-sm leading-relaxed">
              Sit tight while we find the best work cafés — this takes a minute but you&apos;re making it faster for everyone who comes after you ☕
            </p>
            {statusMessage && (
              <p className="text-gray-300 text-xs mt-4 animate-fade-in">{statusMessage}</p>
            )}
          </div>
        </div>
      )}

      {/* Status bar — top center (hidden when first-search overlay is showing) */}
      {statusMessage && !firstSearchCity && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 px-5 py-2.5 rounded-xl bg-black/70 backdrop-blur-xl border border-white/10 text-sm text-gray-200 shadow-lg animate-fade-in whitespace-nowrap">
          {statusMessage}
        </div>
      )}

      {/* Location status toast — only while locating */}
      {locationState === 'locating' && !statusMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 px-5 py-3 rounded-xl bg-black/70 backdrop-blur-xl border border-white/10 text-sm text-gray-300 shadow-lg animate-fade-in">
          📍 Finding your location...
        </div>
      )}

      {/* Search prompt overlay */}
      {showSearchOverlay && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="text-center px-6 py-8 rounded-2xl bg-black/50 backdrop-blur-xl border border-white/10 shadow-2xl pointer-events-auto animate-fade-in">
            <p className="text-white font-medium text-lg">Search a city above to find work-friendly cafés 🔍</p>
          </div>
        </div>
      )}

      {/* Toast notification — bottom right */}
      {toast && (
        <div className="absolute bottom-16 right-4 z-30 px-4 py-2.5 rounded-xl bg-black/80 backdrop-blur-xl border border-white/10 text-sm text-gray-300 shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* Filter toolbar — bottom center */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
        <Filters filters={filters} onChange={setFilters} />
      </div>

      {correctionCafe && (
        <CorrectionPanel
          cafe={correctionCafe}
          onClose={() => setCorrectionCafe(null)}
          onSubmitted={() => {
            setCorrectionCafe(null);
            // Re-search current area
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
