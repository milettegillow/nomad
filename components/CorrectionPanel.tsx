'use client';

import { useState } from 'react';
import { Cafe } from '@/lib/types';

export default function CorrectionPanel({
  cafe,
  onClose,
  onSubmitted,
}: {
  cafe: Cafe;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [laptopAllowed, setLaptopAllowed] = useState<boolean | null>(null);
  const [wifiRating, setWifiRating] = useState<number | null>(null);
  const [seatingRating, setSeatingRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cafe_id: cafe.id,
          laptop_allowed: laptopAllowed,
          wifi_rating: wifiRating,
          seating_rating: seatingRating,
          notes: notes || null,
        }),
      });
      setSuccess(true);
      setTimeout(onSubmitted, 1200);
    } catch {
      setSubmitting(false);
    }
  };

  const laptopBtn = (label: string, value: boolean | null) => (
    <button
      onClick={() => setLaptopAllowed(value)}
      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
        laptopAllowed === value
          ? 'bg-white/20 text-white border border-white/30'
          : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );

  const starRow = (
    label: string,
    value: number | null,
    setter: (n: number | null) => void
  ) => (
    <div>
      <label className="text-xs text-gray-400 mb-1.5 block">{label}</label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => setter(value === n ? null : n)}
            className={`w-9 h-9 rounded-lg text-sm transition-all ${
              value != null && n <= value
                ? 'bg-yellow-500/30 text-yellow-400 border border-yellow-500/40'
                : 'bg-white/5 text-gray-500 border border-white/10 hover:bg-white/10'
            }`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );

  if (success) {
    return (
      <div className="absolute bottom-0 left-0 right-0 z-20 bg-black/80 backdrop-blur-xl border-t border-white/10 p-6 animate-slide-up">
        <div className="text-center">
          <div className="text-2xl mb-2">✓</div>
          <div className="text-white font-medium">Thanks for your contribution!</div>
          <div className="text-gray-400 text-sm mt-1">Your feedback helps other nomads.</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="absolute inset-0 z-10 bg-black/40" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 z-20 bg-black/80 backdrop-blur-xl border-t border-white/10 rounded-t-2xl p-5 animate-slide-up max-h-[70vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-white font-semibold text-base">Suggest a correction</h3>
            <p className="text-gray-400 text-xs mt-0.5">{cafe.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors text-xl leading-none">
            ×
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">Laptop allowed?</label>
            <div className="flex gap-2">
              {laptopBtn('Yes', true)}
              {laptopBtn('No', false)}
              {laptopBtn('Not sure', null)}
            </div>
          </div>

          {starRow('WiFi rating', wifiRating, setWifiRating)}
          {starRow('Seating rating', seatingRating, setSeatingRating)}

          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500 outline-none focus:border-white/25 resize-none"
              placeholder="Anything else to share…"
            />
          </div>

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-2.5 rounded-xl bg-white/15 text-white font-medium text-sm hover:bg-white/25 transition-all disabled:opacity-50 border border-white/10"
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </>
  );
}
