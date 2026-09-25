'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import api from '@/lib/api';

/**
 * Pick a food photograph from the shared library.
 *
 * The library is fetched once per browser session and held in a module-level
 * cache: it is small, it is the same for every restaurant, and it only changes
 * when the platform publishes a picture. Opening the picker a second time
 * costs nothing.
 *
 * Nothing here is ever reached from the POS. A menu item stores a plain URL;
 * the till renders it like any other image, out of its own cache, with no
 * knowledge that a library exists.
 */

// Shared across every mount for the life of the tab.
let cachedImages = null;
let inFlight = null;

const loadLibrary = () => {
  if (cachedImages) return Promise.resolve(cachedImages);
  if (!inFlight) {
    inFlight = api.getStockImages()
      .then((data) => {
        cachedImages = data?.images || [];
        return cachedImages;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
};

export default function StockImagePicker({ value, onChange, onClose }) {
  const [images, setImages] = useState(cachedImages || []);
  const [loading, setLoading] = useState(!cachedImages);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const searchInput = useRef(null);

  useEffect(() => {
    let active = true;
    loadLibrary()
      .then((list) => { if (active) { setImages(list); setLoading(false); } })
      .catch((problem) => { if (active) { setError(problem.message || 'The picture library could not be loaded'); setLoading(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => { searchInput.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Filtering happens here rather than on the server: the whole library is
  // already in hand, and a round trip per keystroke would be slower and worse.
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return images;
    return images.filter((image) => `${image.name} ${image.category || ''} ${(image.tags || []).join(' ')}`
      .toLowerCase().includes(term));
  }, [images, query]);

  const grouped = useMemo(() => {
    const groups = new Map();
    visible.forEach((image) => {
      const key = image.category || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(image);
    });
    return Array.from(groups.entries());
  }, [visible]);

  return (
    <div className="stock-picker" role="dialog" aria-label="Choose a food picture">
      <input
        ref={searchInput}
        className="input"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search pictures — biryani, burger, fries…"
      />

      {loading ? (
        <div className="stock-picker-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="stock-picker-tile stock-picker-tile--loading" />
          ))}
        </div>
      ) : error ? (
        <div className="form-hint" role="alert">{error}</div>
      ) : visible.length === 0 ? (
        <div className="form-hint">
          {query ? 'No picture matches that. Upload your own instead.' : 'No pictures have been published yet.'}
        </div>
      ) : (
        grouped.map(([category, items]) => (
          <div key={category} className="stock-picker-group">
            <div className="stock-picker-group-title">{category}</div>
            <div className="stock-picker-grid">
              {items.map((image) => {
                const selected = value === image.url;
                return (
                  <button
                    key={image.id}
                    type="button"
                    aria-pressed={selected}
                    title={image.name}
                    onClick={() => onChange(selected ? null : image.url)}
                    className={`stock-picker-tile${selected ? ' is-selected' : ''}`}
                  >
                    <img src={image.url} alt={image.name} loading="lazy" />
                    <span className="stock-picker-tile-name">{image.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
