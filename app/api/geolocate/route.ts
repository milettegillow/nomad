const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;

export async function POST() {
  try {
    const res = await fetch(
      `https://www.googleapis.com/geolocation/v1/geolocate?key=${GOOGLE_PLACES_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ considerIp: true }),
      }
    );

    const data = await res.json();

    if (!res.ok || !data.location) {
      console.error('[Geolocate] Google API error:', res.status, data);
      return Response.json({ error: 'Geolocation failed' }, { status: 500 });
    }

    return Response.json({ lat: data.location.lat, lng: data.location.lng });
  } catch (e) {
    console.error('[Geolocate] Error:', e);
    return Response.json({ error: 'Geolocation failed' }, { status: 500 });
  }
}
