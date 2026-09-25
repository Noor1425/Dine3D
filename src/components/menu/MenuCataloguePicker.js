'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';

/**
 * Build a menu by picking from the shared catalogue.
 *
 * A restaurant's first evening on a new till is spent typing dishes it has sold
 * for years, inventing a description for each one. This offers those dishes
 * already written — name, description and a price close enough to edit — so the
 * job becomes reading and ticking rather than typing.
 *
 * What it creates is an ordinary menu item. The values are copied on the way
 * in; nothing links back to the catalogue, so anything changed afterwards is
 * the restaurant's own and a later catalogue edit never reaches a live menu.
 *
 * The catalogue is fetched once per tab and filtered here. It is the same for
 * every restaurant and only changes when the platform publishes a dish, so a
 * round trip per keystroke would be slower and no more correct.
 */

let cached = null;
let inFlight = null;

const loadCatalogue = (force = false) => {
  if (force) { cached = null; inFlight = null; }
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = api.getMenuTemplates()
      .then((data) => { cached = data; return cached; })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
};

const money = (value) => `Rs ${Number(value).toLocaleString('en-PK')}`;

export default function MenuCataloguePicker({ onClose, onAdded }) {
  const [data, setData] = useState(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [cuisine, setCuisine] = useState('All');
  const [picked, setPicked] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const search = useRef(null);

  useEffect(() => {
    let active = true;
    loadCatalogue()
      .then((result) => { if (active) { setData(result); setLoading(false); } })
      .catch((problem) => { if (active) { setError(problem.message || 'The dish catalogue could not be loaded'); setLoading(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => { search.current?.focus(); }, [loading]);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !saving) onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const templates = data?.templates || [];
  const onMenu = useMemo(() => new Set(data?.alreadyOnMenu || []), [data]);

  const cuisines = useMemo(
    () => ['All', ...Array.from(new Set(templates.map((dish) => dish.cuisine)))],
    [templates],
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return templates.filter((dish) => {
      if (cuisine !== 'All' && dish.cuisine !== cuisine) return false;
      if (!term) return true;
      return `${dish.name} ${dish.description || ''} ${dish.category} ${(dish.tags || []).join(' ')}`
        .toLowerCase().includes(term);
    });
  }, [templates, query, cuisine]);

  const grouped = useMemo(() => {
    const groups = new Map();
    visible.forEach((dish) => {
      if (!groups.has(dish.category)) groups.set(dish.category, []);
      groups.get(dish.category).push(dish);
    });
    return Array.from(groups.entries());
  }, [visible]);

  const toggle = (id) => setPicked((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const pickAllVisible = () => {
    const addable = visible.filter((dish) => !onMenu.has(dish.name.trim().toLowerCase()));
    const everyOne = addable.every((dish) => picked.has(dish.id));
    setPicked((previous) => {
      const next = new Set(previous);
      addable.forEach((dish) => (everyOne ? next.delete(dish.id) : next.add(dish.id)));
      return next;
    });
  };

  const total = useMemo(() => templates
    .filter((dish) => picked.has(dish.id))
    .reduce((sum, dish) => sum + Number(dish.suggestedPrice), 0), [templates, picked]);

  const add = async () => {
    if (!picked.size) return;
    setSaving(true);
    try {
      const result = await api.applyMenuTemplates([...picked]);
      toast.success(result.message || 'Added to your menu');
      // The catalogue now knows more dishes are on the menu.
      await loadCatalogue(true);
      onAdded?.(result);
      onClose?.();
    } catch (problem) {
      // A plan ceiling refuses the whole batch and names the plan that fits.
      toast.error(problem.message || 'Those dishes could not be added');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="catalogue-backdrop" role="dialog" aria-modal="true" aria-label="Add dishes from the catalogue">
      <div className="catalogue-panel">
        <header className="catalogue-head">
          <div>
            <div className="catalogue-title">Add from our dish catalogue</div>
            <div className="form-hint">
              Pick what you sell. Names, descriptions and prices come with it — change any of them afterwards.
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>Close</button>
        </header>

        <div className="catalogue-controls">
          <input
            ref={search}
            className="input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search — biryani, karahi, burger, chowmein…"
          />
          <div className="catalogue-cuisines">
            {cuisines.map((name) => (
              <button
                key={name}
                type="button"
                className={`catalogue-chip${cuisine === name ? ' is-active' : ''}`}
                onClick={() => setCuisine(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className="catalogue-body">
          {loading ? (
            <div className="catalogue-grid">
              {Array.from({ length: 9 }).map((_, index) => <div key={index} className="catalogue-card is-loading" />)}
            </div>
          ) : error ? (
            <div className="form-hint" role="alert">{error}</div>
          ) : visible.length === 0 ? (
            <div className="form-hint">Nothing matches that. Try a different dish, or add it yourself.</div>
          ) : (
            grouped.map(([category, dishes]) => (
              <section key={category} className="catalogue-group">
                <div className="catalogue-group-head">
                  <span>{category}</span>
                  <span className="catalogue-group-count">{dishes.length}</span>
                </div>
                <div className="catalogue-grid">
                  {dishes.map((dish) => {
                    const already = onMenu.has(dish.name.trim().toLowerCase());
                    const selected = picked.has(dish.id);
                    return (
                      <button
                        key={dish.id}
                        type="button"
                        disabled={already}
                        aria-pressed={selected}
                        onClick={() => toggle(dish.id)}
                        className={`catalogue-card${selected ? ' is-selected' : ''}${already ? ' is-on-menu' : ''}`}
                      >
                        <span className="catalogue-thumb">
                          {dish.imageUrl
                            ? <img src={dish.imageUrl} alt="" loading="lazy" />
                            : <span className="catalogue-thumb-empty" aria-hidden="true">🍽</span>}
                        </span>
                        <span className="catalogue-card-body">
                          <span className="catalogue-name">{dish.name}</span>
                          <span className="catalogue-desc">{dish.description}</span>
                          <span className="catalogue-price">{money(dish.suggestedPrice)}</span>
                        </span>
                        {already && <span className="catalogue-badge">On your menu</span>}
                        {selected && !already && <span className="catalogue-tick" aria-hidden="true">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        <footer className="catalogue-foot">
          <button type="button" className="btn btn-secondary btn-sm" onClick={pickAllVisible} disabled={loading || saving || !visible.length}>
            Select all shown
          </button>
          <div className="catalogue-summary">
            {picked.size
              ? <><strong>{picked.size}</strong> selected · menu value {money(total)}</>
              : 'Nothing selected yet'}
          </div>
          <button type="button" className="btn btn-primary" onClick={add} disabled={!picked.size || saving}>
            {saving ? 'Adding…' : `Add ${picked.size || ''} to my menu`.trim()}
          </button>
        </footer>
      </div>
    </div>
  );
}
