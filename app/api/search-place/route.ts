const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const lat = parseFloat(searchParams.get('lat') || '');
  const lng = parseFloat(searchParams.get('lng') || '');

  if (!q) {
    return Response.json({ results: [] });
  }

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.photos',
      },
      body: JSON.stringify({
        textQuery: q + ' cafe',
        maxResultCount: 3,
        ...(lat && lng ? {
          locationBias: {
            circle: { center: { latitude: lat, longitude: lng }, radius: 50000 },
          },
        } : {}),
      }),
    });

    if (!res.ok) {
      return Response.json({ results: [] });
    }

    const data = await res.json();
    const cafeTypes = ['cafe', 'restaurant', 'food', 'establishment'];
    const results = (data.places || [])
      .filter((p: { types?: string[] }) =>
        p.types?.some((t: string) => cafeTypes.includes(t))
      )
      .map((p: { id: string; displayName?: { text: string }; formattedAddress?: string; location?: { latitude: number; longitude: number }; rating?: number; photos?: { name: string }[] }) => ({
        place_id: p.id,
        name: p.displayName?.text || 'Unknown',
        address: p.formattedAddress || null,
        lat: p.location?.latitude || 0,
        lng: p.location?.longitude || 0,
        rating: p.rating ?? null,
        photo_name: p.photos?.[0]?.name || null,
      }));

    return Response.json({ results });
  } catch {
    return Response.json({ results: [] });
  }
}
