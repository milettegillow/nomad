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
  if (cafe.laptop_allowed === true) return '#34a853';
  if (cafe.laptop_allowed === false) return '#ea4335';
  return '#fbbc04';
}

function confidenceBadge(confidence: string) {
  switch (confidence) {
    case 'verified':
      return '<span style="color:#34a853;font-size:13px;font-weight:500">✓ Verified</span> <span style="color:#6b7280;font-size:12px">via community</span>';
    case 'inferred':
      return '<span style="color:#fbbc04;font-size:13px;font-weight:500">~ Likely</span> <span style="color:#6b7280;font-size:12px">via reviews</span>';
    default:
      return '<span style="color:#9ca3af;font-size:13px">? Unconfirmed</span>';
  }
}

function dots(rating: number | null) {
  if (rating == null) return '<span style="color:#6b7280">?</span>';
  return '<span style="letter-spacing:2px">' + '●'.repeat(rating) + '○'.repeat(5 - rating) + '</span>';
}

function sourceLabel(confidence: string) {
  if (confidence === 'verified') return '<span style="color:#6b7280;font-size:11px;margin-left:4px">via community</span>';
  if (confidence === 'inferred') return '<span style="color:#6b7280;font-size:11px;margin-left:4px">via reviews</span>';
  return '';
}

function laptopLabel(cafe: Cafe) {
  if (cafe.laptop_allowed === true) return `<span style="color:#34a853">✓ Allowed</span>${sourceLabel(cafe.confidence)}`;
  if (cafe.laptop_allowed === false) return `<span style="color:#ea4335">✗ Not allowed</span>${sourceLabel(cafe.confidence)}`;
  return '<span style="color:#9ca3af">? Unknown</span>';
}

function wifiLabel(cafe: Cafe) {
  if (cafe.wifi_rating != null) return `<span style="color:#34a853">✓ Available</span> <span style="color:#9ca3af;font-size:13px">(${cafe.wifi_rating}/5)</span>${sourceLabel(cafe.confidence)}`;
  return '<span style="color:#9ca3af">? Unknown</span>';
}

function popupHTML(cafe: Cafe) {
  return `
    <div style="font-family:system-ui;color:#e5e7eb;min-width:280px">
      <div style="font-weight:700;font-size:19px;margin-bottom:8px;color:#fff;line-height:1.3">${cafe.name}</div>
      ${cafe.address ? `<div style="font-size:14px;color:#9ca3af;margin-bottom:12px;line-height:1.4">${cafe.address}</div>` : ''}
      ${cafe.google_rating != null ? `<div style="font-size:26px;margin-bottom:10px;line-height:1">⭐ ${cafe.google_rating.toFixed(1)}</div>` : ''}
      <div style="font-size:15px;margin-bottom:7px;line-height:1.6">Laptop: ${laptopLabel(cafe)}</div>
      <div style="font-size:15px;margin-bottom:7px;line-height:1.6">WiFi: ${wifiLabel(cafe)}</div>
      <div style="font-size:15px;margin-bottom:10px;line-height:1.6">Seating: ${dots(cafe.seating_rating)}${cafe.seating_rating != null ? sourceLabel(cafe.confidence) : ''}</div>
      <div style="margin-top:12px;margin-bottom:8px">${confidenceBadge(cafe.confidence)}</div>
      ${cafe.enrichment_reason ? `<div style="font-size:12px;color:#6b7280;font-style:italic;margin-bottom:6px;line-height:1.4">${cafe.enrichment_reason}${cafe.key_review_quote ? ` <span style="cursor:help;color:#9ca3af;font-size:11px;border:1px solid #4b5563;border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;margin-left:6px;vertical-align:middle;position:relative;font-style:normal" onmouseenter="this.querySelector('.tt').style.display='block'" onmouseleave="this.querySelector('.tt').style.display='none'">?<div class="tt" style="display:none;position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#e5e7eb;font-size:11px;padding:8px 10px;border-radius:8px;width:220px;z-index:9999;border:1px solid #374151;font-style:italic;line-height:1.4;box-shadow:0 4px 12px rgba(0,0,0,0.5);white-space:normal">"${cafe.key_review_quote}"</div></span>` : ''}</div>` : ''}
      ${cafe.google_place_id ? `<div style="margin-bottom:8px"><a href="https://www.google.com/maps/place/?q=place_id:${cafe.google_place_id}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#60a5fa;text-decoration:none">${cafe.enrichment_reason?.toLowerCase().includes('review') ? '📍 View Google reviews' : '📍 View on Google Maps'}</a></div>` : ''}
      <button
        data-cafe-id="${cafe.id}"
        class="suggest-correction-btn"
        style="width:100%;padding:10px 16px;background:#374151;color:#e5e7eb;border:1px solid #4b5563;border-radius:12px;cursor:pointer;font-size:13px;font-weight:500;transition:background 0.15s"
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

  const searchCity = useCallback(async (lat: number, lng: number, city?: string) => {
    console.log('[Map] searchCity —', city || 'unknown', 'at', lat, lng);
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

            if (event.type === 'first_search') {
              setFirstSearchCity(event.city as string);
            } else if (event.type === 'status') {
              setStatusMessage(event.message);
            } else if (event.type === 'cafes') {
              setFirstSearchCity(null);
              setCafes(event.cafes as Cafe[]);
            } else if (event.type === 'error') {
              showToast(event.message || 'Something went wrong');
            } else if (event.type === 'complete') {
              setTimeout(() => setStatusMessage(null), 2000);
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        showToast('Network error — check console');
      }
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

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
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
      }).setHTML(popupHTML(cafe));

      const marker = new mapboxgl.Marker(el)
        .setLngLat([cafe.lng, cafe.lat])
        .setPopup(popup)
        .addTo(map.current!);

      el.addEventListener('click', () => {
        map.current?.panTo([cafe.lng, cafe.lat], { offset: [0, 150] });
      });

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
      <div className="absolute z-30" style={{ top: 10, left: 10 }}>
        <SearchBox
          onSelect={handleSearch}
          onTyping={() => setOverlayDismissed(true)}
          loading={loadingCafes}
        />
      </div>

      {/* My location button — top right */}
      <button
        onClick={handleMyLocation}
        className="absolute z-20 bg-white text-base text-[#333] hover:bg-gray-50 transition-colors cursor-pointer"
        style={{ top: 10, right: 10, height: 46, padding: '0 16px', borderRadius: 8, boxShadow: '0 2px 6px rgba(0,0,0,0.3)', border: 'none' }}
        title="Go to my location"
      >
        📍 My location
      </button>

      {/* First search overlay */}
      {firstSearchCity && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="text-center pointer-events-auto animate-fade-in" style={{ background: '#fff', borderRadius: 12, padding: '40px 48px', maxWidth: 480, boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <p style={{ fontSize: 22, fontWeight: 700, color: '#202124', marginBottom: 12 }}>
              You&apos;re the first to search {firstSearchCity}!
            </p>
            <p style={{ fontSize: 16, color: '#5f6368', lineHeight: 1.6 }}>
              Sit tight while we find the best work cafés — this takes a minute but you&apos;re making it faster for everyone who comes after you ☕
            </p>
            {statusMessage && (
              <p style={{ fontSize: 14, color: '#80868b', marginTop: 20 }} className="animate-fade-in">{statusMessage}</p>
            )}
          </div>
        </div>
      )}

      {/* Status bar — top center */}
      {statusMessage && !firstSearchCity && (
        <div className="absolute left-1/2 -translate-x-1/2 z-20 animate-fade-in whitespace-nowrap" style={{ top: 66, background: '#fff', borderRadius: 20, padding: '10px 20px', fontSize: 14, fontWeight: 500, color: '#333', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>
          {statusMessage}
        </div>
      )}

      {/* Location status toast */}
      {locationState === 'locating' && !statusMessage && (
        <div className="absolute left-1/2 -translate-x-1/2 z-20 animate-fade-in" style={{ top: 66, background: '#fff', borderRadius: 20, padding: '10px 20px', fontSize: 14, fontWeight: 500, color: '#5f6368', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>
          📍 Finding your location...
        </div>
      )}

      {/* Search prompt overlay */}
      {showSearchOverlay && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="text-center pointer-events-auto animate-fade-in" style={{ background: '#fff', borderRadius: 12, padding: '32px 40px', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>
            <p style={{ fontSize: 20, fontWeight: 600, color: '#202124' }}>Search a city above to find work-friendly cafés 🔍</p>
          </div>
        </div>
      )}

      {/* Toast notification — bottom right */}
      {toast && (
        <div className="absolute bottom-16 right-4 z-30 animate-fade-in" style={{ background: '#fff', borderRadius: 8, padding: '12px 20px', fontSize: 14, color: '#333', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>
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
