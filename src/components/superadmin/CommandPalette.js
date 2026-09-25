'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, CornerDownLeft, LoaderCircle, Search, X } from 'lucide-react';
import saApi from '@/lib/saApi';

export default function CommandPalette({ open, onClose, navigation, canSearchRestaurants }) {
  const router = useRouter();
  const inputRef = useRef(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState('');
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setRestaurants([]);
    setError('');
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open || !canSearchRestaurants || query.trim().length < 2) {
      setRestaurants([]);
      setLoading(false);
      return undefined;
    }

    const requestId = ++requestRef.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ search: query.trim(), limit: '6', sortBy: 'name', sortOrder: 'asc' });
        const result = await saApi.getRestaurants(params.toString());
        if (requestRef.current === requestId) setRestaurants(result.restaurants || []);
      } catch (loadError) {
        if (requestRef.current === requestId) setError(loadError.message || 'Search unavailable');
      } finally {
        if (requestRef.current === requestId) setLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [canSearchRestaurants, open, query]);

  const matchingNavigation = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return navigation.slice(0, 7);
    return navigation.filter((item) => `${item.label} ${item.section}`.toLowerCase().includes(normalized)).slice(0, 7);
  }, [navigation, query]);

  if (!open) return null;

  const go = (href) => {
    onClose();
    router.push(href);
  };

  const firstResult = restaurants.length
    ? `/superadmin/restaurants/${restaurants[0].id}`
    : matchingNavigation[0]?.href;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[10vh] backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Control-plane search" className="w-full max-w-2xl overflow-hidden rounded-2xl border border-sa-700 bg-sa-900 shadow-2xl shadow-black/60">
        <form onSubmit={(event) => { event.preventDefault(); if (firstResult) go(firstResult); }} className="flex items-center gap-3 border-b border-sa-800 px-4">
          <Search className="h-5 w-5 text-sa-500" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search restaurants, owners, or control-plane pages…"
            className="h-14 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-sa-500"
            aria-label="Search the control plane"
          />
          {loading && <LoaderCircle className="h-4 w-4 animate-spin text-orange-400" aria-label="Searching" />}
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-sa-500 hover:bg-sa-800 hover:text-white" aria-label="Close search"><X className="h-4 w-4" /></button>
        </form>

        <div className="max-h-[65vh] overflow-y-auto p-2">
          {restaurants.length > 0 && (
            <section aria-labelledby="tenant-results">
              <h2 id="tenant-results" className="px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-sa-500">Restaurants</h2>
              {restaurants.map((restaurant) => (
                <button key={restaurant.id} onClick={() => go(`/superadmin/restaurants/${restaurant.id}`)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-sa-800 focus:bg-sa-800 focus:outline-none">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400"><Building2 className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-white">{restaurant.name}</span><span className="block truncate text-xs text-sa-500">/{restaurant.slug} · {restaurant.owner?.email || 'No active owner'} · {restaurant.subscription?.status || 'No subscription'}</span></span>
                  <span className={restaurant.isActive ? 'text-[10px] font-black uppercase text-emerald-400' : 'text-[10px] font-black uppercase text-red-400'}>{restaurant.isActive ? 'Active' : 'Suspended'}</span>
                </button>
              ))}
            </section>
          )}

          {matchingNavigation.length > 0 && (
            <section aria-labelledby="page-results">
              <h2 id="page-results" className="px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-sa-500">Control plane</h2>
              {matchingNavigation.map((item) => {
                const Icon = item.icon;
                return <button key={item.href} onClick={() => go(item.href)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-sa-800 focus:bg-sa-800 focus:outline-none"><Icon className="h-4 w-4 text-sa-400" /><span className="flex-1 text-sm font-semibold text-sa-200">{item.label}</span><span className="text-xs text-sa-600">{item.section}</span></button>;
              })}
            </section>
          )}

          {!loading && query.trim().length >= 2 && !restaurants.length && !matchingNavigation.length && <div className="p-10 text-center text-sm text-sa-500">No accessible pages or restaurants match “{query.trim()}”.</div>}
          {error && <div role="alert" className="mx-2 my-2 rounded-xl border border-red-900 bg-red-500/10 p-3 text-xs text-red-300">Restaurant search failed. Page navigation is still available.</div>}
        </div>

        <div className="flex items-center justify-between border-t border-sa-800 px-4 py-2 text-[10px] text-sa-500"><span>Results respect your platform permissions</span><span className="flex items-center gap-1"><CornerDownLeft className="h-3 w-3" /> open · Esc close</span></div>
      </div>
    </div>
  );
}
