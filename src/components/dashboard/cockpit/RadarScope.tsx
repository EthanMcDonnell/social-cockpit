/**
 * Small radar-scope mark beside the wordmark. Two concentric rings, a rotating
 * amber sweep wedge, and a stray contact blip. Pure SVG + CSS animation.
 */
export function RadarScope() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <defs>
        <linearGradient id="ck-sweep-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFB324" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FFB324" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="17" cy="17" r="14" fill="none" stroke="#3B3730" strokeWidth="1" />
      <circle cx="17" cy="17" r="9" fill="none" stroke="#3B3730" strokeWidth="1" />
      <g className="ck-sweep">
        <path d="M17,17 L17,3 A14,14 0 0 1 26.9,6.9 Z" fill="url(#ck-sweep-grad)" />
        <line x1="17" y1="17" x2="17" y2="3" stroke="#FFB324" strokeWidth="1.2" />
      </g>
      <circle cx="22" cy="12" r="1.1" fill="#FFC72E" />
    </svg>
  );
}
