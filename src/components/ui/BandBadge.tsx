export function bandColor(band: number): string {
  if (band >= 7.5) return "bg-emerald-100 text-emerald-800";
  if (band >= 6.5) return "bg-green-100 text-green-800";
  if (band >= 5.5) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-700";
}

export function BandBadge({ band, className = "" }: { band: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold ${bandColor(band)} ${className}`}
    >
      {band.toFixed(1)}
    </span>
  );
}
