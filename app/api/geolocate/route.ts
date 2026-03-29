export async function POST(request: Request) {
  try {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : null;

    const url = ip ? `https://ipapi.co/${ip}/json/` : 'https://ipapi.co/json/';
    const res = await fetch(url);
    const data = await res.json();

    if (!data.latitude || !data.longitude) {
      console.error('[Geolocate] ipapi returned no coords:', data);
      return Response.json({ error: 'Could not determine location' }, { status: 500 });
    }

    console.log('[Geolocate] ipapi result:', data.city, data.latitude, data.longitude);
    return Response.json({ lat: data.latitude, lng: data.longitude, city: data.city });
  } catch (e) {
    console.error('[Geolocate] Error:', e);
    return Response.json({ error: 'Geolocation failed' }, { status: 500 });
  }
}
