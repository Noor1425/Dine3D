'use client';
import { useInputDialog } from '@/components/ui/InputDialog';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { RequestDeduplicator } from '@/lib/debounce';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';

const STATUS_META = {
  CREATED: { label: 'Created', emoji: '🧾', color: 'bg-slate-100 text-slate-800 border-slate-200' },
  PENDING: { label: 'Pending', emoji: '🕐', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  CONFIRMED: { label: 'Confirmed', emoji: '✅', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  PREPARING: { label: 'Preparing', emoji: '👨‍🍳', color: 'bg-orange-100 text-orange-800 border-orange-200' },
  READY: { label: 'Ready', emoji: '🔔', color: 'bg-green-100 text-green-800 border-green-200' },
  SERVED: { label: 'Served', emoji: '🍽️', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  DELIVERED: { label: 'Delivered', emoji: '✓', color: 'bg-neutral-100 text-neutral-600 border-neutral-200' },
  PICKED_UP: { label: 'Picked Up', emoji: '🥡', color: 'bg-teal-100 text-teal-600 border-teal-200' },
  COMPLETED: { label: 'Completed', emoji: '✔️', color: 'bg-neutral-100 text-neutral-600 border-neutral-200' },
  REFUNDED: { label: 'Refunded', emoji: '↩️', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  FAILED: { label: 'Failed', emoji: '⚠️', color: 'bg-red-50 text-red-700 border-red-200' },
  CANCELLED: { label: 'Cancelled', emoji: '✗', color: 'bg-red-100 text-red-700 border-red-200' },
};

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', PKR: 'Rs.', AED: 'د.إ', SAR: 'ر.س', INR: '₹' };
const ORDER_FILTER_TABS = ['', 'CREATED', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'DELIVERED', 'PICKED_UP', 'COMPLETED', 'REFUNDED', 'FAILED', 'CANCELLED'];
const DATE_RANGE_OPTIONS = [
  { value: 'ALL', label: 'All Time' },
  { value: 'TODAY', label: 'Today' },
  { value: 'WEEK', label: 'This Week' },
  { value: 'MONTH', label: '30 Days' },
  { value: 'CUSTOM', label: 'Custom' },
];
const TERMINAL_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED']);
const ACTION_REQUIRED_STATUSES = new Set(['CREATED', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY']);

const normalizeText = (value) => String(value ?? '').trim().toLowerCase();

const parseLocalDateInput = (value) => {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const getStartOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const getEndOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const getStartOfWeek = (value = new Date()) => {
  const date = getStartOfDay(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
};

const matchesDateRange = (createdAt, range, fromDate, toDate) => {
  if (!createdAt) return false;

  const orderDate = new Date(createdAt);
  if (Number.isNaN(orderDate.getTime())) return false;

  const now = new Date();

  switch (range) {
    case 'TODAY':
      return orderDate >= getStartOfDay(now) && orderDate <= getEndOfDay(now);
    case 'WEEK':
      return orderDate >= getStartOfWeek(now) && orderDate <= getEndOfDay(now);
    case 'MONTH': {
      const start = getStartOfDay(now);
      start.setDate(start.getDate() - 29);
      return orderDate >= start && orderDate <= getEndOfDay(now);
    }
    case 'CUSTOM': {
      const parsedFrom = parseLocalDateInput(fromDate);
      const parsedTo = parseLocalDateInput(toDate);

      if (parsedFrom && orderDate < getStartOfDay(parsedFrom)) return false;
      if (parsedTo && orderDate > getEndOfDay(parsedTo)) return false;
      return true;
    }
    case 'ALL':
    default:
      return true;
  }
};

const getOrderSearchText = (order) => {
  const items = (order.items || [])
    .map((item) => [
      item.name,
      item.variantName,
      item.notes,
      ...(item.modifiers || []).map((modifier) => modifier.option),
    ].filter(Boolean).join(' '))
    .join(' ');

  return normalizeText([
    order.orderNumber,
    order.customerName,
    order.customerPhone,
    order.status,
    order.orderType?.replaceAll('_', ' '),
    order.table?.tableNumber,
    order.table?.label,
    order.notes,
    items,
  ].filter(Boolean).join(' '));
};

export default function OrdersPage() {
  // window.prompt() throws inside the Electron till, so a browser prompt is a
  // control that silently does nothing on the device staff actually use.
  const [inputDialog, askForInput] = useInputDialog();
  const { can } = useAdminAccess();
  const canUpdateStatus = can('orders.status');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [restaurantId, setRestaurantId] = useState(null);
  const [currency, setCurrency] = useState('PKR');
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [etaOrder, setEtaOrder] = useState(null);
  const [etaMinutes, setEtaMinutes] = useState('');
  const [, setUpdateTrigger] = useState(0); // ✅ Force re-renders after requests
  const etaRef = useRef(null);
  
  // ✅ PRODUCTION FIX: Track in-flight requests to prevent duplicates
  const inFlightRequests = useRef(new Map()); // orderId -> inFlightFlag
  const deduplicator = useRef(new RequestDeduplicator());

  const { on } = useSocket({ restaurantId });

  useEffect(() => {
    // 1. First, load restaurant context from localStorage
    try {
      const saved = localStorage.getItem('dine3d_restaurant');
      if (saved) {
        const restaurant = JSON.parse(saved);
        setRestaurantId(restaurant.id);
        setCurrency(restaurant.currency || 'PKR');
      }
    } catch (e) {
      console.error('[ORDERS] Failed to load restaurant context:', e);
    }
  }, []);

  // Separate effect: load orders when restaurantId is ready
  useEffect(() => {
    if (!restaurantId) return; // Don't load until restaurant ID is set
    loadData();
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId) return;
    on('new-order', (order) => {
      setOrders(prev => {
        if (prev.find(o => o.id === order.id)) return prev;
        return [order, ...prev];
      });
      toast.success(`🔔 New order from ${order.table ? `Table ${order.table.tableNumber}` : 'Walk-in'}`);
    });
    on('order-updated', (updated) => {
      setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
    });
  }, [restaurantId, on]);

  const loadData = async () => {
    if (!restaurantId) return; // Guard: don't fetch if no restaurant context
    
    try {
      setLoading(true);
      // Fetch all orders regardless of current filter to enable instant tab switching
      const res = await api.getOrders(''); 
      if (!res || !res.orders) {
        console.warn('[ORDERS] Invalid orders response:', res);
        setOrders([]);
        return;
      }
      setOrders(res.orders);
    } catch (err) { 
      console.error('[ORDERS] Failed to load orders:', err);
      setOrders([]); // Set empty list on error
    }
    finally { 
      setLoading(false); 
    }
  };

  /**
   * ✅ PRODUCTION FIX: updateStatus with request deduplication
   * 
   * Prevents multiple identical simultaneous requests:
   * - User clicks button twice rapidly → Only ONE API request
   * - Duplicates are automatically rejected before hitting server
   * - Button stays disabled during entire request
   */
  const updateStatus = useCallback(async (orderId, status, minutes, reason) => {
    let originalOrders = null;  // ✅ FIX: Define outside try block for catch scope
    
    // ✅ CRITICAL: Prevent multiple concurrent requests for same order
    const requestKey = `${orderId}_${status}_${minutes || 'no-eta'}_${reason || 'no-reason'}`;
    
    // Return early if already processing this request
    if (inFlightRequests.current.has(orderId)) {
      console.warn(`[DEDUP] Blocked duplicate request for order ${orderId}`);
      return;
    }
    
    // Mark this order as in-flight
    inFlightRequests.current.set(orderId, true);
    
    try {
      // ✅ Convert minutes to number if provided (input field returns string)
      const numMinutes = minutes ? parseInt(minutes, 10) : undefined;
      // 1. Optimistic Update
      originalOrders = [...orders];  // ✅ Now in scope for catch block
      setOrders(prev => prev.map(o => o.id === orderId ? { 
        ...o, 
        status, 
        estimatedDelivery: numMinutes ? new Date(Date.now() + numMinutes * 60000).toISOString() : o.estimatedDelivery 
      } : o));
      // 2. API Request (use deduplicator to prevent parallel duplicates)
      await deduplicator.current.execute(requestKey, async () => {
        return await api.patch(`/orders/${orderId}/status`, {
          status,
          estimatedMinutes: numMinutes,
          cancelReason: reason || undefined,
          reason: reason || undefined,
        });
      });
      
      toast.success(`✅ Order marked as ${status}`);
      setEtaOrder(null);
      setEtaMinutes('');
      
    } catch (err) {
      // 3. Revert on failure
      console.error(`[ERROR] Error updating order ${orderId}:`, err);
      if (originalOrders) {  // ✅ Safety check
        setOrders(originalOrders);
      }
      
      // ✅ Show user-friendly error
      if (err.message?.includes('429')) {
        toast.error('⚠️ Too many requests. Please slow down.');
      } else if (err.message?.includes('400')) {
        toast.error(`❌ Invalid request: ${err.message}`);
      } else {
        toast.error(`❌ Failed to update: ${err.message}`);
      }
    } finally {
      // ✅ ALWAYS clear the in-flight flag
      inFlightRequests.current.delete(orderId);
      // ✅ Force re-render to update button state
      setUpdateTrigger(t => t + 1);
    }
  }, [orders]);

  const handleStatusClick = (order, nextStatus) => {
    if (nextStatus === 'PREPARING' || nextStatus === 'CONFIRMED') {
      setEtaOrder(order.id);
      setEtaMinutes('');
      setTimeout(() => etaRef.current?.focus(), 100);
    } else {
      updateStatus(order.id, nextStatus);
    }
  };

  // State machine matching backend transitions
  const STATE_TRANSITIONS = {
    'CREATED':   ['CONFIRMED', 'CANCELLED', 'FAILED'],
    'PENDING':   ['CONFIRMED', 'CANCELLED'],
    'CONFIRMED': ['PREPARING', 'READY', 'CANCELLED', 'FAILED'],
    'PREPARING': ['READY', 'CANCELLED', 'FAILED'],
    'READY':     ['SERVED', 'DELIVERED', 'PICKED_UP', 'COMPLETED', 'CANCELLED', 'FAILED'],
    'SERVED':    ['COMPLETED', 'REFUNDED'],
    'DELIVERED': ['COMPLETED', 'REFUNDED'],
    'PICKED_UP': ['COMPLETED', 'REFUNDED'],
    'COMPLETED': ['REFUNDED'],
    'CANCELLED': [],
    'REFUNDED': [],
    'FAILED': []
  };

  const getNextStatus = (current) => {
    // ✅ Return the first allowed transition (usually the happy path)
    const allowed = STATE_TRANSITIONS[current] || [];
    return allowed.length > 0 ? allowed[0] : null;  // First transition is the "next" status
  };

  const normalizedSearchQuery = useMemo(() => normalizeText(searchQuery), [searchQuery]);

  const ordersInScope = useMemo(() => {
    return orders.filter((order) => {
      const matchesSearch = !normalizedSearchQuery || getOrderSearchText(order).includes(normalizedSearchQuery);
      const matchesDate = matchesDateRange(order.createdAt, dateRange, fromDate, toDate);
      return matchesSearch && matchesDate;
    });
  }, [orders, normalizedSearchQuery, dateRange, fromDate, toDate]);

  const filteredOrders = useMemo(() => {
    if (!filter) return ordersInScope;
    return ordersInScope.filter((order) => order.status === filter);
  }, [ordersInScope, filter]);

  const fmt = (p) => `${CURRENCY_SYMBOLS[currency] || 'Rs.'}${parseFloat(p || 0).toFixed(2)}`;
  const fmtTime = (d) => new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtEta = (d) => {
    if (!d) return null;
    const diff = Math.round((new Date(d) - Date.now()) / 60000);
    if (diff <= 0) return 'Due now';
    return `~${diff} min remaining`;
  };

  const counts = useMemo(() => {
    return ordersInScope.reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    }, {});
  }, [ordersInScope]);

  const openOrdersCount = useMemo(() => {
    return ordersInScope.filter((order) => !TERMINAL_STATUSES.has(order.status)).length;
  }, [ordersInScope]);

  const actionRequiredCount = useMemo(() => {
    return ordersInScope.filter((order) => ACTION_REQUIRED_STATUSES.has(order.status)).length;
  }, [ordersInScope]);

  const grossSales = useMemo(() => {
    return ordersInScope.reduce((sum, order) => sum + parseFloat(order.grandTotal || order.total || 0), 0);
  }, [ordersInScope]);

  const hasActiveFilters = Boolean(
    filter ||
    normalizedSearchQuery ||
    dateRange !== 'ALL' ||
    (dateRange === 'CUSTOM' && (fromDate || toDate))
  );
  const activeDateLabel = DATE_RANGE_OPTIONS.find((option) => option.value === dateRange)?.label || 'All Time';
  const statusLabel = filter ? (STATUS_META[filter]?.label || filter) : 'All statuses';

  const resetFilters = () => {
    setSearchQuery('');
    setDateRange('ALL');
    setFromDate('');
    setToDate('');
    setFilter('');
  };

  if (loading) return (
    <div>
      <div className="page-header"><div className="skeleton skeleton-heading" /></div>
      {[1, 2, 3].map(i => <div key={i} className="skeleton skeleton-card" style={{ height: 90, marginBottom: 12 }} />)}
    </div>
  );

  return (
    <div>
    {inputDialog}
      <div className="page-header">
        <div>
          <h1>Orders</h1>
          <div className="page-header-subtitle">
            Showing {filteredOrders.length} of {ordersInScope.length} matching order{ordersInScope.length !== 1 ? 's' : ''} · {activeDateLabel} · {statusLabel}
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadData}>↻ Sync</button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          {
            label: 'Orders In Range',
            value: ordersInScope.length,
            note: `${filteredOrders.length} visible with current status`,
            accent: 'var(--color-primary)',
          },
          {
            label: 'Open Orders',
            value: openOrdersCount,
            note: 'Not completed, refunded, failed, or cancelled',
            accent: 'var(--color-info)',
          },
          {
            label: 'Awaiting Action',
            value: actionRequiredCount,
            note: 'Created through ready status',
            accent: 'var(--color-warning)',
          },
          {
            label: 'Gross Sales',
            value: fmt(grossSales),
            note: `For ${activeDateLabel.toLowerCase()}`,
            accent: 'var(--color-success)',
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="stat-card"
            style={{
              padding: '18px 20px',
              borderTop: `3px solid ${stat.accent}`,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>
              {stat.label}
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 28, lineHeight: 1.05, fontWeight: 800, color: 'var(--color-text)', marginBottom: 6 }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
              {stat.note}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 24, boxShadow: 'var(--shadow-sm)' }}>
        <div className="card-body" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>Order Tracking</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 3 }}>
                Search by order number, customer, phone, table, or item name and narrow results by service date.
              </div>
            </div>
            {hasActiveFilters ? (
              <button className="btn btn-secondary btn-sm" onClick={resetFilters}>
                Clear Filters
              </button>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
            <div style={{ flex: '1 1 360px', minWidth: 280 }}>
              <label className="form-label" htmlFor="order-search">Search Orders</label>
              <input
                id="order-search"
                type="search"
                className="input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Order #, customer, phone, table, or menu item"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div className="form-label" style={{ marginBottom: 8 }}>Date Range</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {DATE_RANGE_OPTIONS.map((option) => {
                  const isActive = dateRange === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setDateRange(option.value);
                        if (option.value !== 'CUSTOM') {
                          setFromDate('');
                          setToDate('');
                        }
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 999,
                        border: `1px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        background: isActive ? 'var(--color-primary-glow)' : 'var(--color-surface)',
                        color: isActive ? 'var(--color-primary-dark)' : 'var(--color-text-secondary)',
                        fontSize: 13,
                        fontWeight: 700,
                        lineHeight: 1,
                        cursor: 'pointer',
                        transition: 'all var(--duration-fast) var(--ease-out)',
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {dateRange === 'CUSTOM' && (
            <div
              style={{
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
                padding: 14,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-subtle)',
                marginBottom: 18,
              }}
            >
              <div style={{ flex: '1 1 180px', minWidth: 180 }}>
                <label className="form-label" htmlFor="orders-from-date">From</label>
                <input
                  id="orders-from-date"
                  type="date"
                  className="input"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ flex: '1 1 180px', minWidth: 180 }}>
                <label className="form-label" htmlFor="orders-to-date">To</label>
                <input
                  id="orders-to-date"
                  type="date"
                  className="input"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 3 }}>
                  Status Filter
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  Counts update automatically for the current search and date selection.
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                {orders.length} total order{orders.length !== 1 ? 's' : ''} in system
              </div>
            </div>

            <div className="order-filters" style={{ marginBottom: 0, width: '100%', gap: 8 }}>
              {ORDER_FILTER_TABS.map((status) => {
                const isActive = filter === status;
                const count = status ? (counts[status] || 0) : ordersInScope.length;

                return (
                  <button
                    key={status}
                    className={`order-filter-btn ${isActive ? 'active' : ''}`}
                    onClick={() => setFilter(status)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      border: `1px solid ${isActive ? 'rgba(255, 107, 53, 0.22)' : 'transparent'}`,
                      background: isActive ? 'rgba(255, 107, 53, 0.12)' : 'transparent',
                      color: isActive ? 'var(--color-primary-dark)' : 'var(--color-text-secondary)',
                    }}
                  >
                    {status ? (STATUS_META[status]?.label || status.replaceAll('_', ' ')) : 'All Orders'}
                    <span
                      style={{
                        minWidth: 24,
                        padding: '2px 7px',
                        borderRadius: 999,
                        background: isActive ? 'rgba(255, 107, 53, 0.14)' : 'var(--color-surface)',
                        border: `1px solid ${isActive ? 'rgba(255, 107, 53, 0.12)' : 'var(--color-border)'}`,
                        fontSize: 11,
                        fontWeight: 800,
                        color: isActive ? 'var(--color-primary-dark)' : 'var(--color-text-muted)',
                      }}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {filteredOrders.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <h3>{hasActiveFilters ? 'No orders match these filters' : 'No orders yet'}</h3>
            <p>
              {hasActiveFilters
                ? 'Try a different customer name, order number, menu item, or date range to find the ticket you need.'
                : 'Orders will appear here in real-time when customers place them via your QR code menu.'}
            </p>
            {hasActiveFilters ? (
              <button className="btn btn-secondary btn-sm" onClick={resetFilters} style={{ marginTop: 14 }}>
                Clear Filters
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="order-list">
          {filteredOrders.map((order, i) => {
            const meta = STATUS_META[order.status] || STATUS_META.PENDING;
            const nextStatus = getNextStatus(order.status);
            const eta = fmtEta(order.estimatedDelivery);
            const isExpanded = expandedOrder === order.id;
            const isEtaOpen = etaOrder === order.id;

            return (
              <div key={order.id} className="order-card animate-in" style={{ animationDelay: `${i * 40}ms`, borderLeft: `4px solid` }}>
                {/* Header row */}
                <div className="order-card-header" onClick={() => setExpandedOrder(isExpanded ? null : order.id)} style={{ cursor: 'pointer' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                      {/* Status badge */}
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 99, border: '1.5px solid' }} className={meta.color}>
                        {meta.emoji} {meta.label}
                      </span>
                      {/* Table */}
                      <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--color-text)' }}>
                        {order.orderNumber || ''} {order.table ? `🪑 Table ${order.table.tableNumber}${order.table.label ? ` (${order.table.label})` : ''}` : '🚶 Walk-in'}
                      </span>
                      {order.orderType && order.orderType !== 'DINE_IN' && (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE' }}>
                          {order.orderType.replace('_', ' ')}
                        </span>
                      )}
                      {/* Customer name */}
                      {order.customerName && (
                        <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 500 }}>— {order.customerName}</span>
                      )}
                      {/* Phone */}
                      {order.customerPhone && (
                        <a href={`tel:${order.customerPhone}`} onClick={e => e.stopPropagation()} style={{ fontSize: 12, color: '#2563eb', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
                          📞 {order.customerPhone}
                        </a>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: 'var(--color-text-muted)' }}>
                      <span>🕐 {fmtTime(order.createdAt)}</span>
                      <span>·</span>
                      <span>{order.items?.length || 0} item{order.items?.length !== 1 ? 's' : ''}</span>
                      <span>·</span>
                      <strong style={{ color: 'var(--color-text)', fontWeight: 700 }}>{fmt(order.grandTotal || order.total)}</strong>
                      {eta && (
                        <>
                          <span>·</span>
                          <span style={{ color: '#059669', fontWeight: 700 }}>⏱ {eta}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 18, color: 'var(--color-text-muted)' }}>
                    {isExpanded ? '▲' : '▼'}
                  </div>
                </div>

                {/* ETA input (inline) */}
                {canUpdateStatus && isEtaOpen && (
                  <div style={{ padding: '12px 20px', background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>⏱ Set delivery ETA:</span>
                    <input
                      ref={etaRef}
                      type="number"
                      min="1" max="180"
                      value={etaMinutes}
                      onChange={e => setEtaMinutes(e.target.value)}
                      placeholder="Minutes"
                      style={{ width: 90, padding: '6px 10px', border: '1.5px solid var(--color-border)', borderRadius: 8, fontSize: 13, fontWeight: 600 }}
                    />
                    <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>minutes</span>
                    <button className="btn btn-primary btn-sm"
                      disabled={inFlightRequests.current.has(order.id)}
                      onClick={() => updateStatus(order.id, getNextStatus(order.status), etaMinutes || undefined)}
                      style={{ opacity: inFlightRequests.current.has(order.id) ? 0.6 : 1 }}
                    >
                      {inFlightRequests.current.has(order.id) ? '⏳...' : '✓ Confirm & Set ETA'}
                    </button>
                    <button className="btn btn-secondary btn-sm"
                      disabled={inFlightRequests.current.has(order.id)}
                      onClick={() => updateStatus(order.id, getNextStatus(order.status))}
                      style={{ opacity: inFlightRequests.current.has(order.id) ? 0.6 : 1 }}
                    >
                      {inFlightRequests.current.has(order.id) ? '⏳' : 'Skip ETA'}
                    </button>
                    <button className="btn btn-secondary btn-sm" 
                      disabled={inFlightRequests.current.has(order.id)}
                      onClick={() => setEtaOrder(null)}
                      style={{ opacity: inFlightRequests.current.has(order.id) ? 0.6 : 1 }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Action buttons */}
                {canUpdateStatus && !isEtaOpen && (
                  <div className="order-card-actions" style={{ padding: '0 20px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                    {nextStatus && (
                      <button className="btn btn-primary btn-sm"
                        disabled={inFlightRequests.current.has(order.id)}
                        onClick={() => handleStatusClick(order, nextStatus)}
                        style={{ opacity: inFlightRequests.current.has(order.id) ? 0.6 : 1 }}
                      >
                        {inFlightRequests.current.has(order.id) ? '⏳ Updating...' : `→ Mark as ${nextStatus}`}
                      </button>
                    )}
                    {order.status !== 'CANCELLED' && order.status !== 'COMPLETED' && order.status !== 'DELIVERED' && order.status !== 'PICKED_UP' && (
                      <button className="btn btn-danger btn-sm"
                        disabled={inFlightRequests.current.has(order.id)}
                        onClick={async () => {
                          const answer = await askForInput({
                            title: `Cancel order ${order.orderNumber || ''}`.trim(),
                            description: 'The reason stays on the order and appears in reports.',
                            confirmLabel: 'Cancel order',
                            destructive: true,
                            fields: [{ name: 'reason', label: 'Cancellation reason', required: true }],
                          });
                          if (!answer) return;
                          updateStatus(order.id, 'CANCELLED', undefined, answer.reason);
                        }}
                        style={{ opacity: inFlightRequests.current.has(order.id) ? 0.6 : 1 }}
                      >
                        {inFlightRequests.current.has(order.id) ? '⏳' : '✕ Cancel'}
                      </button>
                    )}
                    {/* ETA quick set buttons - only for orders in progress */}
                    {order.status === 'PREPARING' && (
                      <>
                        {[10, 15, 20, 30].map(m => (
                          <button key={m} className="btn btn-secondary btn-sm"
                            disabled={inFlightRequests.current.has(order.id)}
                            onClick={() => updateStatus(order.id, order.status, m)}
                            style={{ opacity: inFlightRequests.current.has(order.id) ? 0.6 : 1 }}
                          >
                            {inFlightRequests.current.has(order.id) ? '⏳' : `⏱ ${m}m`}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}

                {/* Expanded item details */}
                {isExpanded && order.items && (
                  <div className="order-card-details" style={{ borderTop: '1px solid var(--color-border)', margin: '0 20px 16px', paddingTop: 12 }}>
                    {/* Full info header */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--color-border)' }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 3 }}>Table</div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{order.table ? `Table ${order.table.tableNumber}${order.table.label ? ` · ${order.table.label}` : ''}` : 'Walk-in / Pickup'}</div>
                      </div>
                      {order.customerName && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 3 }}>Customer</div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{order.customerName}</div>
                        </div>
                      )}
                      {order.customerPhone && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 3 }}>Phone</div>
                          <a href={`tel:${order.customerPhone}`} style={{ fontWeight: 700, fontSize: 14, color: '#2563eb' }}>{order.customerPhone}</a>
                        </div>
                      )}
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 3 }}>Order Time</div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{fmtTime(order.createdAt)}</div>
                      </div>
                      {order.estimatedDelivery && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 3 }}>ETA</div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: '#059669' }}>{fmtEta(order.estimatedDelivery) || fmtTime(order.estimatedDelivery)}</div>
                        </div>
                      )}
                    </div>

                    {/* Items */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 8 }}>Items Ordered</div>
                      {order.items.map((item, j) => (
                        <div key={j} style={{ padding: '8px 0', borderBottom: j < order.items.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{item.quantity}× {item.name}{item.variantName ? ` • ${item.variantName}` : ''}</span>
                            <span style={{ fontWeight: 700, fontSize: 14 }}>{fmt(item.itemTotal || (item.price * item.quantity))}</span>
                          </div>
                          {item.modifiers?.length > 0 && (
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', paddingLeft: 20, marginTop: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {item.modifiers.map((mod, idx) => (
                                <div key={idx}>+ {mod.option} {parseFloat(mod.price) > 0 ? `(${fmt(mod.price)})` : ''}</div>
                              ))}
                            </div>
                          )}
                          {item.notes && (
                            <div style={{ fontSize: 12, color: '#B45309', paddingLeft: 20, marginTop: 3 }}>⚠️ {item.notes}</div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Notes + Total */}
                    {order.notes && (
                      <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#92400E', marginBottom: 10 }}>
                        📝 {order.notes}
                      </div>
                    )}
                    <div style={{ paddingTop: 8, borderTop: '2px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)' }}>
                        <span>Subtotal</span><span>{fmt(order.subtotal)}</span>
                      </div>
                      {parseFloat(order.taxAmount || 0) > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)' }}>
                          <span>Tax ({parseFloat(order.taxPercent)}%)</span><span>{fmt(order.taxAmount)}</span>
                        </div>
                      )}
                      {parseFloat(order.serviceChargeAmount || 0) > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)' }}>
                          <span>Service Charge</span><span>{fmt(order.serviceChargeAmount)}</span>
                        </div>
                      )}
                      {parseFloat(order.discountAmount || 0) > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#059669' }}>
                          <span>Discount</span><span>-{fmt(order.discountAmount)}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 16, color: 'var(--color-text)', paddingTop: 4, borderTop: '1px solid var(--color-border)' }}>
                        <span>Grand Total</span><span>{fmt(order.grandTotal || order.total)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
