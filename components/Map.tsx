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
      return '<span style="color:#22c55e;font-size:11px">✓ Verified</span>';
    case 'inferred':
      return '<span style="color:#eab308;font-size:11px">~ Likely</span>';
    default:
      return '<span style="color:#9ca3af;font-size:11px">? Unconfirmed</span>';
  }
}

function dots(rating: number | null) {
  if (!rating) return '<span style="color:#6b7280">—</span>';
  return '●'.repeat(rating) + '○'.repeat(5 - rating);
}

function popupHTML(cafe: Cafe) {
  return `
    <div style="font-family:system-ui;color:#e5e7eb;min-width:200px">
      <div style="font-weight:600;font-size:15px;margin-bottom:6px;color:#fff">${cafe.name}</div>
      ${cafe.address ? `<div style="font-size:12px;color:#9ca3af;margin-bottom:8px">${cafe.address}</div>` : ''}
      ${cafe.google_rating != null ? `<div style="font-size:18px;margin-bottom:2px">⭐ ${cafe.google_rating.toFixed(1)}</div>` : ''}
      ${cafe.foursquare_rating != null ? `<div style="font-size:12px;color:#9ca3af;margin-bottom:8px">Foursquare: ${cafe.foursquare_rating.toFixed(1)}/5</div>` : ''}
      <div style="font-size:13px;margin-bottom:4px">
        Laptop: ${cafe.laptop_allowed === true ? '<span style="color:#22c55e">✓ Yes</span>' : cafe.laptop_allowed === false ? '<span style="color:#ef4444">✗ No</span>' : '<span style="color:#9ca3af">? Unknown</span>'}
      </div>
      <div style="font-size:13px;margin-bottom:4px">
        WiFi: ${cafe.wifi_rating ? '<span style="color:#22c55e">✓ Yes</span>' : '<span style="color:#9ca3af">? Unknown</span>'}
      </div>
      <div style="font-size:13px;margin-bottom:4px">
        Seating: <span style="letter-spacing:2px">${dots(cafe.seating_rating)}</span>
      </div>
      <div style="margin-bottom:8px">${confidenceBadge(cafe.confidence)}</div>
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
  const markersRef = useRef<{ marker: mapboxgl.Marker; cafe: Cafe }[]>([]);
  const [cafes, setCafes] = useState<Cafe[]>([]);
  const [correctionCafe, setCorrectionCafe] = useState<Cafe | null>(null);
  const [filters, setFilters] = useState({ laptop: false, wifi: false, seating: false });
  const [loadingCafes, setLoadingCafes] = useState(false);
  const [locationState, setLocationState] = useState<'pending' | 'granted' | 'denied' | 'prompt'>('pending');
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const userCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  // Guard to prevent moveend from re-fetching during a flyTo we already handle
  const skipNextMoveEnd = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchCafes = useCallback(async (lat: number, lng: number) => {
    console.log('[Map] fetchCafes called with lat:', lat, 'lng:', lng);
    setLoadingCafes(true);
    try {
      const url = `/api/cafes?lat=${lat}&lng=${lng}`;
      console.log('[Map] Fetching:', url);
      const res = await fetch(url);
      const data = await res.json();
      console.log('[Map] API response status:', res.status, 'data:', Array.isArray(data) ? `${data.length} cafes` : data);

      if (!res.ok) {
        console.error('[Map] API error:', data);
        showToast(data.details || data.error || 'API error — check console');
        return;
      }

      if (Array.isArray(data)) {
        setCafes(data);
        if (data.length === 0) {
          showToast('No cafés found in this area');
        }
      } else {
        console.error('[Map] Unexpected response shape:', data);
        showToast('Unexpected API response — check console');
      }
    } catch (e) {
      console.error('[Map] Fetch error:', e);
      showToast('Network error — check console');
    } finally {
      setLoadingCafes(false);
    }
  }, [showToast]);

  const flyToAndFetch = useCallback((lng: number, lat: number, zoom = 14) => {
    if (!map.current) return;
    console.log('[Map] flyToAndFetch — lng:', lng, 'lat:', lat);
    skipNextMoveEnd.current = true;
    setOverlayDismissed(true);
    map.current.flyTo({ center: [lng, lat], zoom, duration: 1500 });
    fetchCafes(lat, lng);
  }, [fetchCafes]);

  // Initialize map
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [0, 20],
      zoom: 2,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

    map.current.on('moveend', () => {
      if (skipNextMoveEnd.current) {
        skipNextMoveEnd.current = false;
        return;
      }
      if (map.current!.getZoom() < 10) return;
      const center = map.current!.getCenter();
      console.log('[Map] moveend — fetching cafes at:', center.lat, center.lng);
      fetchCafes(center.lat, center.lng);
    });

    // Request geolocation
    setLocationState('prompt');

    if (!navigator.geolocation) {
      setLocationState('denied');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        console.log('[Map] Geolocation granted — lat:', latitude, 'lng:', longitude);
        userCoordsRef.current = { lat: latitude, lng: longitude };
        setLocationState('granted');
        setOverlayDismissed(true);
        // Fly to user location and fetch cafes — skip the moveend handler
        skipNextMoveEnd.current = true;
        map.current?.flyTo({ center: [longitude, latitude], zoom: 14, duration: 2000 });
        fetchCafes(latitude, longitude);
      },
      (err) => {
        console.log('[Map] Geolocation denied/error:', err.message);
        setLocationState('denied');
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }, [fetchCafes]);

  // Handle correction button clicks via event delegation
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
    markersRef.current = [];

    const filtered = cafes.filter(cafe => {
      if (filters.laptop && cafe.laptop_allowed !== true) return false;
      if (filters.wifi && cafe.wifi_rating == null) return false;
      if (filters.seating && cafe.seating_rating == null) return false;
      return true;
    });

    filtered.forEach(cafe => {
      const el = document.createElement('div');
      el.style.width = '14px';
      el.style.height = '14px';
      el.style.borderRadius = '50%';
      el.style.backgroundColor = markerColor(cafe);
      el.style.border = '2px solid rgba(0,0,0,0.3)';
      el.style.cursor = 'pointer';
      el.style.boxShadow = `0 0 6px ${markerColor(cafe)}80`;

      const popup = new mapboxgl.Popup({
        offset: 12,
        closeButton: true,
        maxWidth: '280px',
      })
        .setHTML(popupHTML(cafe));

      const marker = new mapboxgl.Marker(el)
        .setLngLat([cafe.lng, cafe.lat])
        .setPopup(popup)
        .addTo(map.current!);

      markersRef.current.push({ marker, cafe });
    });
  }, [cafes, filters]);

  const handleSearch = (lng: number, lat: number) => {
    flyToAndFetch(lng, lat);
  };

  const handleMyLocation = () => {
    if (userCoordsRef.current) {
      flyToAndFetch(userCoordsRef.current.lng, userCoordsRef.current.lat);
    } else {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          userCoordsRef.current = { lat: latitude, lng: longitude };
          setLocationState('granted');
          flyToAndFetch(longitude, latitude);
        },
        () => setLocationState('denied'),
        { enableHighAccuracy: false, timeout: 10000 }
      );
    }
  };

  // Show the overlay only when geolocation is denied, no cafes loaded, and not yet dismissed
  const showOverlay = locationState === 'denied' && cafes.length === 0 && !overlayDismissed;

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

      {/* Location prompt toast */}
      {locationState === 'prompt' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 px-5 py-3 rounded-xl bg-black/70 backdrop-blur-xl border border-white/10 text-sm text-gray-300 shadow-lg animate-fade-in">
          Allow location access to find cafés near you
        </div>
      )}

      {/* Denied — search prompt overlay */}
      {showOverlay && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="text-center px-6 py-8 rounded-2xl bg-black/50 backdrop-blur-xl border border-white/10 shadow-2xl pointer-events-auto animate-fade-in">
            <div className="text-3xl mb-3">🌍</div>
            <p className="text-white font-medium text-lg">Search any city to find work-friendly cafés</p>
            <p className="text-gray-500 text-sm mt-1">Use the search box above to get started</p>
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
            if (map.current) {
              const center = map.current.getCenter();
              fetchCafes(center.lat, center.lng);
            }
          }}
        />
      )}
    </div>
  );
}
