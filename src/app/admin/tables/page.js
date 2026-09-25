'use client';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';

export default function TablesPage() {
  const { can } = useAdminAccess();
  const canCreate = can('tables.create');
  const canWrite = can('tables.write');
  const canDelete = can('tables.delete');
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ tableNumber: '', label: '' });
  const [saving, setSaving] = useState(false);
  const [restaurant, setRestaurant] = useState(null);

  useEffect(() => {
    loadData();
    try { const saved = localStorage.getItem('dine3d_restaurant'); if (saved) setRestaurant(JSON.parse(saved)); } catch (e) {}
  }, []);

  const loadData = async () => {
    try { const res = await api.getTables(); setTables(res.tables); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleCreate = async (e) => {
    e.preventDefault(); setSaving(true);
    try { await api.createTable(form); setShowModal(false); setForm({tableNumber:'',label:''}); loadData(); toast.success('Table created!'); }
    catch (err) { toast.error(err.message); } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this table and its QR code? Any code already printed for it stops working.')) return;
    try {
      // The server says which of the two happened: a table nobody has ordered
      // on is removed outright, one with order history is retired so its past
      // orders keep their table. Claiming "deleted" for both is how this page
      // ended up showing tables the owner had already deleted.
      const result = await api.deleteTable(id);
      loadData();
      toast.success(result?.message || 'Table deleted');
    } catch (err) { toast.error(err.message); }
  };

  const handleRegenerateQR = async (id) => {
    try { await api.regenerateQR(id); loadData(); toast.success('QR generated!'); } catch (err) { toast.error(err.message); }
  };

  const getMenuUrl = (table) => {
    if (!table.isQrActive || table.qrRevokedAt) return '';
    return api.getFullStoreUrl(restaurant, table.qrToken);
  };

  if (loading) return (
    <div>
      <div className="page-header"><div className="skeleton skeleton-heading" /></div>
      <div className="table-grid">
        {[1,2,3].map(i => <div key={i} className="skeleton" style={{height:320,borderRadius:16}} />)}
      </div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Tables & QR</h1>
          <div className="page-header-subtitle">{tables.length} table{tables.length!==1?'s':''} configured</div>
        </div>
        {canCreate && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Add Table</button>}
      </div>

      {tables.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📱</div>
            <h3>No tables yet</h3>
            <p>Create tables and generate QR codes for contactless ordering.</p>
            {canCreate && <button className="btn btn-primary mt-md" onClick={() => setShowModal(true)}>+ Add Table</button>}
          </div>
        </div>
      ) : (
        <div className="table-grid">
          {tables.map((table, i) => (
            <div key={table.id} className="table-card animate-in" style={{animationDelay:`${i*60}ms`}}>
              <div style={{fontSize:32, marginBottom:8}}>🪑</div>
              <div className="table-card-number">Table {table.tableNumber}</div>
              {table.label && <div className="table-card-label">{table.label}</div>}

              <div className="table-card-qr">
                {table.qrCodeUrl ? (
                  <img src={table.qrCodeUrl} alt={`QR for Table ${table.tableNumber}`} />
                ) : (
                  <span style={{fontSize:13, color:'var(--color-text-muted)', padding:16}}>QR pending</span>
                )}
              </div>

              <div className="table-card-url">{getMenuUrl(table) || 'QR ordering inactive'}</div>

              <div className="table-card-actions">
                {getMenuUrl(table) && (
                  <a 
                    href={getMenuUrl(table)} 
                    target="_blank" 
                    className="btn btn-outline btn-sm"
                    style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    👁️ View Live
                  </a>
                )}
                {canWrite && <button className="btn btn-outline btn-sm" onClick={() => handleRegenerateQR(table.id)}>🔄 Regenerate</button>}
                {canDelete && <button className="btn btn-danger btn-sm" onClick={() => handleDelete(table.id)}>🗑️ Delete</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && canCreate && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Table</h2>
              <button className="btn btn-ghost btn-icon-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Table Number *</label>
                  <input className="input" value={form.tableNumber} onChange={e => setForm({...form, tableNumber: e.target.value})} required placeholder="1" />
                </div>
                <div className="form-group">
                  <label className="form-label">Label (optional)</label>
                  <input className="input" value={form.label} onChange={e => setForm({...form, label: e.target.value})} placeholder="Patio Table 1" />
                  <div className="form-hint">An optional description for this table</div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create Table'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
