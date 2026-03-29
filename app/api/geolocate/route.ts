const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;

export async function POST(request: Request) {
  try {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : null;

    const body: Record<string, unknown> = { considerIp: true };
    if (ip) body.ipAddress = ip;

    console.log('[Geolocate] IP:', ip || 'none (using server IP)');

    const res = await fetch(
      `https://www.googleapis.com/geolocation/v1/geolocate?key=${GOOGLE_PLACES_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    const data = await res.json();

    if (!res.ok || !data.location) {
      console.error('[Geolocate] Google API error:', res.status, data);
      return Response.json({ error: 'Geolocation failed' }, { status: 500 });
    }

    console.log('[Geolocate] Result:', data.location.lat, data.location.lng);
    return Response.json({ lat: data.location.lat, lng: data.location.lng });
  } catch (e) {
    console.error('[Geolocate] Error:', e);
    return Response.json({ error: 'Geolocation failed' }, { status: 500 });
  }
}
