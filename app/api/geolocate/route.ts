export async function POST(request: Request) {
  try {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : null;

    // Try ip-api.com first (generous free tier)
    try {
      const url = ip ? `http://ip-api.com/json/${ip}` : 'http://ip-api.com/json';
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === 'success' && data.lat && data.lon) {
        console.log('[Geolocate] ip-api.com result:', data.city, data.lat, data.lon);
        return Response.json({ lat: data.lat, lng: data.lon, city: data.city });
      }
    } catch { /* fall through */ }

    // Try ipwho.is as fallback
    try {
      const url = ip ? `https://ipwho.is/${ip}` : 'https://ipwho.is';
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && data.latitude && data.longitude) {
        console.log('[Geolocate] ipwho.is result:', data.city, data.latitude, data.longitude);
        return Response.json({ lat: data.latitude, lng: data.longitude, city: data.city });
      }
    } catch { /* fall through */ }

    // Try freeipapi.com as last resort
    try {
      const url = ip ? `https://freeipapi.com/api/json/${ip}` : 'https://freeipapi.com/api/json';
      const res = await fetch(url);
      const data = await res.json();
      if (data.latitude && data.longitude) {
        console.log('[Geolocate] freeipapi result:', data.cityName, data.latitude, data.longitude);
        return Response.json({ lat: data.latitude, lng: data.longitude, city: data.cityName });
      }
    } catch { /* fall through */ }

    console.error('[Geolocate] All providers failed for IP:', ip);
    return Response.json({ error: 'Geolocation failed' }, { status: 500 });
  } catch (e) {
    console.error('[Geolocate] Error:', e);
    return Response.json({ error: 'Geolocation failed' }, { status: 500 });
  }
}
