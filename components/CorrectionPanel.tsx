'use client';

import { useState } from 'react';
import { Cafe } from '@/lib/types';

export default function CorrectionPanel({
  cafe,
  onClose,
  onSubmitted,
  onUpdate,
  darkMode = false,
}: {
  cafe: Cafe;
  onClose: () => void;
  onSubmitted: (updates: { laptop_allowed?: boolean | null; wifi_rating?: number | null; seating_rating?: number | null }) => void;
  onUpdate: (updates: { laptop_allowed?: boolean | null; wifi_rating?: number | null; seating_rating?: number | null; notes?: string }) => void;
  darkMode?: boolean;
}) {
  const [laptopAllowed, setLaptopAllowed] = useState<boolean | null>(null);
  const [wifiRating, setWifiRating] = useState<number | null>(null);
  const [seatingRating, setSeatingRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const d = darkMode;

  const submit = async () => {
    setSubmitting(true);

    // Optimistic update — instantly change marker color + popup content
    const updates: { laptop_allowed?: boolean | null; wifi_rating?: number | null; seating_rating?: number | null; notes?: string } = {};
    if (laptopAllowed !== null) updates.laptop_allowed = laptopAllowed;
    if (wifiRating !== null) updates.wifi_rating = wifiRating;
    if (seatingRating !== null) updates.seating_rating = seatingRating;
    if (notes) updates.notes = notes;
    onUpdate(updates);

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
      onSubmitted(updates);

      // Close panel after 3 seconds — popup stays open
      setTimeout(onClose, 3000);
    } catch {
      setSubmitting(false);
    }
  };

  const laptopBtn = (label: string, value: boolean | null) => {
    const active = laptopAllowed === value;
    return (
      <button
        onClick={() => setLaptopAllowed(value)}
        style={{
          flex: 1,
          padding: '10px 0',
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 500,
          transition: 'all 0.15s',
          cursor: 'pointer',
          background: active ? '#1a73e8' : (d ? '#2a2a2a' : '#f5f5f5'),
          color: active ? '#fff' : (d ? '#ccc' : '#333'),
          border: active ? '1px solid #1a73e8' : `1px solid ${d ? '#444' : '#e0e0e0'}`,
        }}
      >
        {label}
      </button>
    );
  };

  const starRow = (
    label: string,
    value: number | null,
    setter: (n: number | null) => void
  ) => (
    <div>
      <label style={{ fontSize: 13, color: d ? '#9ca3af' : '#666', display: 'block', marginBottom: 8 }}>{label}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value != null && n <= value;
          return (
            <button
              key={n}
              onClick={() => setter(value === n ? null : n)}
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                fontSize: 16,
                cursor: 'pointer',
                transition: 'all 0.15s',
                background: active ? '#fbbf24' : (d ? '#2a2a2a' : '#f5f5f5'),
                color: active ? (d ? '#000' : '#fff') : (d ? '#666' : '#999'),
                border: active ? '1px solid #f59e0b' : `1px solid ${d ? '#444' : '#e0e0e0'}`,
              }}
            >
              ★
            </button>
          );
        })}
      </div>
    </div>
  );

  if (success) {
    return (
      <div
        className="absolute bottom-0 left-0 right-0 z-20 animate-slide-up"
        style={{ background: d ? '#1a1a1a' : '#fff', borderTop: `1px solid ${d ? '#333' : '#e8e8e8'}`, padding: 24 }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, marginBottom: 8, color: '#16a34a' }}>✓</div>
          <div style={{ fontWeight: 500, color: d ? '#fff' : '#1a1a1a' }}>Thanks for your contribution!</div>
          <div style={{ fontSize: 14, color: d ? '#9ca3af' : '#666', marginTop: 4 }}>Your feedback helps other nomads.</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="absolute inset-0 z-10"
        style={{ background: d ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.2)' }}
        onClick={onClose}
      />
      <div
        className="absolute bottom-0 left-0 right-0 z-20 rounded-t-2xl animate-slide-up"
        style={{
          background: d ? '#1a1a1a' : '#fff',
          borderTop: `1px solid ${d ? '#333' : '#e8e8e8'}`,
          padding: 24,
          maxHeight: '70vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h3 style={{ fontWeight: 700, fontSize: 18, color: d ? '#fff' : '#1a1a1a', margin: 0 }}>Suggest a correction</h3>
            <p style={{ fontSize: 13, color: d ? '#9ca3af' : '#666', marginTop: 4 }}>{cafe.name}</p>
          </div>
          <button
            onClick={onClose}
            style={{ fontSize: 22, lineHeight: 1, color: d ? '#9ca3af' : '#666', cursor: 'pointer', background: 'none', border: 'none', padding: '4px 8px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = d ? '#fff' : '#333'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = d ? '#9ca3af' : '#666'; }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label style={{ fontSize: 13, color: d ? '#9ca3af' : '#666', display: 'block', marginBottom: 8 }}>Laptop allowed?</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {laptopBtn('Yes', true)}
              {laptopBtn('No', false)}
              {laptopBtn('Not sure', null)}
            </div>
          </div>

          {starRow('WiFi rating', wifiRating, setWifiRating)}
          {starRow('Seating rating', seatingRating, setSeatingRating)}

          <div>
            <label style={{ fontSize: 13, color: d ? '#9ca3af' : '#666', display: 'block', marginBottom: 8 }}>Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything else to share…"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                background: d ? '#2a2a2a' : '#f5f5f5',
                border: `1px solid ${d ? '#444' : '#e0e0e0'}`,
                color: d ? '#e5e7eb' : '#333',
                fontSize: 14,
                outline: 'none',
                resize: 'none',
              }}
            />
          </div>

          <button
            onClick={submit}
            disabled={submitting}
            style={{
              width: '100%',
              padding: '12px 0',
              borderRadius: 12,
              background: '#1a73e8',
              color: '#fff',
              fontSize: 16,
              fontWeight: 500,
              border: 'none',
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.5 : 1,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { if (!submitting) e.currentTarget.style.background = '#1557b0'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#1a73e8'; }}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </>
  );
}
