'use client';

interface FilterState {
  laptop: boolean;
  wifi: boolean;
  seating: boolean;
}

const chipStyle = (active: boolean): React.CSSProperties => ({
  background: active ? '#1a73e8' : '#fff',
  color: active ? '#fff' : '#333',
  borderRadius: 20,
  padding: '8px 16px',
  fontSize: 14,
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
  transition: 'background 0.15s, color 0.15s',
});

export default function Filters({
  filters,
  onChange,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
}) {
  const toggle = (key: keyof FilterState) => {
    onChange({ ...filters, [key]: !filters[key] });
  };

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
      <button style={chipStyle(filters.laptop)} onClick={() => toggle('laptop')}>
        💻 Laptop friendly
      </button>
      <button style={chipStyle(filters.wifi)} onClick={() => toggle('wifi')}>
        📶 Has WiFi
      </button>
      <button style={chipStyle(filters.seating)} onClick={() => toggle('seating')}>
        🪑 Has seating
      </button>
    </div>
  );
}
