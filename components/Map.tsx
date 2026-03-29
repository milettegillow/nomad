"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Cafe } from "@/lib/types";
import SearchBox from "./SearchBox";
import Filters from "./Filters";
import CorrectionPanel from "./CorrectionPanel";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

const LIGHT_STYLE = "mapbox://styles/miletteriis/cmnal77gg004p01s4cwqed436";
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11";

function markerColor(cafe: Cafe): string {
  if (cafe.laptop_allowed === true) return "#34a853";
  if (cafe.laptop_allowed === false) return "#ea4335";
  return "#fbbc04";
}

function confidenceBadge(confidence: string, dark: boolean) {
  const muted = dark ? "#888" : "#999";
  switch (confidence) {
    case "verified":
      return `<span style="color:#16a34a;font-size:13px;font-weight:500">✓ Verified</span> <span style="color:${muted};font-size:12px">via community</span>`;
    case "inferred":
      return `<span style="color:#d97706;font-size:13px;font-weight:500">~ Likely</span> <span style="color:${muted};font-size:12px">via reviews</span>`;
    default:
      return `<span style="color:${muted};font-size:13px">? Unconfirmed</span>`;
  }
}

function dots(rating: number | null, dark: boolean) {
  if (rating == null)
    return `<span style="color:${dark ? "#666" : "#999"}">?</span>`;
  const filled = dark ? "#e5e7eb" : "#333";
  const empty = dark ? "#444" : "#ccc";
  return `<span style="letter-spacing:2px;color:${filled}">${"●".repeat(rating)}<span style="color:${empty}">${"○".repeat(5 - rating)}</span></span>`;
}

function sourceLabel(confidence: string, dark: boolean) {
  const c = dark ? "#888" : "#999";
  if (confidence === "verified")
    return `<span style="color:${c};font-size:11px;margin-left:4px">via community</span>`;
  if (confidence === "inferred")
    return `<span style="color:${c};font-size:11px;margin-left:4px">via reviews</span>`;
  return "";
}

function laptopLabel(cafe: Cafe, dark: boolean) {
  if (cafe.laptop_allowed === true)
    return `<span style="color:#16a34a">✓ Allowed</span>${sourceLabel(cafe.confidence, dark)}`;
  if (cafe.laptop_allowed === false)
    return `<span style="color:#dc2626">✗ Not allowed</span>${sourceLabel(cafe.confidence, dark)}`;
  return `<span style="color:${dark ? "#666" : "#999"}">? Unknown</span>`;
}

function wifiLabel(cafe: Cafe, dark: boolean) {
  const muted = dark ? "#888" : "#999";
  if (cafe.wifi_rating != null)
    return `<span style="color:#16a34a">✓ Available</span> <span style="color:${muted};font-size:13px">(${cafe.wifi_rating}/5)</span>${sourceLabel(cafe.confidence, dark)}`;
  return `<span style="color:${dark ? "#666" : "#999"}">? Unknown</span>`;
}

function popupHTML(cafe: Cafe, dark: boolean) {
  const bg = dark ? "#1a1a1a" : "#ffffff";
  const text = dark ? "#e5e7eb" : "#333333";
  const nameColor = dark ? "#fff" : "#1a1a1a";
  const addrColor = dark ? "#999" : "#666";
  const reasonColor = dark ? "#888" : "#666";
  const linkColor = "#1a73e8";
  const btnBg = dark ? "#2a2a2a" : "#f8f8f8";
  const btnBorder = dark ? "#444" : "#e0e0e0";
  const btnText = dark ? "#e5e7eb" : "#333";
  const btnHover = dark ? "#333" : "#f0f0f0";
  const ttBg = dark ? "#111" : "#fff";
  const ttBorder = dark ? "#333" : "#e0e0e0";
  const ttText = dark ? "#e5e7eb" : "#333";
  const ttShadow = dark
    ? "0 4px 12px rgba(0,0,0,0.5)"
    : "0 2px 8px rgba(0,0,0,0.15)";
  const qBorder = dark ? "#444" : "#ddd";

  const popupBorder = dark ? "1px solid #333333" : "1px solid #e8e8e8";

  return `
    <div style="font-family:system-ui;color:${text};min-width:240px;background:${bg};border:${popupBorder};border-radius:12px;padding:16px;padding-bottom:4px">
      <div style="font-weight:700;font-size:16px;margin-bottom:6px;color:${nameColor}">${cafe.name}</div>
      ${cafe.address ? `<div style="font-size:14px;color:${addrColor};margin-bottom:12px;line-height:1.4">${cafe.address}</div>` : ""}
      ${cafe.photo_name ? `<img src="/api/photo?name=${encodeURIComponent(cafe.photo_name)}" alt="" style="width:100%;height:160px;object-fit:cover;border-radius:8px;margin:8px 0 12px 0;display:block" />` : ""}
      ${cafe.google_rating != null ? `<div style="font-size:26px;margin-bottom:10px;line-height:1">⭐ ${cafe.google_rating.toFixed(1)}</div>` : ""}
      <div style="font-size:15px;margin-bottom:7px;line-height:1.6">Laptop: ${laptopLabel(cafe, dark)}</div>
      <div style="font-size:15px;margin-bottom:7px;line-height:1.6">WiFi: ${wifiLabel(cafe, dark)}</div>
      <div style="font-size:15px;margin-bottom:10px;line-height:1.6">Seating: ${dots(cafe.seating_rating, dark)}${cafe.seating_rating != null ? sourceLabel(cafe.confidence, dark) : ""}</div>
      <div style="margin-top:12px;margin-bottom:8px">${confidenceBadge(cafe.confidence, dark)}</div>
      ${cafe.enrichment_reason ? `<div style="font-size:12px;color:${reasonColor};font-style:italic;margin-bottom:6px;line-height:1.4">${cafe.enrichment_reason}${cafe.key_review_quote ? ` <span style="cursor:help;color:${dark ? "#666" : "#999"};font-size:11px;border:1px solid ${qBorder};border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;margin-left:6px;vertical-align:middle;position:relative;font-style:normal" onmouseenter="this.querySelector('.tt').style.display='block'" onmouseleave="this.querySelector('.tt').style.display='none'">?<div class="tt" style="display:none;position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:${ttBg};color:${ttText};font-size:11px;padding:8px 10px;border-radius:8px;width:220px;z-index:9999;border:1px solid ${ttBorder};font-style:italic;line-height:1.4;box-shadow:${ttShadow};white-space:normal"><div style="color:${dark ? "#666" : "#999"};font-size:10px;margin-bottom:4px;font-style:normal">Key review:</div>"${cafe.key_review_quote}"</div></span>` : ""}</div>` : ""}
      ${cafe.google_place_id ? `<div style="margin-bottom:8px"><a href="https://www.google.com/maps/place/?q=place_id:${cafe.google_place_id}" target="_blank" rel="noopener noreferrer" tabindex="-1" style="outline:none;text-decoration:none;color:${linkColor};font-size:13px">${cafe.enrichment_reason?.toLowerCase().includes("review") ? "📍 View Google reviews" : "📍 View on Google Maps"}</a></div>` : ""}
      <button
        data-cafe-id="${cafe.id}"
        class="suggest-correction-btn"
        style="width:100%;padding:10px 16px;margin-top:12px;margin-bottom:4px;background:${btnBg};color:${btnText};border:1px solid ${btnBorder};border-radius:12px;cursor:pointer;font-size:13px;font-weight:500;transition:background 0.15s"
        onmouseover="this.style.background='${btnHover}'"
        onmouseout="this.style.background='${btnBg}'"
      >Suggest a correction</button>
    </div>
  `;
}

export default function Map() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<
    globalThis.Map<
      string,
      { marker: mapboxgl.Marker; el: HTMLDivElement; cafe: Cafe }
    >
  >(new globalThis.Map());
  const [cafes, setCafes] = useState<Cafe[]>([]);
  const allCafesRef = useRef<Cafe[]>([]);
  const [correctionCafe, setCorrectionCafe] = useState<Cafe | null>(null);
  const [filters, setFilters] = useState({
    laptop: false,
    wifi: false,
    seating: false,
  });
  const [loadingCafes, setLoadingCafes] = useState(false);
  const [panLoading, setPanLoading] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [showSearchArea, setShowSearchArea] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [firstSearchCity, setFirstSearchCity] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const progressInterval = useRef<ReturnType<typeof setInterval>>(undefined);
  const [locationState, setLocationState] = useState<
    "pending" | "locating" | "granted" | "failed"
  >("pending");
  const locationDenied = useRef(false);
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const skipNextMoveEnd = useRef(false);
  const pipelineAbortRef = useRef<AbortController | null>(null);
  const activePopupCafeIdRef = useRef<string | null>(null);
  const lastSearchCenter = useRef<{ lat: number; lng: number } | null>(null);
  const hasInitialSearch = useRef(false);

  // Merge cafés into ref and trigger re-render
  const updateCafes = useCallback((incoming: Cafe[], replace: boolean) => {
    if (replace) {
      allCafesRef.current = incoming;
    } else {
      const existingIds = new Set(allCafesRef.current.map(c => c.id));
      const toAdd = incoming.filter(c => !existingIds.has(c.id));
      if (toAdd.length > 0) {
        allCafesRef.current = [...allCafesRef.current, ...toAdd];
        console.log('[Cafes] Merged', toAdd.length, 'new, total:', allCafesRef.current.length);
      }
    }
    console.log('[updateCafes] Setting state with', allCafesRef.current.length, 'cafés, replace:', replace);
    setCafes([...allCafesRef.current]);
  }, []);

  // Load dark mode preference
  useEffect(() => {
    const saved = localStorage.getItem("nomad-dark-mode");
    if (saved === "true") setDarkMode(true);
  }, []);

  // Toggle dark mode
  const toggleDarkMode = useCallback(() => {
    // Save currently open popup before style change destroys markers
    let openCafeId: string | null = null;
    markersRef.current.forEach(({ marker, cafe }) => {
      if (marker.getPopup()?.isOpen()) openCafeId = cafe.id;
    });
    activePopupCafeIdRef.current = openCafeId;

    setDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem("nomad-dark-mode", String(next));
      if (map.current) {
        map.current.setStyle(next ? DARK_STYLE : LIGHT_STYLE);
      }
      document.body.classList.toggle("nomad-dark", next);
      const meta = document.querySelector('#theme-color-meta');
      if (meta) meta.setAttribute('content', next ? '#1a1a1a' : '#ffffff');
      return next;
    });
  }, []);

  // Re-render markers after style change, then re-open saved popup
  useEffect(() => {
    if (!map.current) return;
    const m = map.current;
    const onStyleLoad = () => {
      // Force marker re-render
      setCafes((prev) => [...prev]);
      // Re-open popup after markers are re-added (next tick)
      setTimeout(() => {
        const cafeId = activePopupCafeIdRef.current;
        if (cafeId) {
          const entry = markersRef.current.get(cafeId);
          if (entry && !entry.marker.getPopup()?.isOpen()) {
            entry.marker.togglePopup();
            map.current?.easeTo({ center: [entry.cafe.lng, entry.cafe.lat], offset: [0, 200], duration: 300 });
          }
          activePopupCafeIdRef.current = null;
        }
      }, 100);
    };
    m.on("style.load", onStyleLoad);
    return () => {
      m.off("style.load", onStyleLoad);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const searchCity = useCallback(
    async (lat: number, lng: number, city?: string) => {
      setLoadingCafes(true);
      setStatusMessage(`📍 Searching ${city || "this area"}...`);

      pipelineAbortRef.current?.abort();
      const abort = new AbortController();
      pipelineAbortRef.current = abort;

      try {
        const res = await fetch("/api/cafes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng, city }),
          signal: abort.signal,
        });

        if (!res.ok || !res.body) {
          showToast("Search failed — check console");
          setLoadingCafes(false);
          setStatusMessage(null);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "first_search") {
                setFirstSearchCity(event.city as string);
                setProgress(0);
                clearInterval(progressInterval.current);
                progressInterval.current = setInterval(() => {
                  setProgress(prev => {
                    if (prev >= 92) return 92;
                    const factor = Math.pow(1 - prev / 100, 2);
                    const increment = (Math.random() * 2 + 0.5) * factor;
                    return Math.min(prev + increment, 92);
                  });
                }, 200);
              } else if (event.type === "status") {
                setStatusMessage(event.message);
              } else if (event.type === "cafes") {
                clearInterval(progressInterval.current);
                setProgress(100);
                setFirstSearchCity(null);
                const receivedCafes = event.cafes as Cafe[];
                console.log('[Map] SSE cafes event received:', receivedCafes.length, 'cafés');
                updateCafes(receivedCafes, true);
                // Ensure map is centered where cafés are
                if (map.current && receivedCafes.length > 0) {
                  const avgLat = receivedCafes.reduce((s, c) => s + c.lat, 0) / receivedCafes.length;
                  const avgLng = receivedCafes.reduce((s, c) => s + c.lng, 0) / receivedCafes.length;
                  skipNextMoveEnd.current = true;
                  map.current.jumpTo({ center: [avgLng, avgLat], zoom: 14 });
                }
                lastSearchCenter.current = { lat, lng };
                hasInitialSearch.current = true;
                setShowSearchArea(false);
              } else if (event.type === "error") {
                showToast(event.message || "Something went wrong");
              } else if (event.type === "complete") {
                setTimeout(() => setStatusMessage(null), 2000);
              }
            } catch {
              /* skip */
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          showToast("Network error — check console");
      } finally {
        setLoadingCafes(false);
      }
    },
    [showToast, updateCafes],
  );

  // Manual "Search this area" loading (GET, no enrichment)
  const searchThisArea = useCallback(async () => {
    if (!map.current) return;
    const center = map.current.getCenter();
    console.log('[Search Area] Button clicked, centre:', center.lat, center.lng);
    setPanLoading(true);
    setShowSearchArea(false);
    try {
      console.log('[Search Area] Calling API...');
      const res = await fetch(`/api/cafes?lat=${center.lat}&lng=${center.lng}`);
      if (!res.ok) {
        console.error('[Search Area] API error:', res.status);
        return;
      }
      const newCafes = await res.json() as Cafe[];
      console.log('[Search Area] Got', newCafes.length, 'cafés');
      if (!Array.isArray(newCafes) || newCafes.length === 0) return;

      // Merge with existing — deduplicate (no re-centre)
      updateCafes(newCafes, false);

      lastSearchCenter.current = { lat: center.lat, lng: center.lng };

      // Fire and forget background enrichment for unconfirmed cafés
      const unconfirmed = newCafes
        .filter(c => c.confidence === 'unconfirmed' && !c.id.startsWith('temp-'))
        .map(c => c.id);
      if (unconfirmed.length > 0) {
        fetch('/api/enrich-background', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cafeIds: unconfirmed }),
        }).catch(() => {});
      }
    } catch (e) {
      console.error('[Search Area] Error:', e);
    } finally {
      setPanLoading(false);
      // Re-show button after 3 seconds
      setTimeout(() => setShowSearchArea(true), 3000);
    }
  }, [updateCafes]);

  const searchCityRef = useRef(searchCity);
  useEffect(() => {
    searchCityRef.current = searchCity;
  }, [searchCity]);

  const flyToAndSearch = useCallback(
    (lng: number, lat: number, city?: string) => {
      if (!map.current) return;
      skipNextMoveEnd.current = true;
      setOverlayDismissed(true);
      map.current.flyTo({ center: [lng, lat], zoom: 14, duration: 1500 });
      searchCityRef.current(lat, lng, city);
    },
    [],
  );

  const requestLocation = useCallback(() => {
    setLocationState("locating");

    if (!navigator.geolocation) {
      setLocationState("failed");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        console.log("[Geolocate] Browser GPS:", latitude, longitude);
        setLocationState("granted");
        setOverlayDismissed(true);
        if (map.current) {
          skipNextMoveEnd.current = true;
          map.current.flyTo({ center: [longitude, latitude], zoom: 14, duration: 1500 });
        }
        searchCityRef.current(latitude, longitude);
      },
      async (err) => {
        console.log("[Geolocate] Browser error — code:", err.code, "message:", err.message);
        if (err.code === 1) {
          // Permission denied
          locationDenied.current = true;
          setLocationState("failed");
        } else {
          // Timeout or unavailable — try IP-based fallback
          console.log("[Geolocate] Falling back to /api/geolocate");
          try {
            const res = await fetch("/api/geolocate", { method: "POST" });
            const data = await res.json();
            if (res.ok && typeof data.lat === "number" && typeof data.lng === "number") {
              console.log("[Geolocate] IP fallback:", data.city, data.lat, data.lng);
              setLocationState("granted");
              setOverlayDismissed(true);
              if (map.current) {
                skipNextMoveEnd.current = true;
                map.current.flyTo({ center: [data.lng, data.lat], zoom: 14, duration: 1500 });
              }
              searchCityRef.current(data.lat, data.lng);
              return;
            }
          } catch { /* fall through */ }
          setLocationState("failed");
        }
      },
      { enableHighAccuracy: false, timeout: 30000, maximumAge: 300000 }
    );
  }, []);

  // Initialize map
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    const savedDark = localStorage.getItem("nomad-dark-mode") === "true";
    if (savedDark) document.body.classList.add("nomad-dark");

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: savedDark ? DARK_STYLE : LIGHT_STYLE,
      center: [0, 20],
      zoom: 2,
    });
    map.current = m;

    m.dragRotate.disable();
    m.touchZoomRotate.disableRotation();
    m.addControl(new mapboxgl.NavigationControl(), "bottom-right");

    m.on("moveend", () => {
      if (skipNextMoveEnd.current) {
        skipNextMoveEnd.current = false;
        return;
      }
      if (hasInitialSearch.current && m.getZoom() >= 13) {
        setShowSearchArea(true);
      }
    });

    m.on("load", () => {
      requestLocation();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Correction clicks
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest(
        ".suggest-correction-btn",
      ) as HTMLElement | null;
      if (!btn) return;
      const cafeId = btn.dataset.cafeId;
      const cafe = cafes.find((c) => c.id === cafeId);
      if (cafe) setCorrectionCafe(cafe);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [cafes]);

  // Update markers
  useEffect(() => {
    if (!map.current) {
      console.log('[Markers] Skipped — map not ready, cafes:', cafes.length);
      return;
    }

    console.log('[Markers] Rendering', cafes.length, 'cafés');
    markersRef.current.forEach(({ marker }) => marker.remove());
    markersRef.current.clear();

    const filtered = cafes
      .filter((cafe) => {
        if (filters.laptop && cafe.laptop_allowed !== true) return false;
        if (filters.wifi && cafe.wifi_rating == null) return false;
        if (filters.seating && cafe.seating_rating == null) return false;
        return true;
      })
      // Render green (laptop_allowed=true) last so they appear on top
      .sort((a, b) => {
        if (a.laptop_allowed === true && b.laptop_allowed !== true) return 1;
        if (b.laptop_allowed === true && a.laptop_allowed !== true) return -1;
        return 0;
      });

    filtered.forEach((cafe) => {
      const el = document.createElement("div");
      el.className = "cafe-marker";
      el.style.width = "18px";
      el.style.height = "18px";
      el.style.borderRadius = "50%";
      el.style.backgroundColor = markerColor(cafe);
      el.style.border = darkMode ? "2px solid #3b82f6" : "2px solid rgba(255,255,255,0.8)";
      el.style.cursor = "pointer";
      el.style.boxShadow = darkMode
        ? `0 0 6px ${markerColor(cafe)}80, 0 0 0 1px #3b82f640`
        : `0 0 6px ${markerColor(cafe)}80`;
      el.style.transition = "background-color 0.5s ease, box-shadow 0.5s ease";

      const popup = new mapboxgl.Popup({
        offset: 12,
        closeButton: true,
        maxWidth: window.innerWidth < 768 ? "85vw" : "340px",
        anchor: "bottom",
        className: "nomad-popup",
      }).setHTML(popupHTML(cafe, darkMode));

      popup.on('open', () => setPopupOpen(true));
      popup.on('close', () => setPopupOpen(false));

      const marker = new mapboxgl.Marker(el)
        .setLngLat([cafe.lng, cafe.lat])
        .setPopup(popup)
        .addTo(map.current!);

      el.addEventListener("click", () => {
        map.current?.easeTo({ center: [cafe.lng, cafe.lat], offset: [0, 200], duration: 300 });
      });

      markersRef.current.set(cafe.id, { marker, el, cafe });
    });

  }, [cafes, filters, darkMode]);

  const handleCitySearch = (lng: number, lat: number, cityName: string) => {
    flyToAndSearch(lng, lat, cityName);
  };

  const handleCafeSearch = useCallback(async (lat: number, lng: number, placeId: string, cafeName: string, rating: number | null, address: string | null, photoName: string | null, dbId: string | null) => {
    if (!map.current) return;
    skipNextMoveEnd.current = true;
    setOverlayDismissed(true);
    map.current.flyTo({ center: [lng, lat], zoom: 16, duration: 1500 });

    // Create a placeholder café with data from search
    const placeholderCafe: Cafe = {
      id: dbId || `search-${placeId}`,
      name: cafeName,
      lat,
      lng,
      address: address || undefined,
      google_place_id: placeId,
      laptop_allowed: null,
      wifi_rating: null,
      seating_rating: null,
      google_rating: rating,
      foursquare_rating: null,
      confidence: 'unconfirmed',
      last_updated: new Date().toISOString(),
      photo_name: photoName || undefined,
    };

    // Add placeholder immediately so a marker appears
    updateCafes([placeholderCafe], false);
    hasInitialSearch.current = true;
    lastSearchCenter.current = { lat, lng };

    // Load nearby cafés
    try {
      const res = await fetch(`/api/cafes?lat=${lat}&lng=${lng}`);
      if (res.ok) {
        const nearbyCafes = await res.json() as Cafe[];
        if (Array.isArray(nearbyCafes) && nearbyCafes.length > 0) {
          updateCafes(nearbyCafes, false);

          // Background enrichment
          const unconfirmed = nearbyCafes
            .filter(c => c.confidence === 'unconfirmed' && !c.id.startsWith('temp-') && !c.id.startsWith('search-'))
            .map(c => c.id);
          if (unconfirmed.length > 0) {
            fetch('/api/enrich-background', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cafeIds: unconfirmed }),
            }).catch(() => {});
          }
        }
      }
    } catch {
      console.error('[Map] Café search area load failed');
    }

    // Open the popup for the searched café after markers render
    setTimeout(() => {
      const entry = Array.from(markersRef.current.values()).find(
        e => e.cafe.google_place_id === placeId
      );
      if (entry) {
        entry.marker.togglePopup();
        map.current?.easeTo({ center: [entry.cafe.lng, entry.cafe.lat], offset: [0, 200], duration: 300 });
      }
    }, 800);
  }, [updateCafes]);

  const handleMyLocation = async () => {
    try {
      const res = await fetch("/api/geolocate", { method: "POST" });
      const data = await res.json();
      if (
        !res.ok ||
        typeof data.lat !== "number" ||
        typeof data.lng !== "number"
      ) {
        showToast("Location unavailable — try searching instead");
        return;
      }
      setLocationState("granted");
      setOverlayDismissed(true);
      if (map.current) {
        skipNextMoveEnd.current = true;
        map.current.flyTo({
          center: [data.lng, data.lat],
          zoom: 14,
          duration: 1500,
        });
      }
      searchCityRef.current(data.lat, data.lng);
    } catch {
      showToast("Location unavailable — try searching instead");
    }
  };

  const showSearchOverlay =
    locationState === "failed" && cafes.length === 0 && !overlayDismissed;

  // Theme-aware colors
  const d = darkMode;
  const cardBg = d ? "#1a1a1a" : "#fff";
  const cardText = d ? "#e5e7eb" : "#333";
  const cardTextMuted = d ? "#888" : "#5f6368";
  const cardTextFaint = d ? "#666" : "#80868b";
  const cardBorder = d ? "1px solid #333" : "none";
  const cardShadow = "0 2px 6px rgba(0,0,0,0.3)";
  const pillBg = d ? "#1a1a1a" : "#fff";
  const pillText = d ? "#e5e7eb" : "#333";
  const pillTextMuted = d ? "#888" : "#5f6368";
  const btnBg = d ? "#1a1a1a" : "#fff";
  const btnText = d ? "#e5e7eb" : "#333";
  const btnBorder = d ? "1px solid #333" : "none";

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Search box */}
      <div className="absolute z-30" style={{ top: 10, left: 10, right: 10 }}>
        <div className="sm:w-auto" style={{ maxWidth: 400 }}>
        <SearchBox
          onSelectCity={handleCitySearch}
          onSelectCafe={handleCafeSearch}
          onTyping={() => setOverlayDismissed(true)}
          onFocus={() => {
            markersRef.current.forEach(({ marker }) => marker.getPopup()?.remove());
            setPopupOpen(false);
          }}
          loading={loadingCafes}
          dark={darkMode}
          mapCenter={map.current ? { lat: map.current.getCenter().lat, lng: map.current.getCenter().lng } : null}
        />
        </div>
      </div>

      {/* Top-right buttons — hidden on mobile */}
      <div
        className="absolute z-20 hidden sm:flex"
        style={{ top: 10, right: 10, gap: 8 }}
      >
        {/* Dark mode toggle */}
        <button
          onClick={toggleDarkMode}
          className="cursor-pointer"
          style={{
            height: 40,
            width: 40,
            borderRadius: 20,
            boxShadow: cardShadow,
            border: btnBorder,
            background: btnBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
          }}
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          {darkMode ? "🌙" : "☀️"}
        </button>
        {/* My location — hidden on mobile */}
        <button
          onClick={handleMyLocation}
          className="hidden sm:flex transition-colors cursor-pointer"
          style={{
            height: 40,
            padding: "0 14px",
            borderRadius: 20,
            boxShadow: cardShadow,
            border: btnBorder,
            background: btnBg,
            color: btnText,
            fontSize: 14,
            alignItems: "center",
            gap: 4,
          }}
          title="Go to my location"
        >
          📍 My location
        </button>
      </div>

      {/* First search overlay */}
      {firstSearchCity && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div
            className="text-center pointer-events-auto animate-fade-in"
            style={{
              background: cardBg,
              borderRadius: 12,
              padding: "40px 48px",
              maxWidth: 480,
              boxShadow: cardShadow,
              border: cardBorder,
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <p
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: cardText,
                marginBottom: 12,
              }}
            >
              You&apos;re the first to search {firstSearchCity}!
            </p>
            <p style={{ fontSize: 16, color: cardTextMuted, lineHeight: 1.6 }}>
              Sit tight while we find the best work cafés - this takes a minute
              but you&apos;re making it faster for everyone who comes after you
              ☕
            </p>
            {statusMessage && (
              <p
                style={{ fontSize: 14, color: cardTextFaint, marginTop: 20 }}
                className="animate-fade-in"
              >
                {statusMessage}
              </p>
            )}
            <div style={{ width: '100%', background: 'rgba(0,0,0,0.1)', borderRadius: 9999, height: 4, marginTop: 16 }}>
              <div style={{ width: `${progress}%`, background: '#1a73e8', height: 4, borderRadius: 9999, transition: 'width 0.2s ease' }} />
            </div>
          </div>
        </div>
      )}

      {/* Status bar */}
      {statusMessage && !firstSearchCity && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-20 animate-fade-in whitespace-nowrap"
          style={{
            top: 66,
            background: pillBg,
            borderRadius: 20,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 500,
            color: pillText,
            boxShadow: cardShadow,
            border: cardBorder,
          }}
        >
          {statusMessage}
        </div>
      )}



      {/* Location toast */}
      {locationState === "locating" && !statusMessage && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-20 animate-fade-in"
          style={{
            top: 66,
            background: pillBg,
            borderRadius: 20,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 500,
            color: pillTextMuted,
            boxShadow: cardShadow,
            border: cardBorder,
          }}
        >
          📍 Finding your location...
        </div>
      )}

      {/* Search prompt */}
      {showSearchOverlay && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div
            className="text-center pointer-events-auto animate-fade-in"
            style={{
              background: cardBg,
              borderRadius: 12,
              padding: "32px 40px",
              boxShadow: cardShadow,
              border: cardBorder,
            }}
          >
            <p style={{ fontSize: 20, fontWeight: 600, color: cardText }}>
              Search a city above to find work-friendly cafés 🔍
            </p>
            {locationDenied.current && (
              <p style={{ fontSize: 13, color: cardTextMuted, marginTop: 12, lineHeight: 1.5 }}>
                📍 For best results, choose &quot;Allow on this site&quot; when prompted for location
              </p>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="absolute bottom-16 right-4 z-30 animate-fade-in"
          style={{
            background: cardBg,
            borderRadius: 8,
            padding: "12px 20px",
            fontSize: 14,
            color: cardText,
            boxShadow: cardShadow,
            border: cardBorder,
          }}
        >
          {toast}
        </div>
      )}

      {/* Search this area button — top center */}
      {showSearchArea && !panLoading && !statusMessage && !firstSearchCity && !popupOpen && (
        <div className="absolute left-1/2 -translate-x-1/2 z-20 animate-fade-in" style={{ top: 66 }}>
          <button
            onClick={searchThisArea}
            className="cursor-pointer"
            style={{
              background: d ? '#1a1a1a' : '#fff',
              color: d ? '#e5e7eb' : '#333',
              border: d ? '1px solid #333' : 'none',
              borderRadius: 20,
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 500,
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            Search this area
          </button>
        </div>
      )}

      {/* Pan loading pill — top center */}
      {panLoading && !statusMessage && !firstSearchCity && (
        <div className="absolute left-1/2 -translate-x-1/2 z-20 animate-fade-in" style={{ top: 66, background: d ? '#1a1a1a' : '#fff', borderRadius: 16, padding: '6px 14px', fontSize: 12, color: d ? '#888' : '#5f6368', boxShadow: '0 1px 4px rgba(0,0,0,0.2)', border: d ? '1px solid #333' : 'none' }}>
          Loading cafés...
        </div>
      )}

      {/* Filter toolbar — bottom center */}
      <div className="absolute left-1/2 -translate-x-1/2 z-20 bottom-6 sm:bottom-6" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <Filters filters={filters} onChange={setFilters} dark={darkMode} />
      </div>

      {correctionCafe && (
        <CorrectionPanel
          cafe={correctionCafe}
          darkMode={darkMode}
          onClose={() => {
            setCorrectionCafe(null);
            setCafes([...allCafesRef.current]);
          }}
          onUpdate={(updates) => {
            // Optimistic: update marker color + popup content instantly
            const cafeId = correctionCafe.id;
            const entry = markersRef.current.get(cafeId);
            if (entry) {
              const newColor = updates.laptop_allowed === true ? '#34a853' : updates.laptop_allowed === false ? '#ea4335' : '#fbbc04';
              entry.el.style.backgroundColor = newColor;
              entry.el.style.boxShadow = `0 0 0 4px ${newColor}40, 0 0 12px ${newColor}`;
              setTimeout(() => {
                entry.el.style.boxShadow = `0 0 8px ${newColor}90, 0 1px 3px rgba(0,0,0,0.4)`;
              }, 1500);

              // Update popup HTML in place
              const reason = updates.notes ? `Reported by a user: ${updates.notes}` : 'Reported by a user';
              const updatedCafe: Cafe = { ...correctionCafe, ...updates, confidence: 'inferred', enrichment_reason: reason };
              entry.marker.getPopup()?.setHTML(popupHTML(updatedCafe, darkMode));
            }

            // Update ref
            allCafesRef.current = allCafesRef.current.map(c =>
              c.id === cafeId
                ? { ...c, ...updates, confidence: 'inferred' as const, enrichment_reason: updates.notes ? `Reported by a user: ${updates.notes}` : 'Reported by a user' }
                : c
            );
          }}
          onSubmitted={() => {
            // API call completed — ref already updated by onUpdate
          }}
        />
      )}
    </div>
  );
}
