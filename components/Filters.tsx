'use client';

interface FilterState {
  laptop: boolean;
  wifi: boolean;
  seating: boolean;
}

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

  const btn = (active: boolean) =>
    `px-4 py-2 text-xs font-medium transition-all cursor-pointer select-none whitespace-nowrap ${
      active
        ? 'bg-white/20 text-white'
        : 'text-gray-400 hover:text-gray-200 hover:bg-white/10'
    }`;

  return (
    <div className="inline-flex rounded-full bg-black/60 backdrop-blur-xl border border-white/10 overflow-hidden shadow-lg">
      <button className={`${btn(filters.laptop)} rounded-l-full pl-5`} onClick={() => toggle('laptop')}>
        💻 Laptop friendly
      </button>
      <div className="w-px bg-white/10" />
      <button className={btn(filters.wifi)} onClick={() => toggle('wifi')}>
        📶 Has WiFi
      </button>
      <div className="w-px bg-white/10" />
      <button className={`${btn(filters.seating)} rounded-r-full pr-5`} onClick={() => toggle('seating')}>
        🪑 Has seating
      </button>
    </div>
  );
}
