import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  const body = await request.json();
  const { cafe_id, laptop_allowed, wifi_rating, seating_rating, notes } = body;

  if (!cafe_id) {
    return Response.json({ error: 'cafe_id required' }, { status: 400 });
  }

  const { error: insertError } = await supabase
    .from('submissions')
    .insert({
      cafe_id,
      laptop_allowed: laptop_allowed ?? null,
      wifi_rating: wifi_rating ?? null,
      seating_rating: seating_rating ?? null,
      notes: notes || null,
    });

  if (insertError) {
    console.error('Submission insert error:', insertError);
    return Response.json({ error: 'Failed to submit' }, { status: 500 });
  }

  // Check if 3+ submissions agree on laptop_allowed
  const { data: submissions } = await supabase
    .from('submissions')
    .select('laptop_allowed')
    .eq('cafe_id', cafe_id)
    .not('laptop_allowed', 'is', null);

  if (submissions && submissions.length >= 3) {
    const yesCount = submissions.filter((s) => s.laptop_allowed === true).length;
    const noCount = submissions.filter((s) => s.laptop_allowed === false).length;

    if (yesCount >= 3) {
      await supabase
        .from('cafes')
        .update({ laptop_allowed: true, confidence: 'verified' })
        .eq('id', cafe_id);
    } else if (noCount >= 3) {
      await supabase
        .from('cafes')
        .update({ laptop_allowed: false, confidence: 'verified' })
        .eq('id', cafe_id);
    }
  }

  return Response.json({ success: true });
}
