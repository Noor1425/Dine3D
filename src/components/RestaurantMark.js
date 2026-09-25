'use client';
import { useState } from 'react';

/**
 * The restaurant's own logo, small, where it can be seen without being in the way.
 *
 * A till and a dashboard that say "Dine3D" everywhere and nothing about the
 * restaurant feel like somebody else's software being borrowed. This is the
 * cheapest possible correction: the mark the owner already uploaded, shown
 * beside their own name.
 *
 * Three things it has to get right, because it renders on every page of the
 * backoffice and on the till all day:
 *
 *  - No logo is the normal case. A restaurant that has not uploaded one gets
 *    its initials rather than a broken frame or an empty hole.
 *  - A logo whose file has gone — deleted, or a restore that missed the uploads
 *    directory — must fall back to the same initials rather than show the
 *    browser's broken-image icon on the POS during service.
 *  - The box is the same size either way, so nothing on the page moves when the
 *    image arrives.
 */

const initialsOf = (name) => String(name || '')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((word) => word[0])
  .join('')
  .toUpperCase() || '·';

export default function RestaurantMark({ restaurant, size = 32, className = '', rounded = 'rounded-lg' }) {
  const [broken, setBroken] = useState(false);
  if (!restaurant) return null;

  const showImage = Boolean(restaurant.logo) && !broken;
  const box = { width: size, height: size };

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden ${rounded} border border-black/5 bg-[var(--color-bg-muted,#F3F4F6)] ${className}`}
      style={box}
      aria-hidden="true"
      title={restaurant.name || undefined}
    >
      {showImage ? (
        <img
          src={restaurant.logo}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          // The file can be gone while the row still names it.
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          className="font-black leading-none text-[var(--color-text-muted,#6B7280)]"
          style={{ fontSize: Math.max(10, Math.round(size * 0.36)) }}
        >
          {initialsOf(restaurant.name)}
        </span>
      )}
    </span>
  );
}

export { initialsOf };
