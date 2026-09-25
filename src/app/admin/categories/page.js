'use client';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';

export default function CategoriesPage() {
  const { can } = useAdminAccess();
  const canWrite = can('categories.write');
  const canDelete = can('categories.delete');
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editCat, setEditCat] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', icon: '', sortOrder: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const res = await api.getCategories();
      setCategories(res.categories);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const openCreate = () => {
    setEditCat(null);
    setForm({ name: '', description: '', icon: '', sortOrder: 0 });
    setShowModal(true);
  };

  const openEdit = (cat) => {
    setEditCat(cat);
    setForm({ name: cat.name, description: cat.description || '', icon: cat.icon || '', sortOrder: cat.sortOrder });
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editCat) {
        await api.updateCategory(editCat.id, form);
      } else {
        await api.createCategory(form);
      }
      setShowModal(false);
      loadData();
    } catch (err) { alert(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this category? Items in this category will become uncategorized.')) return;
    try {
      await api.deleteCategory(id);
      loadData();
      toast.success('Category deleted');
    } catch (err) { toast.error(err.message); }
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header">
        <h1>Categories</h1>
        {canWrite && <button className="btn btn-primary" onClick={openCreate}>+ Add Category</button>}
      </div>

      {categories.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📂</div>
          <h3>No categories yet</h3>
          <p>Create categories to organize your menu.</p>
          {canWrite && <button className="btn btn-primary mt-md" onClick={openCreate}>+ Add Category</button>}
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Icon</th><th>Name</th><th>Items</th><th>Order</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {categories.map(cat => (
              <tr key={cat.id}>
                <td style={{ fontSize: 24 }}>{cat.icon || '📁'}</td>
                <td>
                  <strong>{cat.name}</strong>
                  {cat.description && <div style={{ fontSize: 12, color: '#94A3B8' }}>{cat.description}</div>}
                </td>
                <td>{cat._count?.menuItems || 0}</td>
                <td>{cat.sortOrder}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {canWrite && <button className="btn btn-ghost btn-sm" onClick={() => openEdit(cat)} aria-label={`Edit ${cat.name}`}>✏️</button>}
                    {canDelete && <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(cat.id)} aria-label={`Delete ${cat.name}`}>🗑️</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showModal && canWrite && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editCat ? 'Edit Category' : 'New Category'}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Name *</label>
                  <input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea className="textarea" value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Icon (emoji)</label>
                    <input className="input" value={form.icon} onChange={e => setForm({...form, icon: e.target.value})} placeholder="🍕" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Sort Order</label>
                    <input className="input" type="number" value={form.sortOrder} onChange={e => setForm({...form, sortOrder: parseInt(e.target.value) || 0})} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : editCat ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
