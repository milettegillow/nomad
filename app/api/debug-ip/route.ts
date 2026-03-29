const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;

export async function GET(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const cfIp = request.headers.get('cf-connecting-ip');
  const ip = forwarded ? forwarded.split(',')[0].trim() : realIp || cfIp || null;

  let googleResult = null;
  try {
    const body: Record<string, unknown> = { considerIp: true };
    if (ip) body.ipAddress = ip;

    const res = await fetch(
      `https://www.googleapis.com/geolocation/v1/geolocate?key=${GOOGLE_PLACES_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const data = await res.json();
    googleResult = data.location ? { lat: data.location.lat, lng: data.location.lng, accuracy: data.accuracy } : { error: data };
  } catch (e) {
    googleResult = { error: String(e) };
  }

  return Response.json({
    headers: { forwarded, realIp, cfIp },
    detectedIp: ip,
    googleResult,
  });
}
