const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY!;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name');

  if (!name) {
    return new Response('Missing name parameter', { status: 400 });
  }

  try {
    const url = `https://places.googleapis.com/v1/${name}/media?maxHeightPx=300&maxWidthPx=400&key=${GOOGLE_PLACES_API_KEY}`;
    const res = await fetch(url);

    if (!res.ok) {
      return new Response('Photo not found', { status: 404 });
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = await res.arrayBuffer();

    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new Response('Failed to fetch photo', { status: 500 });
  }
}
