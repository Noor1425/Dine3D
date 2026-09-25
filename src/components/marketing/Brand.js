/**
 * The Dine3D mark, drawn rather than shipped as an image.
 *
 * The supplied PNG carries a white background and the wordmark baked in, which
 * neither sits on a dark nav nor scales. Redrawing the cube as a vector keeps
 * the identity — plate on top, fork on one face, QR on the other — while
 * staying transparent, crisp at any size and under a kilobyte.
 *
 * The raster original is still the favicon and the app icon, where a fixed
 * square on a white ground is exactly right.
 */
export function DineMark({ className = 'h-8 w-8', title }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      {/* Right face — the QR side */}
      <path d="M32 34 L60 19 V45 L32 60 Z" fill="#1E2227" />
      {/* Left face — the fork side */}
      <path d="M4 19 L32 34 V60 L4 45 Z" fill="#14171A" />
      {/* Top face — the plate */}
      <path d="M32 4 L60 19 L32 34 L4 19 Z" fill="#FF6B35" />

      {/* The plate: a white rim with the orange face showing through */}
      <ellipse cx="32" cy="19" rx="13" ry="7.2" fill="#FFFFFF" />
      <ellipse cx="32" cy="19" rx="8.6" ry="4.5" fill="#FF6B35" />

      {/* Fork, sheared onto the left face */}
      <g fill="#FFFFFF" transform="translate(9 25) skewY(28) scale(1.18)">
        <rect x="0.6" y="0" width="1.7" height="9" rx="0.85" />
        <rect x="4" y="0" width="1.7" height="9" rx="0.85" />
        <rect x="7.4" y="0" width="1.7" height="9" rx="0.85" />
        <path d="M0.6 8.4 h8.5 v2.2 a4.25 4.25 0 0 1 -4.25 4.25 a4.25 4.25 0 0 1 -4.25 -4.25 Z" />
        <rect x="3.9" y="13" width="1.9" height="12" rx="0.95" />
      </g>

      {/* QR, sheared onto the right face */}
      <g transform="translate(37 23) skewY(-28) scale(1.12)">
        <g fill="#FFFFFF">
          <rect x="0" y="0" width="7" height="7" rx="1.2" />
          <rect x="11.5" y="0" width="7" height="7" rx="1.2" />
          <rect x="0" y="11.5" width="7" height="7" rx="1.2" />
          <rect x="13.5" y="11.5" width="4" height="4" rx="0.9" />
          <rect x="11.5" y="17" width="3.4" height="3.4" rx="0.8" />
        </g>
        <g fill="#1E2227">
          <rect x="2.1" y="2.1" width="2.8" height="2.8" rx="0.5" />
          <rect x="13.6" y="2.1" width="2.8" height="2.8" rx="0.5" />
          <rect x="2.1" y="13.6" width="2.8" height="2.8" rx="0.5" />
        </g>
        <rect x="8.4" y="8.6" width="3.6" height="3.6" rx="0.8" fill="#FF6B35" />
      </g>
    </svg>
  );
}

/** Mark plus wordmark, for the nav and the footer. */
export function DineLogo({ className = '', markClass = 'h-8 w-8', textClass = 'text-xl md:text-2xl' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <DineMark className={markClass} title="Dine3D" />
      <span className={`font-extrabold tracking-tighter text-white ${textClass}`}>Dine3D</span>
    </span>
  );
}
