'use client';
import { useState, useEffect, useMemo } from 'react';
import saApi from '@/lib/saApi';
import { toast } from 'sonner';
import { useSuperAdminAccess } from '@/components/superadmin/SuperAdminAccessContext';
import { UtensilsCrossed, Search, Plus, Trash2, Loader2, ImageOff, Check, X } from 'lucide-react';

/**
 * The shared dish catalogue.
 *
 * Dishes here are offered to every restaurant building a menu — name,
 * description and a suggested price they can edit. Changing one changes what
 * the next restaurant is offered and nothing else: a dish is copied onto a menu
 * when it is chosen, so no menu already built can be disturbed from here.
 *
 * The count on each row is how many restaurants have that dish, matched by
 * name. It is the only trace a copy leaves, which is the point of copying.
 */

const money = (value) => `Rs ${Number(value).toLocaleString('en-PK')}`;

export default function MenuCataloguePage() {
  const { can } = useSuperAdminAccess();
  const mayEdit = can('settings.manage');

  const [templates, setTemplates] = useState([]);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [cuisine, setCuisine] = useState('All');
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [adding, setAdding] = useState(false);
  const [newDish, setNewDish] = useState({ name: '', description: '', category: '', cuisine: 'Desi', suggestedPrice: '' });

  const load = async () => {
    setLoading(true);
    try {
      const [catalogue, library] = await Promise.all([
        saApi.getMenuTemplates(),
        saApi.getStockImages().catch(() => ({ images: [] })),
      ]);
      setTemplates(catalogue?.templates || []);
      setImages(library?.images || []);
    } catch (error) {
      toast.error(error.message || 'The dish catalogue could not be loaded');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const cuisines = useMemo(
    () => ['All', ...Array.from(new Set(templates.map((dish) => dish.cuisine)))],
    [templates],
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return templates.filter((dish) => {
      if (cuisine !== 'All' && dish.cuisine !== cuisine) return false;
      if (!term) return true;
      return `${dish.name} ${dish.description || ''} ${dish.category}`.toLowerCase().includes(term);
    });
  }, [templates, query, cuisine]);

  const startEdit = (dish) => {
    setEditing(dish.id);
    setDraft({
      description: dish.description || '',
      suggestedPrice: dish.suggestedPrice,
      category: dish.category,
      cuisine: dish.cuisine,
      stockImageId: dish.stockImageId || '',
    });
  };

  const save = async (id) => {
    setBusyId(id);
    try {
      const result = await saApi.updateMenuTemplate(id, { ...draft, stockImageId: draft.stockImageId || null });
      setTemplates((previous) => previous.map((dish) => (dish.id === id
        ? { ...dish, ...result.template, usedByRestaurants: dish.usedByRestaurants }
        : dish)));
      setEditing(null);
      toast.success('Dish updated');
    } catch (error) {
      toast.error(error.message || 'That dish could not be updated');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (dish) => {
    const warning = dish.usedByRestaurants > 0
      ? `${dish.usedByRestaurants} restaurant${dish.usedByRestaurants === 1 ? '' : 's'} already have this on their menu. Those copies are unaffected — remove it from the catalogue?`
      : `Remove ${dish.name} from the catalogue?`;
    if (!window.confirm(warning)) return;

    setBusyId(dish.id);
    try {
      await saApi.deleteMenuTemplate(dish.id);
      setTemplates((previous) => previous.filter((row) => row.id !== dish.id));
      toast.success(`${dish.name} removed`);
    } catch (error) {
      toast.error(error.message || 'That dish could not be removed');
    } finally {
      setBusyId(null);
    }
  };

  const create = async (event) => {
    event.preventDefault();
    if (!newDish.name.trim()) return toast.error('Give the dish a name');
    if (!Number(newDish.suggestedPrice)) return toast.error('Give the dish a suggested price');

    setBusyId('new');
    try {
      const result = await saApi.createMenuTemplate(newDish);
      setTemplates((previous) => [...previous, result.template]);
      setNewDish({ name: '', description: '', category: '', cuisine: 'Desi', suggestedPrice: '' });
      setAdding(false);
      toast.success(`${result.template.name} added to the catalogue`);
    } catch (error) {
      toast.error(error.message || 'That dish could not be added');
    } finally {
      setBusyId(null);
    }
  };

  const withoutPicture = templates.filter((dish) => !dish.imageUrl).length;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black">
            <UtensilsCrossed className="h-6 w-6 text-brand-500" />
            Dish catalogue
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-sa-500">
            Offered to every restaurant building a menu. A restaurant picks a dish and gets its
            name, description, price and picture — then edits whatever it disagrees with.
            Changing a dish here never touches a menu already built.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="rounded-xl border border-sa-800 px-4 py-2 text-xs">
            <div className="text-lg font-black tabular-nums">{templates.length}</div>
            <div className="text-sa-500">dishes</div>
          </div>
          <div className="rounded-xl border border-sa-800 px-4 py-2 text-xs">
            <div className="text-lg font-black tabular-nums text-amber-400">{withoutPicture}</div>
            <div className="text-sa-500">need a picture</div>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sa-600" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search dishes"
            className="w-full rounded-xl border border-sa-800 bg-sa-950 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-500"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {cuisines.map((name) => (
            <button
              key={name}
              onClick={() => setCuisine(name)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                cuisine === name ? 'border-brand-500 bg-brand-500 text-sa-950' : 'border-sa-800 text-sa-400 hover:bg-sa-900'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
        {mayEdit && (
          <button
            onClick={() => setAdding((open) => !open)}
            className="flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-black text-sa-950 hover:bg-brand-400"
          >
            <Plus className="h-4 w-4" /> Add a dish
          </button>
        )}
      </div>

      {adding && mayEdit && (
        <form onSubmit={create} className="grid gap-3 rounded-2xl border border-sa-800 bg-sa-900/40 p-4 sm:grid-cols-6">
          <input value={newDish.name} onChange={(e) => setNewDish({ ...newDish, name: e.target.value })}
            placeholder="Dish name" className="rounded-xl border border-sa-800 bg-sa-950 px-3 py-2.5 text-sm outline-none focus:border-brand-500 sm:col-span-2" />
          <input value={newDish.category} onChange={(e) => setNewDish({ ...newDish, category: e.target.value })}
            placeholder="Section (Rice, BBQ…)" className="rounded-xl border border-sa-800 bg-sa-950 px-3 py-2.5 text-sm outline-none focus:border-brand-500" />
          <select value={newDish.cuisine} onChange={(e) => setNewDish({ ...newDish, cuisine: e.target.value })}
            className="rounded-xl border border-sa-800 bg-sa-950 px-3 py-2.5 text-sm outline-none focus:border-brand-500">
            {['Desi', 'Fast Food', 'Chinese', 'Beverages', 'Dessert'].map((c) => <option key={c}>{c}</option>)}
          </select>
          <input value={newDish.suggestedPrice} onChange={(e) => setNewDish({ ...newDish, suggestedPrice: e.target.value })}
            placeholder="Price (Rs)" inputMode="numeric" className="rounded-xl border border-sa-800 bg-sa-950 px-3 py-2.5 text-sm tabular-nums outline-none focus:border-brand-500" />
          <button type="submit" disabled={busyId === 'new'}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-black text-sa-950 disabled:opacity-50">
            {busyId === 'new' && <Loader2 className="h-4 w-4 animate-spin" />} Add
          </button>
          <input value={newDish.description} onChange={(e) => setNewDish({ ...newDish, description: e.target.value })}
            placeholder="One line a customer reads — what is in it, how it is served"
            className="rounded-xl border border-sa-800 bg-sa-950 px-3 py-2.5 text-sm outline-none focus:border-brand-500 sm:col-span-6" />
        </form>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-xl border border-sa-800 bg-sa-900/40" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-sa-800 p-12 text-center">
          <UtensilsCrossed className="mx-auto h-8 w-8 text-sa-700" />
          <div className="mt-3 font-bold">{query ? 'Nothing matches that' : 'The catalogue is empty'}</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-sa-800">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-sa-950/40 text-[10px] uppercase tracking-widest text-sa-600">
              <tr>
                <th className="p-3">Dish</th>
                <th className="p-3">Section</th>
                <th className="p-3">Cuisine</th>
                <th className="p-3">Suggested</th>
                <th className="p-3">On menus</th>
                {mayEdit && <th className="p-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-sa-800">
              {visible.map((dish) => {
                const isEditing = editing === dish.id;
                return (
                  <tr key={dish.id} className="align-top">
                    <td className="p-3">
                      <div className="flex gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sa-900">
                          {dish.imageUrl
                            ? <img src={dish.imageUrl} alt="" className="h-full w-full object-cover" />
                            : <ImageOff className="h-4 w-4 text-sa-700" />}
                        </span>
                        <div className="min-w-0">
                          <div className="font-bold">{dish.name}</div>
                          {isEditing ? (
                            <textarea
                              value={draft.description}
                              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                              rows={2}
                              className="mt-1 w-full rounded-lg border border-sa-800 bg-sa-950 px-2 py-1.5 text-xs outline-none focus:border-brand-500"
                            />
                          ) : (
                            <div className="mt-0.5 line-clamp-2 text-xs text-sa-500">{dish.description}</div>
                          )}
                          {isEditing && (
                            <select
                              value={draft.stockImageId}
                              onChange={(e) => setDraft({ ...draft, stockImageId: e.target.value })}
                              className="mt-2 w-full rounded-lg border border-sa-800 bg-sa-950 px-2 py-1.5 text-xs outline-none focus:border-brand-500"
                            >
                              <option value="">No picture</option>
                              {images.map((image) => <option key={image.id} value={image.id}>{image.name}</option>)}
                            </select>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-sa-400">
                      {isEditing
                        ? <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                            className="w-28 rounded-lg border border-sa-800 bg-sa-950 px-2 py-1.5 text-xs outline-none focus:border-brand-500" />
                        : dish.category}
                    </td>
                    <td className="p-3 text-sa-400">{dish.cuisine}</td>
                    <td className="p-3 tabular-nums">
                      {isEditing
                        ? <input value={draft.suggestedPrice} inputMode="numeric"
                            onChange={(e) => setDraft({ ...draft, suggestedPrice: e.target.value })}
                            className="w-24 rounded-lg border border-sa-800 bg-sa-950 px-2 py-1.5 text-xs tabular-nums outline-none focus:border-brand-500" />
                        : money(dish.suggestedPrice)}
                    </td>
                    <td className="p-3 tabular-nums text-sa-500">{dish.usedByRestaurants || 0}</td>
                    {mayEdit && (
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          {isEditing ? (
                            <>
                              <button onClick={() => save(dish.id)} disabled={busyId === dish.id} aria-label="Save"
                                className="rounded-lg p-1.5 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40">
                                {busyId === dish.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                              </button>
                              <button onClick={() => setEditing(null)} aria-label="Cancel"
                                className="rounded-lg p-1.5 text-sa-500 hover:bg-sa-800"><X className="h-4 w-4" /></button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(dish)}
                                className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-sa-400 hover:bg-sa-800">Edit</button>
                              <button onClick={() => remove(dish)} disabled={busyId === dish.id} aria-label={`Remove ${dish.name}`}
                                className="rounded-lg p-1.5 text-sa-600 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
