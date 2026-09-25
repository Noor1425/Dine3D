'use client';
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useOffline } from '@/components/offline/OfflineProvider';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';
import StockSheet from '@/components/inventory/StockSheet';
import '@/styles/stock-sheet.css';

const UNITS = ['KG', 'G', 'L', 'ML', 'PIECE', 'PACK', 'DOZEN', 'OZ', 'LB'];
const CHANGE_TYPES = [
  { value: 'MANUAL_ADD', label: 'Add Stock', color: '#16a34a' },
  { value: 'MANUAL_REMOVE', label: 'Remove Stock', color: '#dc2626' },
  { value: 'WASTE', label: 'Waste/Spoilage', color: '#f59e0b' },
  { value: 'ADJUSTMENT', label: 'Correction', color: '#6366f1' },
  { value: 'STOCK_COUNT_CORRECTION', label: 'Stock Count', color: '#0f766e' },
];
const EXPENSE_CATEGORY_COLORS = {
  RENT: '#7c3aed',
  UTILITIES: '#2563eb',
  PAYROLL: '#16a34a',
  DELIVERY: '#f59e0b',
  MAINTENANCE: '#ea580c',
  MARKETING: '#db2777',
  OTHER: '#64748b',
};

export default function InventoryPage() {
  const { can } = useAdminAccess();
  const canWrite = can('inventory.write');
  const canDelete = can('inventory.delete');
  const offline = useOffline();
  const [ingredients, setIngredients] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [stockLogs, setStockLogs] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [intelligence, setIntelligence] = useState({
    suggestions: [],
    waste: { totalWasteCost: 0, items: [] },
    foodCost: { items: [] },
    margins: { items: [] },
    costTrends: { trends: [] },
  });
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('stock'); // stock, alerts, logs, add
  const [showAdjust, setShowAdjust] = useState(null);
  const [adjustType, setAdjustType] = useState('MANUAL_ADD');
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newIngredient, setNewIngredient] = useState({ name: '', unit: 'PIECE', currentStock: '', lowStockThreshold: '10', costPerUnit: '', supplier: '' });
  const [search, setSearch] = useState('');
  // 'count' at closing, 'receive' when a delivery arrives. Null = sheet closed.
  const [sheetMode, setSheetMode] = useState(null);

  // `quiet` refreshes the figures without tearing the screen down to the
  // loading placeholder — which would unmount an open stock sheet and throw
  // away the result someone has just saved.
  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setLoading(true);
      const [ingRes, alertRes] = await Promise.all([
        api.getIngredients(),
        api.getLowStockAlerts()
      ]);
      setIngredients(ingRes.ingredients || []);
      setAlerts(alertRes.alerts || []);
    } catch (err) {
      console.error('Failed to load inventory:', err);
      const cached = await offline.getCachedBootstrap().catch(() => null);
      if (cached) setIngredients(cached.inventory || []);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [offline.getCachedBootstrap]);

  const loadLogs = async () => {
    try {
      const res = await api.getStockLogs('limit=50');
      setStockLogs(res.logs || []);
    } catch (err) {
      console.error('Failed to load logs:', err);
    }
  };

  const loadSuppliers = async () => {
    try {
      const [supRes, poRes] = await Promise.all([
        api.getSuppliers(),
        api.getPurchaseOrders()
      ]);
      setSuppliers(supRes.suppliers || []);
      setPurchaseOrders(poRes.purchaseOrders || []);
    } catch (err) {
      console.error('Failed to load suppliers/POs:', err);
      const cached = await offline.getCachedBootstrap().catch(() => null);
      if (cached) {
        setSuppliers(cached.suppliers || []);
        setPurchaseOrders(cached.purchaseOrders || []);
      }
    }
  };

  const loadIntelligence = async () => {
    try {
      const [suggestions, waste, foodCost, margins, costTrends] = await Promise.all([
        api.getReorderSuggestions(),
        api.getWasteAnalytics(),
        api.getFoodCostAnalytics(),
        api.getMarginAnalytics(),
        api.getCostTrends({ days: 60 }),
      ]);

      setIntelligence({
        suggestions: suggestions.suggestions || [],
        waste: waste || { totalWasteCost: 0, items: [] },
        foodCost: foodCost || { items: [] },
        margins: margins || { items: [] },
        costTrends: costTrends || { trends: [] },
      });
    } catch (err) {
      console.error('Failed to load intelligence:', err);
    }
  };

  const loadExpenses = async () => {
    try {
      const res = await api.getExpenses();
      setExpenses(res.expenses || []);
    } catch (err) {
      console.error('Failed to load expenses:', err);
    }
  };

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refreshFromEdge = async () => {
      const cached = await offline.getCachedBootstrap().catch(() => null);
      if (cached) setIngredients(cached.inventory || []);
    };
    window.addEventListener('dine3d-edge-inventory', refreshFromEdge);
    return () => window.removeEventListener('dine3d-edge-inventory', refreshFromEdge);
  }, [offline.getCachedBootstrap]);
  useEffect(() => { if (activeTab === 'logs') loadLogs(); }, [activeTab]);
  useEffect(() => { if (activeTab === 'suppliers') loadSuppliers(); }, [activeTab]);
  useEffect(() => { if (activeTab === 'intelligence') loadIntelligence(); }, [activeTab]);
  useEffect(() => { if (activeTab === 'expenses') loadExpenses(); }, [activeTab]);

  const [showPOModal, setShowPOModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [newExpense, setNewExpense] = useState({ category: 'OTHER', amount: '', vendor: '', notes: '' });
  const [newPO, setNewPO] = useState({ supplierId: '', items: [] });
  
  const handleCreatePO = async () => {
    try {
      if (!offline.isMeaningfullyOnline) throw new Error('Creating purchase orders is online-only. Previously synchronized purchase orders remain available for receiving.');
      await api.createPurchaseOrder({ ...newPO, expectedDate: new Date().toISOString() });
      setShowPOModal(false);
      setNewPO({ supplierId: '', items: [] });
      loadSuppliers();
    } catch (error) {
      alert(error.message);
    }
  };

  const handleApprovePO = async (poId) => {
    try {
      if (!offline.isMeaningfullyOnline) throw new Error('Purchase-order approval is online-only.');
      await api.approvePurchaseOrder(poId);
      loadSuppliers();
    } catch (error) {
      alert(error.message);
    }
  };

  const handleReceivePO = async (po) => {
    try {
      const receiveItems = (po.items || [])
        .map((item) => {
          const ordered = parseFloat(item.quantity || 0);
          const received = parseFloat(item.receivedQuantity || 0);
          const remaining = Math.max(0, ordered - received);
          if (remaining <= 0) return null;
          return {
            purchaseOrderItemId: item.id,
            ingredientId: item.ingredientId,
            receivedQty: remaining,
            acceptedQty: remaining,
            rejectedQty: 0,
            unitCost: parseFloat(item.unitCost || 0),
            qualityStatus: 'PASS',
          };
        })
        .filter(Boolean);

      if (receiveItems.length === 0) {
        alert('All PO lines are already fully received.');
        return;
      }

      await offline.receivePurchaseOrder({
        id: crypto.randomUUID(),
        purchaseOrderId: po.id,
        locationId: po.locationId,
        businessTimestamp: new Date().toISOString(),
        notes: 'Received via inventory screen',
        items: receiveItems,
      });
      const cached = await offline.getCachedBootstrap();
      setPurchaseOrders(cached.purchaseOrders || []);
      setIngredients(cached.inventory || []);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleCreateExpense = async () => {
    try {
      if (!offline.isMeaningfullyOnline) throw new Error('Expense creation is online-only in this version. Use an offline operational note if a record must be preserved now.');
      await api.createExpense({
        category: newExpense.category,
        amount: parseFloat(newExpense.amount || 0),
        vendor: newExpense.vendor || null,
        notes: newExpense.notes || null,
      });
      setShowExpenseModal(false);
      setNewExpense({ category: 'OTHER', amount: '', vendor: '', notes: '' });
      loadExpenses();
    } catch (error) {
      alert(error.message);
    }
  };

  const handleAddIngredient = async () => {
    if (!newIngredient.name) return;
    try {
      if (!offline.isMeaningfullyOnline) throw new Error('Creating inventory master data is online-only. Stock movements for cached items remain available offline.');
      await api.createIngredient({
        ...newIngredient,
        currentStock: parseFloat(newIngredient.currentStock || 0),
        lowStockThreshold: parseFloat(newIngredient.lowStockThreshold || 10),
        costPerUnit: parseFloat(newIngredient.costPerUnit || 0)
      });
      setShowAdd(false);
      setNewIngredient({ name: '', unit: 'PIECE', currentStock: '', lowStockThreshold: '10', costPerUnit: '', supplier: '' });
      load();
    } catch (err) {
      alert(err.message || 'Failed to add ingredient');
    }
  };

  const handleAdjust = async () => {
    if (!showAdjust || !adjustQty) return;
    try {
      if (!adjustNotes.trim()) throw new Error('A reason is required for every stock movement.');
      const ingredient = ingredients.find((item) => item.id === showAdjust);
      if (!ingredient) throw new Error('Inventory item not found');
      const entered = parseFloat(adjustQty);
      const quantityChange = adjustType === 'MANUAL_ADD'
        ? Math.abs(entered)
        : adjustType === 'STOCK_COUNT_CORRECTION'
          ? entered - parseFloat(ingredient.currentStock || 0)
          : -Math.abs(entered);
      if (quantityChange === 0) throw new Error('The stock movement would not change the current estimate.');
      await offline.adjustInventory({
        id: crypto.randomUUID(),
        inventoryItemId: showAdjust,
        locationId: ingredient.locationId,
        changeType: adjustType,
        quantityChange,
        reason: adjustNotes || (adjustType === 'STOCK_COUNT_CORRECTION' ? 'Offline stock count' : adjustType),
        businessTimestamp: new Date().toISOString(),
      });
      setShowAdjust(null);
      setAdjustQty('');
      setAdjustNotes('');
      const cached = await offline.getCachedBootstrap();
      setIngredients(cached.inventory || []);
    } catch (err) {
      alert(err.message || 'Failed to adjust stock');
    }
  };

  /**
   * The bulk sheet, unlike the single-item adjust, is server-only on purpose.
   * A count states what is on the shelf and the server works out the correction
   * inside the row lock; queueing that offline would apply a correction against
   * whatever the stock happened to be hours later, silently erasing the sales
   * in between.
   */
  const handleSheetSubmit = async (mode, payload) => {
    if (!offline.isMeaningfullyOnline) {
      throw new Error('A stock count needs the server so the correction is worked out against live stock. While offline, use \u00b1 Adjust on individual items.');
    }
    const result = mode === 'count'
      ? await api.recordStockCount(payload)
      : await api.receiveStock(payload);
    // A failed refresh must not hide a save that succeeded.
    await load({ quiet: true }).catch(() => {});
    return result;
  };

  const handleAcknowledge = async (alertId) => {
    try {
      await api.acknowledgeAlert(alertId);
      load();
    } catch (err) {
      alert(err.message || 'Failed to acknowledge');
    }
  };

  const handleDelete = async (id) => {
    if (!offline.isMeaningfullyOnline) return alert('Deactivating inventory master data is online-only. Stock history remains available offline.');
    if (!confirm('Deactivate this ingredient? Existing recipes and the complete stock-movement history will be preserved.')) return;
    try {
      await api.deleteIngredient(id);
      load();
    } catch (err) {
      alert(err.message || 'Failed to delete');
    }
  };

  const filteredIngredients = ingredients.filter(i =>
    !search || i.name.toLowerCase().includes(search.toLowerCase())
  );

  const lowStockCount = ingredients.filter(i =>
    parseFloat(i.currentStock) <= parseFloat(i.lowStockThreshold)
  ).length;
  const totalExpenseAmount = expenses.reduce((sum, exp) => sum + parseFloat(exp.amount || 0), 0);
  const currentMonthExpenseAmount = expenses
    .filter((exp) => {
      const dt = new Date(exp.expenseDate);
      const now = new Date();
      return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
    })
    .reduce((sum, exp) => sum + parseFloat(exp.amount || 0), 0);
  const expenseCategoriesCount = new Set(expenses.map((exp) => exp.category).filter(Boolean)).size;
  const avgGrossMargin = intelligence.margins.items.length
    ? intelligence.margins.items.reduce((sum, item) => sum + parseFloat(item.grossMarginPercent || 0), 0) / intelligence.margins.items.length
    : 0;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Loading Inventory...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>Inventory Management</h1>
          <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
            {ingredients.length} ingredients · {lowStockCount > 0 ? `⚠️ ${lowStockCount} low stock` : '✅ Stock levels healthy'}
          </p>
        </div>
        {canWrite && <button
          onClick={() => {
            if (activeTab === 'suppliers') setShowPOModal(true);
            else if (activeTab === 'expenses') setShowExpenseModal(true);
            else setShowAdd(true);
          }}
          style={{
            padding: '0.6rem 1.25rem', borderRadius: '0.5rem',
            border: 'none', background: '#1e293b', color: '#fff',
            fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer'
          }}
        >
          {activeTab === 'suppliers' ? '+ Create PO' : activeTab === 'expenses' ? '+ Add Expense' : '+ Add Ingredient'}
        </button>}
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total Ingredients', value: ingredients.length, color: '#3b82f6', icon: '📦' },
          { label: 'Low Stock Alerts', value: lowStockCount, color: lowStockCount > 0 ? '#dc2626' : '#16a34a', icon: '⚠️' },
          { label: 'Active Alerts', value: alerts.length, color: '#f59e0b', icon: '🔔' },
          { label: 'Total Value', value: `Rs. ${ingredients.reduce((s, i) => s + parseFloat(i.currentStock) * parseFloat(i.costPerUnit), 0).toFixed(0)}`, color: '#16a34a', icon: '💰' },
        ].map((stat, i) => (
          <div key={i} style={{
            background: '#fff', borderRadius: '0.75rem', padding: '1.25rem',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: '0.5rem' }}>
              {stat.icon} {stat.label}
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', background: '#f1f5f9', borderRadius: '0.5rem', padding: '0.25rem', width: 'fit-content' }}>
        {[
          { id: 'stock', label: 'Stock Levels' },
          { id: 'alerts', label: `Alerts (${alerts.length})` },
          { id: 'logs', label: 'Activity Log' },
          { id: 'suppliers', label: 'Suppliers & POs' },
          { id: 'intelligence', label: 'Intelligence' },
          { id: 'expenses', label: 'Expenses' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '0.4rem 1rem', borderRadius: '0.375rem', border: 'none',
              fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
              background: activeTab === tab.id ? '#1e293b' : 'transparent',
              color: activeTab === tab.id ? '#fff' : '#64748b'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'stock' && (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
            <input
              type="text"
              placeholder="Search ingredients..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                flex: '1 1 260px', maxWidth: '400px', padding: '0.5rem 1rem',
                borderRadius: '0.5rem', border: '1px solid #e2e8f0',
                fontSize: '0.8rem', outline: 'none'
              }}
            />
            {/* The two routines that actually happen every day: count the
                shelves at closing, book the delivery in the morning. */}
            {canWrite && ingredients.length > 0 && (
              <>
                <button
                  onClick={() => setSheetMode('count')}
                  style={{
                    padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none',
                    background: '#0f766e', color: '#fff',
                    fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer'
                  }}
                >
                  Closing stock count
                </button>
                <button
                  onClick={() => setSheetMode('receive')}
                  style={{
                    padding: '0.5rem 1rem', borderRadius: '0.5rem',
                    border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a',
                    fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer'
                  }}
                >
                  Receive delivery
                </button>
              </>
            )}
          </div>

          <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Ingredient</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#475569' }}>Current Stock</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#475569' }}>Threshold</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#475569' }}>Cost/Unit</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: 700, color: '#475569' }}>Status</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: 700, color: '#475569' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredIngredients.map(ing => {
                  const isLow = parseFloat(ing.currentStock) <= parseFloat(ing.lowStockThreshold);
                  const isEmpty = parseFloat(ing.currentStock) <= 0;
                  return (
                    <tr key={ing.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <div style={{ fontWeight: 600, color: '#1e293b' }}>{ing.name}</div>
                        {ing.supplier && <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Supplier: {ing.supplier}</div>}
                        {ing.menuItems?.length > 0 && (
                          <div style={{ fontSize: '0.6rem', color: '#6366f1' }}>
                            Used in: {ing.menuItems.map(mi => mi.menuItem?.name).filter(Boolean).join(', ')}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: isEmpty ? '#dc2626' : isLow ? '#f59e0b' : '#1e293b' }}>
                        {parseFloat(ing.currentStock).toFixed(1)} {ing.unit}
                        {ing.estimated && <span style={{ display: 'block', fontSize: '0.6rem', color: '#b45309' }}>Estimated · waiting to sync</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#64748b' }}>
                        {parseFloat(ing.lowStockThreshold).toFixed(1)}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#64748b' }}>
                        Rs. {parseFloat(ing.costPerUnit).toFixed(0)}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        <span style={{
                          padding: '0.2rem 0.6rem', borderRadius: '2rem', fontSize: '0.65rem', fontWeight: 600,
                          background: isEmpty ? '#fef2f2' : isLow ? '#fffbeb' : '#f0fdf4',
                          color: isEmpty ? '#dc2626' : isLow ? '#f59e0b' : '#16a34a'
                        }}>
                          {isEmpty ? 'OUT' : isLow ? 'LOW' : 'OK'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center' }}>
                          {canWrite && <button
                            onClick={() => setShowAdjust(ing.id)}
                            style={{
                              padding: '0.3rem 0.6rem', borderRadius: '0.25rem',
                              border: '1px solid #d1d5db', background: '#fff',
                              fontSize: '0.65rem', fontWeight: 600, cursor: 'pointer',
                              color: '#1e293b'
                            }}
                          >
                            ± Adjust
                          </button>}
                          {canDelete && <button
                            onClick={() => handleDelete(ing.id)}
                            style={{
                              padding: '0.3rem 0.5rem', borderRadius: '0.25rem',
                              border: 'none', background: '#fef2f2',
                              fontSize: '0.65rem', fontWeight: 600, cursor: 'pointer',
                              color: '#dc2626'
                            }}
                          >
                            ✕
                          </button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredIngredients.length === 0 && (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.8rem' }}>
                No ingredients found
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'alerts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {alerts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</div>
              <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No active low stock alerts</p>
            </div>
          ) : (
            alerts.map(alert => (
              <div key={alert.id} style={{
                background: '#fff', borderRadius: '0.75rem', padding: '1rem',
                border: '1px solid #fca5a5', borderLeft: '4px solid #dc2626',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#1e293b' }}>
                    ⚠️ {alert.ingredient?.name || 'Unknown'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.25rem' }}>
                    Stock: {parseFloat(alert.currentStock).toFixed(1)} {alert.ingredient?.unit || ''}
                    {' '} (Threshold: {parseFloat(alert.threshold).toFixed(1)})
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '0.15rem' }}>
                    {new Date(alert.createdAt).toLocaleString()}
                  </div>
                </div>
                {canWrite && <button
                  onClick={() => handleAcknowledge(alert.id)}
                  style={{
                    padding: '0.4rem 1rem', borderRadius: '0.375rem',
                    border: '1px solid #d1d5db', background: '#fff',
                    fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  Acknowledge
                </button>}
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'logs' && (
        <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 700 }}>Time</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 700 }}>Ingredient</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 700 }}>Type</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700 }}>Change</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700 }}>New Stock</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 700 }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {stockLogs.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.6rem 1rem', color: '#64748b' }}>
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td style={{ padding: '0.6rem 1rem', fontWeight: 600 }}>
                    {log.ingredient?.name || 'Unknown'}
                  </td>
                  <td style={{ padding: '0.6rem 1rem' }}>
                    <span style={{
                      padding: '0.15rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.65rem', fontWeight: 600,
                      background: log.changeType.includes('ADD') || log.changeType.includes('RESTORE') ? '#f0fdf4' :
                                  log.changeType.includes('DEDUCTION') ? '#fef2f2' : '#f8fafc',
                      color: log.changeType.includes('ADD') || log.changeType.includes('RESTORE') ? '#16a34a' :
                             log.changeType.includes('DEDUCTION') ? '#dc2626' : '#64748b'
                    }}>
                      {log.changeType.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={{
                    padding: '0.6rem 1rem', textAlign: 'right', fontWeight: 700,
                    color: parseFloat(log.quantityChange) >= 0 ? '#16a34a' : '#dc2626'
                  }}>
                    {parseFloat(log.quantityChange) >= 0 ? '+' : ''}{parseFloat(log.quantityChange).toFixed(1)}
                  </td>
                  <td style={{ padding: '0.6rem 1rem', textAlign: 'right', fontWeight: 600 }}>
                    {parseFloat(log.newStock).toFixed(1)}
                  </td>
                  <td style={{ padding: '0.6rem 1rem', color: '#94a3b8', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.notes || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {stockLogs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>No stock activity yet</div>
          )}
        </div>
      )}

      {activeTab === 'suppliers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* PO List */}
          <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: 700, color: '#1e293b' }}>
              Recent Purchase Orders
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 700 }}>PO Number</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 700 }}>Supplier</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 700 }}>Items</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700 }}>Total</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: 700 }}>Status</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: 700 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.map(po => (
                  <tr key={po.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{po.poNumber}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>{po.supplier?.name}</td>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>{po.items?.length} items</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600 }}>Rs. {parseFloat(po.totalAmount).toFixed(0)}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                      <span style={{
                        padding: '0.2rem 0.6rem', borderRadius: '2rem', fontSize: '0.65rem', fontWeight: 600,
                        background:
                          po.status === 'PENDING' ? '#fffbeb' :
                          po.status === 'APPROVED' ? '#eff6ff' :
                          po.status === 'PARTIALLY_RECEIVED' ? '#f5f3ff' :
                          po.status === 'RECEIVED' ? '#f0fdf4' : '#f8fafc',
                        color:
                          po.status === 'PENDING' ? '#f59e0b' :
                          po.status === 'APPROVED' ? '#2563eb' :
                          po.status === 'PARTIALLY_RECEIVED' ? '#7c3aed' :
                          po.status === 'RECEIVED' ? '#16a34a' : '#64748b'
                      }}>
                        {po.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                        {canWrite && (po.status === 'PENDING' || po.status === 'DRAFT') && (
                          <button
                            onClick={() => handleApprovePO(po.id)}
                            style={{
                              padding: '0.3rem 0.6rem', borderRadius: '0.25rem',
                              border: '1px solid #2563eb', background: '#eff6ff', color: '#2563eb',
                              fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer'
                            }}
                          >
                            Approve
                          </button>
                        )}
                        {canWrite && (po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED') && (
                          <button
                            onClick={() => handleReceivePO(po)}
                            style={{
                              padding: '0.3rem 0.6rem', borderRadius: '0.25rem',
                              border: '1px solid #16a34a', background: '#f0fdf4', color: '#16a34a',
                              fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer'
                            }}
                          >
                            Receive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {purchaseOrders.length === 0 && (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>No purchase orders found</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'intelligence' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
            <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', padding: '1rem' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>REORDER SIGNALS</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f59e0b' }}>{intelligence.suggestions.length}</div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Ingredients flagged for restock</div>
            </div>

            <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', padding: '1rem' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>TOTAL WASTE COST</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#dc2626' }}>Rs. {parseFloat(intelligence.waste.totalWasteCost || 0).toFixed(0)}</div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Across {intelligence.waste.items?.length || 0} ingredients</div>
            </div>

            <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', padding: '1rem' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>AVG GROSS MARGIN</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: avgGrossMargin >= 60 ? '#16a34a' : avgGrossMargin >= 45 ? '#f59e0b' : '#dc2626' }}>
                {avgGrossMargin.toFixed(1)}%
              </div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Menu portfolio health</div>
            </div>

            <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', padding: '1rem' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>PRICE HISTORY POINTS</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#2563eb' }}>{intelligence.costTrends.trends?.length || 0}</div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Supplier cost captures in lookback window</div>
            </div>
          </div>

          <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '0.85rem 1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: 700, color: '#1e293b' }}>
              Reorder Suggestions
            </div>
            {intelligence.suggestions.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
                No urgent reorder suggestions right now
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'left', fontWeight: 700 }}>Ingredient</th>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'right', fontWeight: 700 }}>Current</th>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'right', fontWeight: 700 }}>Reorder Point</th>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'right', fontWeight: 700 }}>Avg Daily Use</th>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'right', fontWeight: 700 }}>Suggested Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {intelligence.suggestions.slice(0, 20).map((row) => (
                    <tr key={row.ingredientId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.65rem 0.85rem', fontWeight: 600, color: '#1e293b' }}>{row.ingredientName}</td>
                      <td style={{ padding: '0.65rem 0.85rem', textAlign: 'right', color: '#475569' }}>
                        {parseFloat(row.currentStock || 0).toFixed(2)} {row.unit}
                      </td>
                      <td style={{ padding: '0.65rem 0.85rem', textAlign: 'right', color: '#475569' }}>
                        {parseFloat(row.reorderPoint || 0).toFixed(2)}
                      </td>
                      <td style={{ padding: '0.65rem 0.85rem', textAlign: 'right', color: '#475569' }}>
                        {parseFloat(row.avgDailyUsage || 0).toFixed(2)}
                      </td>
                      <td style={{ padding: '0.65rem 0.85rem', textAlign: 'right', fontWeight: 700, color: '#f59e0b' }}>
                        {parseFloat(row.suggestedQty || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
            <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '0.85rem 1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: 700, color: '#1e293b' }}>
                Waste Hotspots
              </div>
              {(intelligence.waste.items || []).length === 0 ? (
                <div style={{ padding: '1.25rem', color: '#94a3b8', fontSize: '0.78rem', textAlign: 'center' }}>
                  No waste records in selected range
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {(intelligence.waste.items || []).slice(0, 8).map((item) => (
                    <div key={item.ingredientId} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.65rem 0.85rem', borderBottom: '1px solid #f8fafc' }}>
                      <div>
                        <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#1e293b' }}>{item.ingredientName}</div>
                        <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{parseFloat(item.quantity || 0).toFixed(2)} {item.unit}</div>
                      </div>
                      <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#dc2626' }}>Rs. {parseFloat(item.estimatedCost || 0).toFixed(0)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '0.85rem 1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: 700, color: '#1e293b' }}>
                Margin Tracker
              </div>
              {(intelligence.margins.items || []).length === 0 ? (
                <div style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>
                    {intelligence.margins.coverage?.missing
                      ? `${intelligence.margins.coverage.missing} of ${intelligence.margins.coverage.total} dishes have no costed recipe`
                      : 'No menu margin data available'}
                  </div>
                  {intelligence.margins.coverage?.missing ? (
                    <div style={{ marginTop: '0.4rem', fontSize: '0.7rem', lineHeight: 1.5, color: '#94a3b8' }}>
                      Add ingredients and their cost to a dish to see what it earns.
                      The same recipes deduct stock when the dish is sold, so until they exist
                      selling does not move your inventory either.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {intelligence.margins.coverage?.missing ? (
                    <div style={{ padding: '0.5rem 0.85rem', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: '0.68rem', color: '#92400e' }}>
                      {intelligence.margins.coverage.missing} more {intelligence.margins.coverage.missing === 1 ? 'dish is' : 'dishes are'} not costed yet and cannot be ranked here.
                    </div>
                  ) : null}
                  {(intelligence.margins.items || []).slice(0, 8).map((item) => (
                    <div key={item.menuItemId} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.65rem 0.85rem', borderBottom: '1px solid #f8fafc' }}>
                      <div>
                        <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#1e293b' }}>{item.name}</div>
                        <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Food Cost: Rs. {parseFloat(item.foodCost || 0).toFixed(0)} / Sale: Rs. {parseFloat(item.salePrice || 0).toFixed(0)}</div>
                      </div>
                      <div style={{
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        color: parseFloat(item.grossMarginPercent || 0) >= 60 ? '#16a34a' : parseFloat(item.grossMarginPercent || 0) >= 45 ? '#f59e0b' : '#dc2626'
                      }}>
                        {parseFloat(item.grossMarginPercent || 0).toFixed(1)}%
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '0.85rem 1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: 700, color: '#1e293b' }}>
              Supplier Cost Trend Feed
            </div>
            {(intelligence.costTrends.trends || []).length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
                No supplier price captures yet
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'left', fontWeight: 700 }}>Date</th>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'left', fontWeight: 700 }}>Ingredient</th>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'left', fontWeight: 700 }}>Supplier</th>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'right', fontWeight: 700 }}>Unit Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(intelligence.costTrends.trends || [])].slice(-20).reverse().map((row) => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.65rem 0.85rem', color: '#475569' }}>{new Date(row.capturedAt).toLocaleDateString()}</td>
                      <td style={{ padding: '0.65rem 0.85rem', fontWeight: 600, color: '#1e293b' }}>{row.ingredient?.name || 'Unknown'} {row.ingredient?.unit ? `(${row.ingredient.unit})` : ''}</td>
                      <td style={{ padding: '0.65rem 0.85rem', color: '#475569' }}>{row.supplier?.name || 'Unknown'}</td>
                      <td style={{ padding: '0.65rem 0.85rem', textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>Rs. {parseFloat(row.unitCost || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'expenses' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
            <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', padding: '1rem' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>TOTAL EXPENSES</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#dc2626' }}>Rs. {totalExpenseAmount.toFixed(0)}</div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>All recorded expense entries</div>
            </div>

            <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', padding: '1rem' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>THIS MONTH</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f59e0b' }}>Rs. {currentMonthExpenseAmount.toFixed(0)}</div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Current month spend</div>
            </div>

            <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', padding: '1rem' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>CATEGORIES USED</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#2563eb' }}>{expenseCategoriesCount}</div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Distinct expense categories</div>
            </div>

            <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', padding: '1rem' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>TOTAL RECORDS</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#16a34a' }}>{expenses.length}</div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Expense entries tracked</div>
            </div>
          </div>

          <div style={{ background: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '0.85rem 1rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: 700, color: '#1e293b' }}>
              Expense Ledger
            </div>
            {expenses.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
                No expenses recorded yet
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'left', fontWeight: 700 }}>Date</th>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'left', fontWeight: 700 }}>Category</th>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'left', fontWeight: 700 }}>Vendor</th>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'left', fontWeight: 700 }}>Notes</th>
                    <th style={{ padding: '0.65rem 0.85rem', textAlign: 'right', fontWeight: 700 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((exp) => (
                    <tr key={exp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.65rem 0.85rem', color: '#475569' }}>{new Date(exp.expenseDate).toLocaleDateString()}</td>
                      <td style={{ padding: '0.65rem 0.85rem' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '0.18rem 0.55rem',
                          borderRadius: '999px',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          background: `${EXPENSE_CATEGORY_COLORS[exp.category] || '#64748b'}20`,
                          color: EXPENSE_CATEGORY_COLORS[exp.category] || '#64748b'
                        }}>
                          {exp.category}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem 0.85rem', color: '#1e293b' }}>{exp.vendor || '—'}</td>
                      <td style={{ padding: '0.65rem 0.85rem', color: '#64748b' }}>{exp.notes || '—'}</td>
                      <td style={{ padding: '0.65rem 0.85rem', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>Rs. {parseFloat(exp.amount || 0).toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Stock Adjust Modal */}
      {showAdjust && canWrite && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: '#fff', borderRadius: '1rem', padding: '2rem',
            width: '400px', maxWidth: '90vw', boxShadow: '0 25px 50px rgba(0,0,0,0.25)'
          }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#1e293b', marginBottom: '1rem' }}>
              Adjust Stock
            </h3>

            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {CHANGE_TYPES.map(ct => (
                <button
                  key={ct.value}
                  onClick={() => setAdjustType(ct.value)}
                  style={{
                    padding: '0.4rem 0.75rem', borderRadius: '0.375rem',
                    border: adjustType === ct.value ? `2px solid ${ct.color}` : '1px solid #d1d5db',
                    background: adjustType === ct.value ? `${ct.color}15` : '#fff',
                    color: adjustType === ct.value ? ct.color : '#64748b',
                    fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  {ct.label}
                </button>
              ))}
            </div>

            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
              {adjustType === 'STOCK_COUNT_CORRECTION' ? 'Counted stock on hand' : 'Movement quantity'}
            </label>
            <input
              type="number"
              value={adjustQty}
              onChange={e => setAdjustQty(e.target.value)}
              placeholder="0"
              style={{
                width: '100%', padding: '0.6rem', borderRadius: '0.5rem',
                border: '1px solid #d1d5db', fontSize: '1rem', fontWeight: 700,
                marginBottom: '0.75rem', outline: 'none'
              }}
              autoFocus
            />

            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
              Notes (optional)
            </label>
            <input
              type="text"
              value={adjustNotes}
              onChange={e => setAdjustNotes(e.target.value)}
              placeholder="Required reason for this movement"
              style={{
                width: '100%', padding: '0.5rem', borderRadius: '0.5rem',
                border: '1px solid #d1d5db', fontSize: '0.8rem',
                marginBottom: '1rem', outline: 'none'
              }}
            />

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => { setShowAdjust(null); setAdjustQty(''); setAdjustNotes(''); }}
                style={{
                  flex: 1, padding: '0.6rem', borderRadius: '0.5rem',
                  border: '1px solid #d1d5db', background: '#fff',
                  fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAdjust}
                disabled={!adjustQty}
                style={{
                  flex: 1, padding: '0.6rem', borderRadius: '0.5rem',
                  border: 'none', background: '#1e293b', color: '#fff',
                  fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                  opacity: adjustQty ? 1 : 0.5
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Ingredient Modal */}
      {showAdd && canWrite && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: '#fff', borderRadius: '1rem', padding: '2rem',
            width: '460px', maxWidth: '90vw', boxShadow: '0 25px 50px rgba(0,0,0,0.25)'
          }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#1e293b', marginBottom: '1.25rem' }}>
              Add New Ingredient
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.2rem' }}>Name *</label>
                <input value={newIngredient.name} onChange={e => setNewIngredient(p => ({ ...p, name: e.target.value }))}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.8rem', outline: 'none' }} autoFocus />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.2rem' }}>Unit</label>
                  <select value={newIngredient.unit} onChange={e => setNewIngredient(p => ({ ...p, unit: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.8rem', outline: 'none' }}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.2rem' }}>Initial Stock</label>
                  <input type="number" value={newIngredient.currentStock} onChange={e => setNewIngredient(p => ({ ...p, currentStock: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.8rem', outline: 'none' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.2rem' }}>Low Stock Threshold</label>
                  <input type="number" value={newIngredient.lowStockThreshold} onChange={e => setNewIngredient(p => ({ ...p, lowStockThreshold: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.8rem', outline: 'none' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.2rem' }}>Cost/Unit (Rs.)</label>
                  <input type="number" value={newIngredient.costPerUnit} onChange={e => setNewIngredient(p => ({ ...p, costPerUnit: e.target.value }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.8rem', outline: 'none' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.2rem' }}>Supplier (optional)</label>
                <input value={newIngredient.supplier} onChange={e => setNewIngredient(p => ({ ...p, supplier: e.target.value }))}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.8rem', outline: 'none' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button onClick={() => setShowAdd(false)} style={{
                flex: 1, padding: '0.6rem', borderRadius: '0.5rem',
                border: '1px solid #d1d5db', background: '#fff',
                fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer'
              }}>Cancel</button>
              <button onClick={handleAddIngredient} disabled={!newIngredient.name} style={{
                flex: 1, padding: '0.6rem', borderRadius: '0.5rem',
                border: 'none', background: '#1e293b', color: '#fff',
                fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                opacity: newIngredient.name ? 1 : 0.5
              }}>Add Ingredient</button>
            </div>
          </div>
        </div>
      )}

      {/* Create PO Modal */}
      {showPOModal && canWrite && (
         <div style={{
           position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
           display: 'flex', alignItems: 'center', justifyContent: 'center',
           zIndex: 1000, backdropFilter: 'blur(4px)'
         }}>
           <div style={{
             background: '#fff', borderRadius: '1rem', padding: '2rem',
             width: '500px', maxWidth: '90vw', boxShadow: '0 25px 50px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto'
           }}>
             <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e293b', marginBottom: '1rem' }}>Create Purchase Order</h3>
             
             <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.2rem' }}>Select Supplier</label>
             <select value={newPO.supplierId} onChange={e => setNewPO(p => ({ ...p, supplierId: e.target.value }))} style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.8rem', marginBottom: '1rem' }}>
               <option value="">-- Choose Supplier --</option>
               {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
             </select>

             <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.2rem' }}>Add Ingredients to PO</label>
             <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem', padding: '0.5rem', background: '#f8fafc', borderRadius: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <select id="po-ingredient" style={{ flex: 2, padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.8rem' }}>
                    {ingredients.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                  <input type="number" id="po-quantity" placeholder="Qty" style={{ flex: 1, padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.8rem' }} />
                  <input type="number" id="po-cost" placeholder="Unit Cost" style={{ flex: 1, padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.8rem' }} />
                  <button onClick={() => {
                     const ingId = document.getElementById('po-ingredient').value;
                     const qty = document.getElementById('po-quantity').value;
                     const cost = document.getElementById('po-cost').value;
                     if (!qty || !cost) return;
                     setNewPO(p => ({ ...p, items: [...p.items, { ingredientId: ingId, quantity: parseFloat(qty), unitCost: parseFloat(cost) }] }));
                     document.getElementById('po-quantity').value = '';
                  }} style={{ background: '#1e293b', color: '#fff', border: 'none', borderRadius: '0.375rem', padding: '0 0.75rem' }}>Add</button>
                </div>
             </div>

             <div style={{ marginBottom: '1rem' }}>
               {newPO.items.map((item, idx) => (
                 <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', borderBottom: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
                   <span>{ingredients.find(i => i.id === item.ingredientId)?.name}</span>
                   <span>{item.quantity} x Rs. {item.unitCost}</span>
                 </div>
               ))}
               <div style={{ textAlign: 'right', fontWeight: 800, marginTop: '0.5rem' }}>
                 Total: Rs. {newPO.items.reduce((s, i) => s + (i.quantity * i.unitCost), 0).toFixed(0)}
               </div>
             </div>

             <div style={{ display: 'flex', gap: '0.5rem' }}>
               <button onClick={() => setShowPOModal(false)} style={{ flex: 1, padding: '0.6rem', border: '1px solid #d1d5db', background: '#fff', borderRadius: '0.5rem', fontWeight: 600 }}>Cancel</button>
               <button onClick={handleCreatePO} disabled={!newPO.supplierId || newPO.items.length === 0} style={{ flex: 1, padding: '0.6rem', border: 'none', background: '#1e293b', color: '#fff', borderRadius: '0.5rem', fontWeight: 600 }}>Create PO</button>
             </div>
           </div>
         </div>
      )}

      {/* The daily stock sheet — one list, one submit. */}
      {sheetMode && canWrite && (
        <StockSheet
          mode={sheetMode}
          ingredients={ingredients}
          currency="Rs."
          onSubmit={handleSheetSubmit}
          onClose={() => setSheetMode(null)}
        />
      )}

      {/* Add Expense Modal */}
      {showExpenseModal && canWrite && (
         <div style={{
           position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
           display: 'flex', alignItems: 'center', justifyContent: 'center',
           zIndex: 1000, backdropFilter: 'blur(4px)'
         }}>
           <div style={{
             background: '#fff', borderRadius: '1rem', padding: '2rem',
             width: '460px', maxWidth: '90vw', boxShadow: '0 25px 50px rgba(0,0,0,0.25)'
           }}>
             <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b', marginBottom: '1rem' }}>Record Expense</h3>

             <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
               <div>
                 <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.2rem' }}>Category</label>
                 <select
                   value={newExpense.category}
                   onChange={(e) => setNewExpense((p) => ({ ...p, category: e.target.value }))}
                   style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.8rem', outline: 'none' }}
                 >
                   <option value="RENT">RENT</option>
                   <option value="UTILITIES">UTILITIES</option>
                   <option value="PAYROLL">PAYROLL</option>
                   <option value="DELIVERY">DELIVERY</option>
                   <option value="MAINTENANCE">MAINTENANCE</option>
                   <option value="MARKETING">MARKETING</option>
                   <option value="OTHER">OTHER</option>
                 </select>
               </div>

               <div>
                 <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.2rem' }}>Amount (Rs.)</label>
                 <input
                   type="number"
                   value={newExpense.amount}
                   onChange={(e) => setNewExpense((p) => ({ ...p, amount: e.target.value }))}
                   placeholder="0"
                   style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.8rem', outline: 'none' }}
                 />
               </div>

               <div>
                 <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.2rem' }}>Vendor (optional)</label>
                 <input
                   type="text"
                   value={newExpense.vendor}
                   onChange={(e) => setNewExpense((p) => ({ ...p, vendor: e.target.value }))}
                   placeholder="Vendor name"
                   style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.8rem', outline: 'none' }}
                 />
               </div>

               <div>
                 <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.2rem' }}>Notes (optional)</label>
                 <textarea
                   value={newExpense.notes}
                   onChange={(e) => setNewExpense((p) => ({ ...p, notes: e.target.value }))}
                   placeholder="Expense details"
                   rows={3}
                   style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', fontSize: '0.8rem', outline: 'none', resize: 'vertical' }}
                 />
               </div>
             </div>

             <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
               <button onClick={() => setShowExpenseModal(false)} style={{
                 flex: 1, padding: '0.6rem', borderRadius: '0.5rem',
                 border: '1px solid #d1d5db', background: '#fff',
                 fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer'
               }}>Cancel</button>
               <button onClick={handleCreateExpense} disabled={!newExpense.amount || parseFloat(newExpense.amount) <= 0} style={{
                 flex: 1, padding: '0.6rem', borderRadius: '0.5rem',
                 border: 'none', background: '#1e293b', color: '#fff',
                 fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                 opacity: newExpense.amount && parseFloat(newExpense.amount) > 0 ? 1 : 0.5
               }}>Save Expense</button>
             </div>
           </div>
         </div>
      )}
    </div>
  );
}
