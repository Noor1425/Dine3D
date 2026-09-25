'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';
import StockImagePicker from '@/components/menu/StockImagePicker';
import MenuCataloguePicker from '@/components/menu/MenuCataloguePicker';

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', PKR: 'Rs.', AED: 'د.إ', SAR: 'ر.س', INR: '₹' };

const DEFAULT_FORM = {
  name: '',
  description: '',
  price: '',
  categoryId: '',
  allergens: '',
  calories: '',
  isFeatured: false,
  isAvailable: true,
  sortOrder: '0',
};

const STATUS_FILTERS = [
  { value: 'ALL', label: 'All Items' },
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'UNAVAILABLE', label: 'Unavailable' },
  { value: 'FEATURED', label: 'Featured' },
  { value: 'WITH_3D', label: 'With 3D' },
];

const createEmptyVariant = () => ({ name: '', price: '', isAvailable: true });
const createEmptyOption = () => ({ name: '', price: '', isAvailable: true });
const createEmptyModifierGroup = () => ({
  name: '',
  isRequired: false,
  maxSelection: '',
  options: [createEmptyOption()],
});

const normalizeText = (value) => String(value ?? '').trim().toLowerCase();
const toInputValue = (value) => (value === null || value === undefined ? '' : String(value));
const toMoneyNumber = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getItemSearchText = (item) =>
  normalizeText([
    item.name,
    item.description,
    item.category?.name,
    ...(item.allergens || []),
    ...(item.variants || []).map((variant) => variant.name),
    ...(item.modifierGroups || []).flatMap((group) => [
      group.name,
      ...(group.modifiers || []).map((modifier) => modifier.name),
    ]),
  ].filter(Boolean).join(' '));

const normalizeVariant = (variant) => ({
  name: variant?.name || '',
  price: toInputValue(variant?.price ?? ''),
  isAvailable: variant?.isAvailable !== false,
});

const normalizeModifierGroup = (group) => ({
  name: group?.name || '',
  isRequired: Boolean(group?.isRequired),
  maxSelection: group?.maxSelection ?? group?.maxSelectable ?? '',
  options: ((group?.options || group?.modifiers || []).length
    ? (group?.options || group?.modifiers)
    : [createEmptyOption()]
  ).map((option) => ({
    name: option?.name || '',
    price: toInputValue(option?.price ?? ''),
    isAvailable: option?.isAvailable !== false,
  })),
});

const sanitizeVariants = (variants) =>
  variants
    .map((variant) => ({
      name: variant.name.trim(),
      price: toMoneyNumber(variant.price),
      isAvailable: variant.isAvailable !== false,
    }))
    .filter((variant) => variant.name);

const sanitizeModifiers = (modifierGroups) =>
  modifierGroups
    .map((group) => ({
      name: group.name.trim(),
      isRequired: Boolean(group.isRequired),
      maxSelection: group.maxSelection === '' ? null : parseInt(group.maxSelection, 10),
      options: (group.options || [])
        .map((option) => ({
          name: option.name.trim(),
          price: toMoneyNumber(option.price),
          isAvailable: option.isAvailable !== false,
        }))
        .filter((option) => option.name),
    }))
    .filter((group) => group.name && group.options.length > 0);

export default function MenuPage() {
  const { can } = useAdminAccess();
  const canWrite = can('menu.write');
  const canDelete = can('menu.delete');
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [restaurant, setRestaurant] = useState(null);
  const [menuPublished, setMenuPublished] = useState(true);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [showModal, setShowModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [justCreatedItem, setJustCreatedItem] = useState(false);

  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [variants, setVariants] = useState([]);
  const [modifiers, setModifiers] = useState([]);
  const [imageFile, setImageFile] = useState(null);
  const [stockImageUrl, setStockImageUrl] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [modelFile, setModelFile] = useState(null);
  const [removeExistingModel, setRemoveExistingModel] = useState(false);

  const [requestImages, setRequestImages] = useState([]);
  const [requestNotes, setRequestNotes] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('dine3d_restaurant');
      if (saved) {
        setRestaurant(JSON.parse(saved));
      }
    } catch (error) {
      console.error('Failed to load restaurant context:', error);
    }

    loadData({ initial: true });
  }, []);

  const loadData = async ({ initial = false } = {}) => {
    try {
      if (initial) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      const [menuRes, categoryRes] = await Promise.all([
        api.getMenuItems(),
        api.getCategories(),
      ]);

      setItems(menuRes?.items || []);
      setMenuPublished(menuRes?.menuPublished === true);
      setCategories(categoryRes?.categories || []);
    } catch (error) {
      console.error('Failed to load menu data:', error);
      toast.error(error.message || 'Unable to load menu items');
      setItems([]);
      setCategories([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const formatPrice = (value) => `${CURRENCY_SYMBOLS[restaurant?.currency] || 'Rs.'}${toMoneyNumber(value).toFixed(2)}`;

  const togglePublication = async () => {
    try {
      const result = await api.setMenuPublication(!menuPublished);
      setMenuPublished(result.menuPublished);
      toast.success(result.menuPublished ? 'Online menu published' : 'Online menu paused');
    } catch (error) {
      toast.error(error.message || 'Unable to change menu publication');
    }
  };

  const resetItemForm = () => {
    setForm({ ...DEFAULT_FORM });
    setVariants([]);
    setModifiers([]);
    setImageFile(null);
    setStockImageUrl(null);
    setPickerOpen(false);
    setModelFile(null);
    setRemoveExistingModel(false);
  };

  const closeItemModal = ({ refresh = false } = {}) => {
    setShowModal(false);
    setEditItem(null);
    setJustCreatedItem(false);
    resetItemForm();
    if (refresh) {
      loadData();
    }
  };

  const closeRequestModal = () => {
    setShowRequestModal(false);
    setRequestImages([]);
    setRequestNotes('');
  };

  const openCreate = () => {
    setEditItem(null);
    setJustCreatedItem(false);
    resetItemForm();
    setShowModal(true);
  };

  const openEdit = (item) => {
    setEditItem(item);
    setJustCreatedItem(false);
    setForm({
      name: item.name || '',
      description: item.description || '',
      price: toInputValue(item.basePrice ?? item.price ?? ''),
      categoryId: item.categoryId || '',
      allergens: (item.allergens || []).join(', '),
      calories: toInputValue(item.calories ?? ''),
      isFeatured: Boolean(item.isFeatured),
      isAvailable: item.isAvailable !== false,
      sortOrder: toInputValue(item.sortOrder ?? 0),
    });
    setVariants((item.variants || []).map(normalizeVariant));
    setModifiers((item.modifierGroups || []).map(normalizeModifierGroup));
    setImageFile(null);
    setStockImageUrl(item.imageUrl || null);
    setPickerOpen(false);
    setModelFile(null);
    setRemoveExistingModel(false);
    setShowModal(true);
  };

  const openRequestModal = (item) => {
    if (item) {
      setEditItem(item);
    }
    setShowRequestModal(true);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);

    try {
      const sanitizedVariants = sanitizeVariants(variants);
      const sanitizedModifiers = sanitizeModifiers(modifiers);
      const formData = new FormData();

      formData.append('name', form.name.trim());
      formData.append('description', form.description.trim());
      formData.append('price', form.price);
      formData.append('categoryId', form.categoryId || '');
      formData.append('allergens', JSON.stringify(
        form.allergens
          .split(',')
          .map((allergen) => allergen.trim())
          .filter(Boolean)
      ));
      formData.append('calories', form.calories || '');
      formData.append('isFeatured', String(form.isFeatured));
      formData.append('isAvailable', String(form.isAvailable));
      formData.append('sortOrder', form.sortOrder || '0');

      if (editItem || sanitizedVariants.length > 0) {
        formData.append('variants', JSON.stringify(sanitizedVariants));
      }

      if (editItem || sanitizedModifiers.length > 0) {
        formData.append('modifiers', JSON.stringify(sanitizedModifiers));
      }

      if (imageFile) {
        formData.append('image', imageFile);
      } else if (stockImageUrl) {
        formData.append('stockImagePath', stockImageUrl);
      }

      if (modelFile) {
        formData.append('model', modelFile);
      }

      if (editItem && removeExistingModel) {
        formData.append('removeModel', 'true');
      }

      if (editItem) {
        await api.updateMenuItem(editItem.id, formData);
        toast.success('Menu item updated');
        closeItemModal({ refresh: true });
      } else {
        const response = await api.createMenuItem(formData);
        setEditItem(response.item);
        setJustCreatedItem(true);
        toast.success('Menu item created');
      }
    } catch (error) {
      console.error('Failed to save menu item:', error);
      toast.error(error.message || 'Failed to save menu item');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this menu item? This cannot be undone.')) return;

    try {
      await api.deleteMenuItem(id);
      toast.success('Menu item deleted');
      loadData();
    } catch (error) {
      toast.error(error.message || 'Failed to delete menu item');
    }
  };

  const handleToggleAvailability = async (item) => {
    try {
      await api.toggleMenuItem(item.id);
      toast.success(`${item.name} ${item.isAvailable ? 'hidden from menu' : 'made available'}`);
      loadData();
    } catch (error) {
      toast.error(error.message || 'Failed to update availability');
    }
  };

  const handleRequest3D = async (event) => {
    event.preventDefault();

    if (!editItem?.id) {
      toast.error('Select a menu item first');
      return;
    }

    if (requestImages.length === 0) {
      toast.error('Please upload at least one reference image');
      return;
    }

    setSubmittingRequest(true);

    try {
      const formData = new FormData();
      requestImages.forEach((image) => formData.append('images', image));
      formData.append('notes', requestNotes);

      await api.request3DModel(editItem.id, formData);
      toast.success('3D model request submitted');
      closeRequestModal();

      if (justCreatedItem) {
        closeItemModal({ refresh: true });
      }
    } catch (error) {
      toast.error(error.message || 'Failed to submit 3D model request');
    } finally {
      setSubmittingRequest(false);
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch = !searchQuery || getItemSearchText(item).includes(normalizeText(searchQuery));
      const matchesCategory = categoryFilter === 'ALL' || item.categoryId === categoryFilter || item.category?.id === categoryFilter;

      let matchesStatus = true;
      if (statusFilter === 'AVAILABLE') matchesStatus = item.isAvailable !== false;
      if (statusFilter === 'UNAVAILABLE') matchesStatus = item.isAvailable === false;
      if (statusFilter === 'FEATURED') matchesStatus = Boolean(item.isFeatured);
      if (statusFilter === 'WITH_3D') matchesStatus = Boolean(item.modelUrl);

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [items, searchQuery, categoryFilter, statusFilter]);

  const metrics = useMemo(() => {
    const available = items.filter((item) => item.isAvailable !== false).length;
    const featured = items.filter((item) => item.isFeatured).length;
    const with3D = items.filter((item) => item.modelUrl).length;
    const uncategorized = items.filter((item) => !item.categoryId && !item.category?.id).length;

    return [
      { label: 'Total Items', value: items.length, hint: `${filteredItems.length} in current view`, accent: 'var(--color-primary)' },
      { label: 'Available Now', value: available, hint: `${items.length - available} hidden from the live menu`, accent: 'var(--color-success)' },
      { label: '3D Ready', value: with3D, hint: `${Math.max(items.length - with3D, 0)} still need models`, accent: 'var(--color-info)' },
      { label: 'Featured', value: featured, hint: `${uncategorized} uncategorized items`, accent: 'var(--color-warning)' },
    ];
  }, [items, filteredItems.length]);

  const activeFilterCount = Number(Boolean(searchQuery)) + Number(categoryFilter !== 'ALL') + Number(statusFilter !== 'ALL');

  const clearFilters = () => {
    setSearchQuery('');
    setCategoryFilter('ALL');
    setStatusFilter('ALL');
  };

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div className="skeleton skeleton-heading" />
        </div>
        <div className="stats-grid">
          {[1, 2, 3, 4].map((key) => (
            <div key={key} className="skeleton skeleton-card" style={{ height: 132 }} />
          ))}
        </div>
        <div className="skeleton skeleton-card" style={{ height: 420, marginTop: 20 }} />
      </div>
    );
  }

  return (
    <div className="menu-admin-page">
      {catalogueOpen && (
        <MenuCataloguePicker
          onClose={() => setCatalogueOpen(false)}
          onAdded={() => loadData()}
        />
      )}
      <style>{`
        .menu-toolbar-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(220px, 0.8fr) minmax(0, 1fr);
          gap: 14px;
          align-items: end;
        }

        .menu-status-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .menu-filter-pill {
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          color: var(--color-text-secondary);
          border-radius: 999px;
          padding: 8px 12px;
          font-size: 12.5px;
          font-weight: 700;
          line-height: 1;
          cursor: pointer;
          transition: all var(--duration-fast) var(--ease-out);
        }

        .menu-filter-pill:hover {
          border-color: var(--color-border-hover);
          color: var(--color-text);
        }

        .menu-filter-pill.active {
          background: var(--color-primary-glow);
          border-color: rgba(255, 107, 53, 0.22);
          color: var(--color-primary-dark);
        }

        .menu-summary-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
          padding-top: 16px;
          border-top: 1px solid var(--color-border);
        }

        .menu-desktop-table {
          display: none;
        }

        .menu-mobile-grid {
          display: grid;
          gap: 14px;
        }

        .menu-table-thumb,
        .menu-card-thumb {
          background: linear-gradient(180deg, #fff7f2 0%, #f6f7fb 100%);
          border: 1px solid var(--color-border);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .menu-table-thumb {
          width: 52px;
          height: 52px;
          border-radius: 12px;
        }

        .menu-card-thumb {
          width: 72px;
          height: 72px;
          border-radius: 16px;
        }

        .menu-table-thumb img,
        .menu-card-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .menu-thumb-fallback {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.08em;
          color: #c35d33;
        }

        .menu-item-title {
          font-size: 14.5px;
          font-weight: 700;
          color: var(--color-text);
          line-height: 1.35;
        }

        .menu-item-description {
          font-size: 12.5px;
          line-height: 1.55;
          color: var(--color-text-muted);
          margin-top: 3px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .menu-inline-meta {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 8px;
        }

        .menu-meta-chip {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          background: var(--color-bg-subtle);
          border: 1px solid var(--color-border);
          padding: 4px 8px;
          font-size: 11.5px;
          font-weight: 700;
          color: var(--color-text-secondary);
          line-height: 1;
        }

        .menu-action-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .menu-section-shell {
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          background: linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(249,250,251,0.94) 100%);
          padding: 18px;
        }

        .menu-section-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 14px;
        }

        .menu-section-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--color-text);
        }

        .menu-option-row {
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) minmax(110px, 0.7fr) auto auto;
          gap: 10px;
          align-items: center;
        }

        .menu-card-grid {
          display: grid;
          gap: 14px;
        }

        .catalogue-backdrop {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          background: rgba(8, 10, 14, 0.62);
          backdrop-filter: blur(3px);
        }

        .catalogue-panel {
          display: flex;
          flex-direction: column;
          width: min(1080px, 100%);
          max-height: min(88vh, 900px);
          overflow: hidden;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 18px;
          box-shadow: var(--shadow-2xl, 0 24px 60px rgba(0,0,0,.35));
        }

        .catalogue-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 20px;
          border-bottom: 1px solid var(--color-border);
        }

        .catalogue-title { font-size: 17px; font-weight: 800; letter-spacing: -0.01em; }

        .catalogue-controls {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 14px 20px;
          border-bottom: 1px solid var(--color-border);
        }

        .catalogue-cuisines { display: flex; flex-wrap: wrap; gap: 8px; }

        .catalogue-chip {
          padding: 6px 13px;
          font-size: 12px;
          font-weight: 700;
          border-radius: 999px;
          border: 1px solid var(--color-border);
          background: var(--color-bg-subtle);
          color: var(--color-text-secondary);
          cursor: pointer;
        }

        .catalogue-chip.is-active {
          background: var(--color-primary);
          border-color: var(--color-primary);
          color: #fff;
        }

        .catalogue-body { flex: 1; overflow-y: auto; padding: 4px 20px 20px; }

        .catalogue-group { margin-top: 18px; }

        .catalogue-group-head {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--color-text-muted);
        }

        .catalogue-group-count {
          padding: 1px 7px;
          border-radius: 999px;
          background: var(--color-bg-muted);
          font-size: 10px;
        }

        .catalogue-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
          gap: 10px;
        }

        .catalogue-card {
          position: relative;
          display: flex;
          gap: 11px;
          padding: 10px;
          text-align: left;
          border: 2px solid var(--color-border);
          border-radius: 13px;
          background: var(--color-bg);
          cursor: pointer;
        }

        .catalogue-card:hover:not(:disabled) { border-color: var(--color-text-muted); }

        .catalogue-card.is-selected {
          border-color: var(--color-primary);
          background: var(--color-primary-glow, rgba(255,107,53,.08));
        }

        .catalogue-card.is-on-menu { opacity: 0.55; cursor: not-allowed; }
        .catalogue-card.is-loading {
          min-height: 84px;
          border-style: solid;
          background: var(--color-bg-subtle);
          animation: catalogue-pulse 1.4s ease-in-out infinite;
        }

        .catalogue-thumb {
          flex: 0 0 auto;
          width: 58px;
          height: 58px;
          overflow: hidden;
          border-radius: 10px;
          background: var(--color-bg-muted);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .catalogue-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .catalogue-thumb-empty { font-size: 22px; opacity: 0.35; }

        .catalogue-card-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .catalogue-name { font-size: 13px; font-weight: 700; line-height: 1.25; }

        .catalogue-desc {
          font-size: 11px;
          line-height: 1.35;
          color: var(--color-text-muted);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .catalogue-price {
          margin-top: 2px;
          font-size: 12px;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
          color: var(--color-text);
        }

        .catalogue-badge {
          position: absolute;
          top: 8px;
          right: 8px;
          padding: 2px 7px;
          border-radius: 999px;
          background: var(--color-bg-muted);
          font-size: 9px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--color-text-muted);
        }

        .catalogue-tick {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 19px;
          height: 19px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          background: var(--color-primary);
          color: #fff;
          font-size: 11px;
          font-weight: 800;
        }

        .catalogue-foot {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          padding: 14px 20px;
          border-top: 1px solid var(--color-border);
          background: var(--color-bg-subtle);
        }

        .catalogue-summary {
          flex: 1;
          min-width: 140px;
          font-size: 12px;
          color: var(--color-text-secondary);
        }

        @keyframes catalogue-pulse { 0%,100% { opacity: 1 } 50% { opacity: .5 } }

        @media (prefers-reduced-motion: reduce) {
          .catalogue-card.is-loading { animation: none; }
        }

        @media (max-width: 640px) {
          .catalogue-panel { max-height: 94vh; }
          .catalogue-grid { grid-template-columns: 1fr; }
        }

        .menu-image-choice {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .menu-image-choice-preview {
          width: 56px;
          height: 56px;
          border-radius: 10px;
          object-fit: cover;
          border: 1px solid var(--color-border);
        }

        .stock-picker {
          margin-top: 12px;
          padding: 12px;
          border: 1px solid var(--color-border);
          border-radius: 12px;
          background: var(--color-bg-subtle);
          max-height: 340px;
          overflow-y: auto;
        }

        .stock-picker-group { margin-top: 14px; }

        .stock-picker-group-title {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--color-text-secondary);
          margin-bottom: 8px;
        }

        .stock-picker-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
          gap: 10px;
        }

        .stock-picker-tile {
          position: relative;
          display: block;
          padding: 0;
          overflow: hidden;
          border: 2px solid transparent;
          border-radius: 10px;
          background: var(--color-bg);
          cursor: pointer;
          text-align: left;
        }

        .stock-picker-tile img {
          display: block;
          width: 100%;
          aspect-ratio: 4 / 3;
          object-fit: cover;
        }

        .stock-picker-tile-name {
          display: block;
          padding: 6px 8px;
          font-size: 11px;
          font-weight: 600;
          color: var(--color-text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .stock-picker-tile:hover { border-color: var(--color-border); }

        .stock-picker-tile.is-selected {
          border-color: var(--color-primary, #f97316);
        }

        .stock-picker-tile.is-selected .stock-picker-tile-name {
          color: var(--color-text);
        }

        .stock-picker-tile--loading {
          aspect-ratio: 4 / 3;
          background: var(--color-bg-subtle);
          border: 1px solid var(--color-border);
          animation: stock-picker-pulse 1.4s ease-in-out infinite;
        }

        @keyframes stock-picker-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }

        @media (prefers-reduced-motion: reduce) {
          .stock-picker-tile--loading { animation: none; }
        }

        .menu-file-note {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 10px;
          padding: 6px 10px;
          border-radius: 999px;
          background: var(--color-bg-subtle);
          border: 1px solid var(--color-border);
          font-size: 12px;
          color: var(--color-text-secondary);
        }

        @media (min-width: 920px) {
          .menu-desktop-table {
            display: block;
          }

          .menu-mobile-grid {
            display: none;
          }
        }

        @media (max-width: 1080px) {
          .menu-toolbar-grid {
            grid-template-columns: 1fr 1fr;
          }

          .menu-toolbar-grid > div:first-child {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 720px) {
          .menu-toolbar-grid,
          .menu-option-row {
            grid-template-columns: 1fr;
          }

          .menu-summary-row {
            align-items: flex-start;
          }
        }
      `}</style>

      <div className="page-header">
        <div>
          <h1>Menu Items</h1>
          <div className="page-header-subtitle">
            Professional catalog management for your live menu, pricing, options, and 3D assets.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canWrite && <button
            type="button"
            onClick={togglePublication}
            className={menuPublished ? 'btn btn-secondary' : 'btn btn-primary'}
          >
            {menuPublished ? 'Pause Online Menu' : 'Publish Online Menu'}
          </button>}
          {restaurant ? (
            <button
              type="button"
              onClick={() => api.openLiveStore(restaurant)}
              className="btn btn-secondary"
            >
              View Live Menu
            </button>
          ) : null}
          <button className="btn btn-secondary" onClick={() => loadData()} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          {canWrite && <button className="btn btn-secondary" onClick={() => setCatalogueOpen(true)}>
            Add from catalogue
          </button>}
          {canWrite && <button className="btn btn-primary" onClick={openCreate}>
            Add Menu Item
          </button>}
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 24 }}>
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="stat-card"
            style={{ padding: 18, borderTop: `3px solid ${metric.accent}` }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              {metric.label}
            </div>
            <div style={{ fontSize: 28, lineHeight: 1.05, fontWeight: 800, color: 'var(--color-text)', fontFamily: 'var(--font-heading)', marginBottom: 6 }}>
              {metric.value}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
              {metric.hint}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-body" style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>Catalog Controls</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Filter by name, category, live availability, featured placement, or 3D readiness.
              </div>
            </div>
            {activeFilterCount > 0 ? (
              <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
                Clear Filters
              </button>
            ) : null}
          </div>

          <div className="menu-toolbar-grid" style={{ marginBottom: 18 }}>
            <div>
              <label className="form-label" htmlFor="menu-search">Search</label>
              <input
                id="menu-search"
                className="input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by item name, description, category, allergen, or option"
              />
            </div>

            <div>
              <label className="form-label" htmlFor="menu-category-filter">Category</label>
              <select
                id="menu-category-filter"
                className="select"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="ALL">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="form-label" style={{ marginBottom: 8 }}>Quick Status</div>
              <div className="menu-status-filters">
                {STATUS_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    className={`menu-filter-pill ${statusFilter === filter.value ? 'active' : ''}`}
                    onClick={() => setStatusFilter(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="menu-summary-row">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="menu-meta-chip">{filteredItems.length} items in view</span>
              <span className="menu-meta-chip">{items.filter((item) => item.isAvailable !== false).length} live now</span>
              <span className="menu-meta-chip">{items.filter((item) => item.modelUrl).length} with 3D</span>
            </div>

            {categories.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                Categories are empty.{' '}
                <a href="/admin/categories" style={{ fontWeight: 700 }}>
                  Create categories
                </a>{' '}
                to organize the menu.
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} available for assignment
              </div>
            )}
          </div>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">{items.length === 0 ? '◈' : '⌕'}</div>
            <h3>{items.length === 0 ? 'No menu items yet' : 'No items match the current filters'}</h3>
            <p>
              {items.length === 0
                ? 'Create your first menu item to start building a polished live catalog for staff and guests.'
                : 'Try another search term or clear the active filters to bring more menu items back into view.'}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              {items.length === 0 ? (canWrite ? (
                <>
                  <button className="btn btn-primary" onClick={() => setCatalogueOpen(true)}>
                    Build my menu from the catalogue
                  </button>
                  <button className="btn btn-secondary" onClick={openCreate}>Add one myself</button>
                </>
              ) : null) : (
                <button className="btn btn-secondary" onClick={clearFilters}>
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="data-table-wrapper menu-desktop-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Pricing & Options</th>
                  <th>Status</th>
                  <th>Assets</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="menu-item-row">
                        <div className="menu-table-thumb">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.name} />
                          ) : (
                            <span className="menu-thumb-fallback">
                              {item.name.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="menu-item-info" style={{ minWidth: 0 }}>
                          <div className="menu-item-title">{item.name}</div>
                          {item.description ? (
                            <div className="menu-item-description">{item.description}</div>
                          ) : null}
                          <div className="menu-inline-meta">
                            {item.allergens?.length ? (
                              <span className="menu-meta-chip">{item.allergens.length} allergen tag{item.allergens.length === 1 ? '' : 's'}</span>
                            ) : null}
                            {item.calories ? (
                              <span className="menu-meta-chip">{item.calories} cal</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ color: 'var(--color-text)' }}>{item.category?.name || 'Uncategorized'}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 800, color: 'var(--color-text)', marginBottom: 4 }}>
                        {formatPrice(item.basePrice ?? item.price)}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <span>{item.variants?.length || 0} variant{item.variants?.length === 1 ? '' : 's'}</span>
                        <span>{item.modifierGroups?.length || 0} modifier group{item.modifierGroups?.length === 1 ? '' : 's'}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span className={`badge badge-dot ${item.isAvailable !== false ? 'badge-success' : 'badge-danger'}`}>
                          {item.isAvailable !== false ? 'Live' : 'Hidden'}
                        </span>
                        {item.isFeatured ? (
                          <span className="badge badge-warning">Featured</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span className={`badge ${item.imageUrl ? 'badge-info' : 'badge-danger'}`}>
                          {item.imageUrl ? 'Image' : 'No Image'}
                        </span>
                        <span className={`badge ${item.modelUrl ? 'badge-info' : 'badge-danger'}`}>
                          {item.modelUrl ? '3D Ready' : 'No 3D'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="menu-action-row">
                        {restaurant ? (
                          <button
                            type="button"
                            onClick={() => api.openLiveStore(restaurant)}
                            className="btn btn-ghost btn-sm"
                          >
                            Live
                          </button>
                        ) : null}
                        {canWrite && <button className="btn btn-ghost btn-sm" onClick={() => openEdit(item)}>
                          Edit
                        </button>}
                        {canWrite && <button className="btn btn-ghost btn-sm" onClick={() => openRequestModal(item)}>
                          3D
                        </button>}
                        {canWrite && <button className="btn btn-ghost btn-sm" onClick={() => handleToggleAvailability(item)}>
                          {item.isAvailable !== false ? 'Hide' : 'Show'}
                        </button>}
                        {canDelete && <button className="btn btn-danger btn-sm" onClick={() => handleDelete(item.id)}>
                          Delete
                        </button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="menu-mobile-grid">
            {filteredItems.map((item) => (
              <div key={item.id} className="card">
                <div className="card-body" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <div className="menu-card-thumb">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} />
                      ) : (
                        <span className="menu-thumb-fallback">
                          {item.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="menu-item-title">{item.name}</div>
                      {item.description ? (
                        <div className="menu-item-description">{item.description}</div>
                      ) : null}
                      <div style={{ fontWeight: 800, color: 'var(--color-text)', marginTop: 10 }}>
                        {formatPrice(item.basePrice ?? item.price)}
                      </div>
                      <div className="menu-inline-meta">
                        <span className={`badge badge-dot ${item.isAvailable !== false ? 'badge-success' : 'badge-danger'}`}>
                          {item.isAvailable !== false ? 'Live' : 'Hidden'}
                        </span>
                        {item.category?.name ? <span className="menu-meta-chip">{item.category.name}</span> : null}
                        {item.isFeatured ? <span className="menu-meta-chip">Featured</span> : null}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14, fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                    <div>{item.variants?.length || 0} variants</div>
                    <div>{item.modifierGroups?.length || 0} modifier groups</div>
                    <div>{item.modelUrl ? '3D attached' : 'No 3D model'}</div>
                    <div>{item.imageUrl ? 'Image attached' : 'No image yet'}</div>
                  </div>

                  <div className="menu-action-row" style={{ marginTop: 16 }}>
                    {canWrite && <button className="btn btn-secondary btn-sm" onClick={() => openEdit(item)} style={{ flex: 1 }}>
                      Edit
                    </button>}
                    {canWrite && <button className="btn btn-ghost btn-sm" onClick={() => openRequestModal(item)} style={{ flex: 1 }}>
                      3D Request
                    </button>}
                    {canWrite && <button className="btn btn-ghost btn-sm" onClick={() => handleToggleAvailability(item)} style={{ flex: 1 }}>
                      {item.isAvailable !== false ? 'Hide' : 'Show'}
                    </button>}
                    {canDelete && <button className="btn btn-danger btn-sm" onClick={() => handleDelete(item.id)} style={{ flex: 1 }}>
                      Delete
                    </button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {showModal && canWrite ? (
        <div className="modal-overlay" onClick={() => closeItemModal({ refresh: justCreatedItem })}>
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            style={{ width: 'min(960px, 94vw)', maxWidth: 960 }}
          >
            <div className="modal-header">
              <h2>{justCreatedItem ? `${editItem?.name} created` : editItem ? 'Edit Menu Item' : 'New Menu Item'}</h2>
              <button className="btn btn-ghost btn-icon-sm" onClick={() => closeItemModal({ refresh: justCreatedItem })}>
                ✕
              </button>
            </div>

            {justCreatedItem ? (
              <>
                <div className="modal-body" style={{ textAlign: 'center', paddingTop: 42, paddingBottom: 42 }}>
                  <div style={{ fontSize: 46, fontWeight: 800, color: 'var(--color-primary)', marginBottom: 16 }}>Done</div>
                  <h3 style={{ marginBottom: 8 }}>{editItem?.name}</h3>
                  <p style={{ maxWidth: 460, margin: '0 auto 18px', color: 'var(--color-text-secondary)' }}>
                    The item is live in your catalog. You can request a professional 3D model now or come back later from the menu list.
                  </p>
                  <div style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <span className="menu-meta-chip">{formatPrice(editItem?.basePrice ?? editItem?.price)}</span>
                    {editItem?.category?.name ? <span className="menu-meta-chip">{editItem.category.name}</span> : null}
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-ghost" onClick={() => closeItemModal({ refresh: true })}>
                    Done
                  </button>
                  <button className="btn btn-primary" onClick={() => openRequestModal(editItem)}>
                    Request 3D Model
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleSave}>
                <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
                  <div className="menu-card-grid">
                    <section className="menu-section-shell">
                      <div className="menu-section-head">
                        <div>
                          <div className="menu-section-title">Basic Details</div>
                          <div className="form-hint">Core information guests and staff will see on the live menu.</div>
                        </div>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Item Name</label>
                        <input
                          className="input"
                          value={form.name}
                          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                          placeholder="Signature Burger"
                          required
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Description</label>
                        <textarea
                          className="textarea"
                          value={form.description}
                          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                          placeholder="Short, clear description for the guest menu."
                        />
                      </div>

                      <div className="grid-2">
                        <div className="form-group">
                          <label className="form-label">Base Price</label>
                          <input
                            className="input"
                            type="number"
                            step="0.01"
                            min="0"
                            value={form.price}
                            onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                            placeholder="1250"
                            required
                          />
                          <div className="form-hint">Still required even when variants are added.</div>
                        </div>

                        <div className="form-group">
                          <label className="form-label">Category</label>
                          <select
                            className="select"
                            value={form.categoryId}
                            onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}
                          >
                            <option value="">Uncategorized</option>
                            {categories.map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid-2">
                        <div className="form-group">
                          <label className="form-label">Allergens</label>
                          <input
                            className="input"
                            value={form.allergens}
                            onChange={(event) => setForm((current) => ({ ...current, allergens: event.target.value }))}
                            placeholder="gluten, dairy, nuts"
                          />
                          <div className="form-hint">Separate tags with commas.</div>
                        </div>

                        <div className="form-group">
                          <label className="form-label">Calories</label>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            value={form.calories}
                            onChange={(event) => setForm((current) => ({ ...current, calories: event.target.value }))}
                            placeholder="450"
                          />
                        </div>
                      </div>
                    </section>

                    <section className="menu-section-shell">
                      <div className="menu-section-head">
                        <div>
                          <div className="menu-section-title">Catalog Controls</div>
                          <div className="form-hint">Control where the item appears and whether it is sellable right now.</div>
                        </div>
                      </div>

                      <div className="grid-2">
                        <div className="form-group">
                          <label className="form-label">Sort Order</label>
                          <input
                            className="input"
                            type="number"
                            value={form.sortOrder}
                            onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))}
                            placeholder="0"
                          />
                        </div>

                        <div className="form-group">
                          <label className="form-label">Live Status</label>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                            <label className="menu-meta-chip" style={{ cursor: 'pointer', padding: '10px 12px' }}>
                              <input
                                type="checkbox"
                                checked={form.isAvailable}
                                onChange={(event) => setForm((current) => ({ ...current, isAvailable: event.target.checked }))}
                                style={{ marginRight: 8 }}
                              />
                              Available on live menu
                            </label>
                            <label className="menu-meta-chip" style={{ cursor: 'pointer', padding: '10px 12px' }}>
                              <input
                                type="checkbox"
                                checked={form.isFeatured}
                                onChange={(event) => setForm((current) => ({ ...current, isFeatured: event.target.checked }))}
                                style={{ marginRight: 8 }}
                              />
                              Featured item
                            </label>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="menu-section-shell">
                      <div className="menu-section-head">
                        <div>
                          <div className="menu-section-title">Variants</div>
                          <div className="form-hint">Use variants for sizes or portions that change the item price.</div>
                        </div>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setVariants((current) => [...current, createEmptyVariant()])}>
                          Add Variant
                        </button>
                      </div>

                      {variants.length === 0 ? (
                        <div className="form-hint">No variants yet. Guests will order this item using the base price only.</div>
                      ) : (
                        <div style={{ display: 'grid', gap: 10 }}>
                          {variants.map((variant, index) => (
                            <div key={index} className="menu-option-row">
                              <input
                                className="input"
                                value={variant.name}
                                onChange={(event) =>
                                  setVariants((current) =>
                                    current.map((entry, entryIndex) =>
                                      entryIndex === index ? { ...entry, name: event.target.value } : entry
                                    )
                                  )
                                }
                                placeholder="Large"
                                required
                              />
                              <input
                                className="input"
                                type="number"
                                step="0.01"
                                min="0"
                                value={variant.price}
                                onChange={(event) =>
                                  setVariants((current) =>
                                    current.map((entry, entryIndex) =>
                                      entryIndex === index ? { ...entry, price: event.target.value } : entry
                                    )
                                  )
                                }
                                placeholder="1450"
                                required
                              />
                              <label className="menu-meta-chip" style={{ cursor: 'pointer', padding: '10px 12px' }}>
                                <input
                                  type="checkbox"
                                  checked={variant.isAvailable}
                                  onChange={(event) =>
                                    setVariants((current) =>
                                      current.map((entry, entryIndex) =>
                                        entryIndex === index ? { ...entry, isAvailable: event.target.checked } : entry
                                      )
                                    )
                                  }
                                  style={{ marginRight: 8 }}
                                />
                                Live
                              </label>
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={() => setVariants((current) => current.filter((_, entryIndex) => entryIndex !== index))}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="menu-section-shell">
                      <div className="menu-section-head">
                        <div>
                          <div className="menu-section-title">Modifier Groups</div>
                          <div className="form-hint">Create structured add-ons like sauces, extras, crusts, or cooking preferences.</div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setModifiers((current) => [...current, createEmptyModifierGroup()])}
                        >
                          Add Group
                        </button>
                      </div>

                      {modifiers.length === 0 ? (
                        <div className="form-hint">No modifier groups yet. Add one when the item needs guest choices or add-ons.</div>
                      ) : (
                        <div style={{ display: 'grid', gap: 14 }}>
                          {modifiers.map((group, groupIndex) => (
                            <div key={groupIndex} className="card" style={{ borderStyle: 'dashed' }}>
                              <div className="card-body" style={{ padding: 16 }}>
                                <div className="grid-2">
                                  <div className="form-group">
                                    <label className="form-label">Group Name</label>
                                    <input
                                      className="input"
                                      value={group.name}
                                      onChange={(event) =>
                                        setModifiers((current) =>
                                          current.map((entry, entryIndex) =>
                                            entryIndex === groupIndex ? { ...entry, name: event.target.value } : entry
                                          )
                                        )
                                      }
                                      placeholder="Choose a sauce"
                                      required
                                    />
                                  </div>
                                  <div className="form-group">
                                    <label className="form-label">Max Selections</label>
                                    <input
                                      className="input"
                                      type="number"
                                      min="1"
                                      value={group.maxSelection}
                                      onChange={(event) =>
                                        setModifiers((current) =>
                                          current.map((entry, entryIndex) =>
                                            entryIndex === groupIndex ? { ...entry, maxSelection: event.target.value } : entry
                                          )
                                        )
                                      }
                                      placeholder="Optional"
                                    />
                                  </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                                  <label className="menu-meta-chip" style={{ cursor: 'pointer', padding: '10px 12px' }}>
                                    <input
                                      type="checkbox"
                                      checked={group.isRequired}
                                      onChange={(event) =>
                                        setModifiers((current) =>
                                          current.map((entry, entryIndex) =>
                                            entryIndex === groupIndex ? { ...entry, isRequired: event.target.checked } : entry
                                          )
                                        )
                                      }
                                      style={{ marginRight: 8 }}
                                    />
                                    Selection required
                                  </label>

                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      onClick={() =>
                                        setModifiers((current) =>
                                          current.map((entry, entryIndex) =>
                                            entryIndex === groupIndex
                                              ? { ...entry, options: [...entry.options, createEmptyOption()] }
                                              : entry
                                          )
                                        )
                                      }
                                    >
                                      Add Option
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-danger btn-sm"
                                      onClick={() => setModifiers((current) => current.filter((_, entryIndex) => entryIndex !== groupIndex))}
                                    >
                                      Remove Group
                                    </button>
                                  </div>
                                </div>

                                <div style={{ display: 'grid', gap: 10 }}>
                                  {group.options.map((option, optionIndex) => (
                                    <div key={optionIndex} className="menu-option-row">
                                      <input
                                        className="input"
                                        value={option.name}
                                        onChange={(event) =>
                                          setModifiers((current) =>
                                            current.map((entry, entryIndex) =>
                                              entryIndex === groupIndex
                                                ? {
                                                    ...entry,
                                                    options: entry.options.map((optionEntry, optionEntryIndex) =>
                                                      optionEntryIndex === optionIndex
                                                        ? { ...optionEntry, name: event.target.value }
                                                        : optionEntry
                                                    ),
                                                  }
                                                : entry
                                            )
                                          )
                                        }
                                        placeholder="Extra cheese"
                                        required
                                      />
                                      <input
                                        className="input"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={option.price}
                                        onChange={(event) =>
                                          setModifiers((current) =>
                                            current.map((entry, entryIndex) =>
                                              entryIndex === groupIndex
                                                ? {
                                                    ...entry,
                                                    options: entry.options.map((optionEntry, optionEntryIndex) =>
                                                      optionEntryIndex === optionIndex
                                                        ? { ...optionEntry, price: event.target.value }
                                                        : optionEntry
                                                    ),
                                                  }
                                                : entry
                                            )
                                          )
                                        }
                                        placeholder="150"
                                      />
                                      <label className="menu-meta-chip" style={{ cursor: 'pointer', padding: '10px 12px' }}>
                                        <input
                                          type="checkbox"
                                          checked={option.isAvailable}
                                          onChange={(event) =>
                                            setModifiers((current) =>
                                              current.map((entry, entryIndex) =>
                                                entryIndex === groupIndex
                                                  ? {
                                                      ...entry,
                                                      options: entry.options.map((optionEntry, optionEntryIndex) =>
                                                        optionEntryIndex === optionIndex
                                                          ? { ...optionEntry, isAvailable: event.target.checked }
                                                          : optionEntry
                                                      ),
                                                    }
                                                  : entry
                                              )
                                            )
                                          }
                                          style={{ marginRight: 8 }}
                                        />
                                        Live
                                      </label>
                                      <button
                                        type="button"
                                        className="btn btn-danger btn-sm"
                                        onClick={() =>
                                          setModifiers((current) =>
                                            current.map((entry, entryIndex) =>
                                              entryIndex === groupIndex
                                                ? {
                                                    ...entry,
                                                    options: entry.options.length === 1
                                                      ? [createEmptyOption()]
                                                      : entry.options.filter((_, optionEntryIndex) => optionEntryIndex !== optionIndex),
                                                  }
                                                : entry
                                            )
                                          )
                                        }
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="menu-section-shell">
                      <div className="menu-section-head">
                        <div>
                          <div className="menu-section-title">Assets</div>
                          <div className="form-hint">Upload a product image, attach a 3D model, or request one from your team.</div>
                        </div>
                        {editItem ? (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openRequestModal(editItem)}>
                            Request Pro 3D
                          </button>
                        ) : null}
                      </div>

                      <div className="grid-2">
                        <div className="form-group">
                          <label className="form-label">Item Image</label>

                          <div className="menu-image-choice">
                            {stockImageUrl && !imageFile ? (
                              <img className="menu-image-choice-preview" src={stockImageUrl} alt="" />
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setPickerOpen((open) => !open)}
                            >
                              {pickerOpen ? 'Close pictures' : 'Pick a picture'}
                            </button>
                            {stockImageUrl && !imageFile ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setStockImageUrl(null)}
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>

                          {pickerOpen ? (
                            <StockImagePicker
                              value={stockImageUrl}
                              onChange={(url) => {
                                setStockImageUrl(url);
                                // A chosen picture and an uploaded one would
                                // contradict each other; the newer wins.
                                if (url) setImageFile(null);
                                setPickerOpen(false);
                              }}
                              onClose={() => setPickerOpen(false)}
                            />
                          ) : null}

                          <div className="form-hint" style={{ marginTop: 10 }}>Or upload your own</div>
                          <input
                            className="input"
                            type="file"
                            accept="image/*"
                            onChange={(event) => {
                              const chosen = event.target.files?.[0] || null;
                              setImageFile(chosen);
                              if (chosen) setStockImageUrl(null);
                            }}
                          />
                          {imageFile ? (
                            <div className="menu-file-note">Selected image: {imageFile.name}</div>
                          ) : stockImageUrl ? (
                            <div className="menu-file-note">A picture from our library is selected.</div>
                          ) : editItem?.imageUrl ? (
                            <div className="menu-file-note">Current image will remain unless replaced.</div>
                          ) : null}
                        </div>

                        <div className="form-group">
                          <label className="form-label">3D Model</label>
                          <input
                            className="input"
                            type="file"
                            accept=".glb,.gltf"
                            onChange={(event) => {
                              setModelFile(event.target.files?.[0] || null);
                              if (event.target.files?.[0]) {
                                setRemoveExistingModel(false);
                              }
                            }}
                          />
                          {modelFile ? (
                            <div className="menu-file-note">Selected model: {modelFile.name}</div>
                          ) : editItem?.modelUrl && !removeExistingModel ? (
                            <div className="menu-file-note">Existing 3D model is attached.</div>
                          ) : null}

                          {editItem?.modelUrl ? (
                            <label className="menu-meta-chip" style={{ cursor: 'pointer', padding: '10px 12px', marginTop: 10 }}>
                              <input
                                type="checkbox"
                                checked={removeExistingModel}
                                onChange={(event) => {
                                  setRemoveExistingModel(event.target.checked);
                                  if (event.target.checked) {
                                    setModelFile(null);
                                  }
                                }}
                                style={{ marginRight: 8 }}
                              />
                              Remove existing 3D model on save
                            </label>
                          ) : null}
                        </div>
                      </div>
                    </section>
                  </div>
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn btn-ghost" onClick={() => closeItemModal()}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Saving...' : editItem ? 'Update Item' : 'Create Item'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}

      {showRequestModal && canWrite ? (
        <div className="modal-overlay" onClick={closeRequestModal}>
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            style={{ width: 'min(560px, 94vw)', maxWidth: 560 }}
          >
            <div className="modal-header">
              <h2>Request Professional 3D Model</h2>
              <button className="btn btn-ghost btn-icon-sm" onClick={closeRequestModal}>
                ✕
              </button>
            </div>

            <form onSubmit={handleRequest3D}>
              <div className="modal-body">
                <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
                  Upload three to five clear photos of the dish from different angles. Include anything the 3D artist should pay attention to.
                </p>

                <div className="form-group">
                  <label className="form-label">Reference Images</label>
                  <input
                    className="input"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => setRequestImages(Array.from(event.target.files || []).slice(0, 5))}
                    required
                  />
                  <div className="form-hint">Up to five images. Front, top, and angle shots work best.</div>
                  {requestImages.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                      {requestImages.map((image) => (
                        <span key={`${image.name}-${image.size}`} className="menu-meta-chip">
                          {image.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="form-group">
                  <label className="form-label">Notes for the Artist</label>
                  <textarea
                    className="textarea"
                    value={requestNotes}
                    onChange={(event) => setRequestNotes(event.target.value)}
                    placeholder="Mention plating details, textures, garnish, packaging, or any hero angle you care about."
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={closeRequestModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submittingRequest}>
                  {submittingRequest ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
