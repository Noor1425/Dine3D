'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import saApi from '@/lib/saApi';
import { toast } from 'sonner';
import { useSuperAdminAccess } from '@/components/superadmin/SuperAdminAccessContext';
import { ImagePlus, Trash2, Search, EyeOff, Loader2, Images } from 'lucide-react';

/**
 * The shared food-photograph library.
 *
 * Pictures published here appear in every restaurant's menu editor. A new
 * restaurant can build a menu that looks finished on its first evening without
 * owning a camera — which is the actual barrier, not the cost of storage.
 *
 * Deleting is deliberately not always deleting: a picture a menu still points
 * at is withdrawn from the picker instead, because removing the file would put
 * broken images on somebody's till in the middle of service.
 */

const readableSize = (bytes) => (bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export default function StockImagesPage() {
  const { can } = useSuperAdminAccess();
  const mayPublish = can('settings.manage');

  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await saApi.getStockImages();
      setImages(data?.images || []);
    } catch (error) {
      toast.error(error.message || 'The picture library could not be loaded');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Revoke the object URL when it is replaced, so choosing ten files in a row
  // does not leak ten blobs.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const chooseFile = (chosen) => {
    if (!chosen) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
    // Most files are already named after the dish; save the typing but let it
    // be overwritten.
    if (!name) {
      const guess = chosen.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
      setName(guess.replace(/\b\w/g, (letter) => letter.toUpperCase()));
    }
  };

  const reset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null); setPreview(null); setName(''); setCategory('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const publish = async (event) => {
    event.preventDefault();
    if (!file) return toast.error('Choose a picture first');
    if (!name.trim()) return toast.error('Give the dish a name so restaurants can find it');

    setUploading(true);
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('name', name.trim());
      if (category.trim()) form.append('category', category.trim());

      const result = await saApi.addStockImage(form);
      toast.success(result?.message || 'Added to the library');
      reset();
      load();
    } catch (error) {
      toast.error(error.message || 'That picture could not be added');
    } finally {
      setUploading(false);
    }
  };

  const remove = async (image) => {
    const warning = image.usedByMenuItems > 0
      ? `${image.usedByMenuItems} menu item${image.usedByMenuItems === 1 ? '' : 's'} use this picture. It will be withdrawn from the picker but stay on those menus. Continue?`
      : `Remove “${image.name}” from the library?`;
    if (!window.confirm(warning)) return;

    setBusyId(image.id);
    try {
      const result = await saApi.deleteStockImage(image.id);
      toast.success(result?.message || 'Removed');
      load();
    } catch (error) {
      toast.error(error.message || 'That picture could not be removed');
    } finally {
      setBusyId(null);
    }
  };

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return images;
    return images.filter((image) => `${image.name} ${image.category || ''} ${(image.tags || []).join(' ')}`
      .toLowerCase().includes(term));
  }, [images, query]);

  const liveCount = images.filter((image) => image.isActive).length;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black">
            <Images className="h-6 w-6 text-orange-500" />
            Food picture library
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-sa-500">
            Pictures published here appear in every restaurant&apos;s menu editor, so a new
            restaurant can build a menu that looks finished without owning a camera.
            Restaurants may still upload their own.
          </p>
        </div>
        <div className="rounded-xl border border-sa-800 px-4 py-2 text-xs">
          <div className="font-black tabular-nums text-lg">{liveCount}</div>
          <div className="text-sa-500">in the picker</div>
        </div>
      </header>

      {mayPublish && (
        <form onSubmit={publish} className="rounded-2xl border border-sa-800 bg-sa-900/40 p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-[auto,1fr,1fr,auto] sm:items-end">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-sa-400">Picture</label>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-dashed border-sa-700 bg-sa-950 hover:border-orange-500"
              >
                {preview
                  ? <img src={preview} alt="" className="h-full w-full object-cover" />
                  : <ImagePlus className="h-6 w-6 text-sa-600" />}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => chooseFile(event.target.files?.[0])}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-sa-400">Dish name</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Chicken Biryani"
                className="w-full rounded-xl border border-sa-800 bg-sa-950 px-3 py-2.5 text-sm outline-none focus:border-orange-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-sa-400">Category <span className="font-normal text-sa-600">(optional)</span></label>
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="Rice"
                className="w-full rounded-xl border border-sa-800 bg-sa-950 px-3 py-2.5 text-sm outline-none focus:border-orange-500"
              />
            </div>

            <div className="flex gap-2">
              {file && (
                <button type="button" onClick={reset} className="rounded-xl border border-sa-800 px-4 py-2.5 text-sm font-bold text-sa-400 hover:bg-sa-800">
                  Clear
                </button>
              )}
              <button
                type="submit"
                disabled={uploading}
                className="flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-black text-sa-950 hover:bg-brand-400 disabled:opacity-50"
              >
                {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                {uploading ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs text-sa-600">
            JPG, PNG or WebP, up to 6&nbsp;MB. The same photograph uploaded twice is stored once.
          </p>
        </form>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sa-600" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the library"
          className="w-full rounded-xl border border-sa-800 bg-sa-950 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-orange-500 sm:max-w-sm"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="h-44 animate-pulse rounded-2xl border border-sa-800 bg-sa-900/40" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-sa-800 p-12 text-center">
          <Images className="mx-auto h-8 w-8 text-sa-700" />
          <div className="mt-3 font-bold">{query ? 'Nothing matches that' : 'The library is empty'}</div>
          <div className="mt-1 text-sm text-sa-500">
            {query ? 'Try a different dish name.' : 'Publish a picture and every restaurant can use it.'}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {visible.map((image) => (
            <div
              key={image.id}
              className={`group overflow-hidden rounded-2xl border bg-sa-900/40 ${image.isActive ? 'border-sa-800' : 'border-amber-900/60'}`}
            >
              <div className="relative aspect-[4/3] bg-sa-950">
                <img src={image.url} alt={image.name} loading="lazy" className="h-full w-full object-cover" />
                {!image.isActive && (
                  <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-black text-sa-950">
                    <EyeOff className="h-3 w-3" /> Withdrawn
                  </span>
                )}
              </div>
              <div className="p-3">
                <div className="truncate text-sm font-bold" title={image.name}>{image.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-sa-500">
                  <span className="truncate">{image.category || 'Uncategorised'}</span>
                  <span className="text-sa-700">·</span>
                  <span className="tabular-nums">{readableSize(image.bytes)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] tabular-nums text-sa-500">
                    {image.usedByMenuItems > 0
                      ? `Used on ${image.usedByMenuItems} menu${image.usedByMenuItems === 1 ? '' : 's'}`
                      : 'Not used yet'}
                  </span>
                  {mayPublish && (
                    <button
                      onClick={() => remove(image)}
                      disabled={busyId === image.id}
                      aria-label={`Remove ${image.name}`}
                      className="rounded-lg p-1.5 text-sa-600 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                    >
                      {busyId === image.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Trash2 className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
