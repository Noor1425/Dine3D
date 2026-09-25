'use client';
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';
import { useSocket } from '@/hooks/useSocket';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useOffline } from '@/components/offline/OfflineProvider';
import { getLocalActiveOrders } from '@/lib/offline/database';
import '@/styles/admin.css';

const KITCHEN_VISIBLE_STATUSES = ['CONFIRMED', 'PREPARING'];
const KITCHEN_REMOVE_STATUSES = ['PENDING', 'READY', 'SERVED', 'DELIVERED', 'PICKED_UP', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED'];

export default function KDSPage() {
  const { can } = useAdminAccess();
  const canUpdateStatus = can('orders.status');
  const offline = useOffline();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [restaurantId, setRestaurantId] = useState(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { socket } = useSocket({ restaurantId });

  useEffect(() => {
    const tenantId = offline.bootstrap?.restaurant?.id || offline.context?.tenantId;
    if (tenantId) setRestaurantId(tenantId);
    const timer = setInterval(() => setCurrentTime(new Date()), 10000); // update every 10s for ticket timers
    return () => clearInterval(timer);
  }, [offline.bootstrap?.restaurant?.id, offline.context?.tenantId]);

  // Separate effect: load orders when restaurantId is ready
  useEffect(() => {
    if (!restaurantId) return; // Don't load until restaurant ID is set
    loadOrders();
  }, [restaurantId]);

  useEffect(() => {
    if (!socket) return;
    
    const handleNewOrder = (order) => {
      if (KITCHEN_VISIBLE_STATUSES.includes(order.status)) {
        setOrders(prev => {
           if (prev.find(existing => existing.id === order.id)) return prev;
           const next = [...prev, order];
           return next.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
        });
        toast.info(`New Order ${order.orderNumber || '#' + order.id.slice(-4)} received!`, { icon: '🔔' });
        if (!isMuted) {
          try { new Audio('/notification.mp3').play().catch(() => {}); } catch(e) {}
        }
      }
    };
    
    const handleOrderUpdate = (order) => {
      setOrders(prev => {
        if (KITCHEN_REMOVE_STATUSES.includes(order.status)) {
          return prev.filter(o => o.id !== order.id);
        }
        if (!KITCHEN_VISIBLE_STATUSES.includes(order.status)) {
          return prev;
        }
        if (!prev.find(o => o.id === order.id)) {
          return [...prev, order].sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
        }
        return prev.map(o => o.id === order.id ? order : o);
      });
    };

    socket.on('new-order', handleNewOrder);
    socket.on('order-updated', handleOrderUpdate);
    
    return () => {
      socket.off('new-order', handleNewOrder);
      socket.off('order-updated', handleOrderUpdate);
    };
  }, [socket, isMuted]);

  useEffect(() => {
    const handleEdgeOrders = (event) => {
      const incoming = Array.isArray(event.detail?.orders) ? event.detail.orders : [];
      const active = incoming
        .filter((order) => KITCHEN_VISIBLE_STATUSES.includes(order.status))
        .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
      setOrders((previous) => {
        const known = new Set(previous.map((order) => order.id));
        const newOrders = active.filter((order) => !known.has(order.id));
        if (newOrders.length > 0) {
          toast.info(`${newOrders.length} new kitchen order${newOrders.length === 1 ? '' : 's'} received locally`, { icon: '🔔' });
          if (!isMuted) {
            try { new Audio('/notification.mp3').play().catch(() => {}); } catch { /* in-app alert remains visible */ }
          }
        }
        return active;
      });
    };
    window.addEventListener('dine3d-edge-orders', handleEdgeOrders);
    return () => window.removeEventListener('dine3d-edge-orders', handleEdgeOrders);
  }, [isMuted]);

  useEffect(() => {
    if (restaurantId && offline.state.edgeOnline) loadOrders();
  }, [restaurantId, offline.state.edgeOnline]);

  const loadOrders = async () => {
    if (!restaurantId) return; // Guard: don't fetch if no restaurant context

    try {
      setLoading(true);
      if (offline.state.edgeOnline) {
        await offline.refreshEdgeOrders();
        const local = await getLocalActiveOrders(restaurantId);
        const activeLocal = local.filter((order) => KITCHEN_VISIBLE_STATUSES.includes(order.status));
        activeLocal.sort((a, b) => new Date(a.createdAt || a.localCreatedAt) - new Date(b.createdAt || b.localCreatedAt));
        setOrders(activeLocal);
        return;
      }
      const res = await api.getOrders({ limit: 100 });
      if (!res || !res.orders) {
        console.warn('[KDS] Invalid orders response:', res);
        setOrders([]);
        return;
      }
      const active = res.orders.filter(o => KITCHEN_VISIBLE_STATUSES.includes(o.status));
      active.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
      await offline.cacheOrders(res.orders);
      setOrders(active);
    } catch (error) {
      const cached = await getLocalActiveOrders(restaurantId);
      const active = cached.filter(o => KITCHEN_VISIBLE_STATUSES.includes(o.status));
      active.sort((a,b) => new Date(a.createdAt || a.localCreatedAt) - new Date(b.createdAt || b.localCreatedAt));
      setOrders(active);
      if (active.length === 0) toast.error(error?.message || 'No cached kitchen orders are available');
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id, status) => {
    try {
      // Local-first even while online: the ticket and outbox command are saved
      // atomically before the UI acknowledges the kitchen action.
      await offline.transitionOrder(id, status);
      if (KITCHEN_REMOVE_STATUSES.includes(status)) {
        setOrders(prev => prev.filter(o => o.id !== id));
      } else {
        setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o));
      }
      toast.success(`Order marked ${status.toLowerCase()} — saved on this device`);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const getElapsedMinutes = (createdAt) => {
    return Math.floor((currentTime - new Date(createdAt)) / 60000);
  };

  const statusColors = {
    PENDING: { bg: '#FEF2F2', text: '#991B1B', border: '#FCA5A5', label: 'New' },
    CONFIRMED: { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D', label: 'Confirmed' },
    PREPARING: { bg: '#EFF6FF', text: '#1E40AF', border: '#93C5FD', label: 'Preparing' },
  };

  const orderTypeIcons = {
    DINE_IN: '🍽️',
    TAKEAWAY: '🥡',
    COUNTER: '🏪',
    DELIVERY: '🚚',
  };

  if (loading) {
    return (
      <div style={{padding: 40, display: 'flex', justifyContent: 'center'}}>
        <div className="spinner" />
      </div>
    );
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => setIsFullscreen(false));
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  return (
    <div className="kds-container">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
        <div>
          <h1 style={{fontSize: 24, fontWeight: 700, margin: 0}}>Kitchen Display System</h1>
          <p style={{color: 'var(--color-text-muted)', margin: 0, marginTop: 4}}>
            {orders.length} active order{orders.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{display: 'flex', gap: 12}}>
          <button 
            className={`btn ${isMuted ? 'btn-outline' : 'btn-primary'}`}
            onClick={() => setIsMuted(!isMuted)}
            style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 600 }}
          >
            {isMuted ? '🔇 Sound Off' : '🔊 Sound On'}
          </button>
          <button 
            className="btn btn-outline"
            onClick={toggleFullscreen}
            style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 600 }}
          >
            {isFullscreen ? '⤓ Exit Fullscreen' : '⤢ Fullscreen'}
          </button>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="empty-state" style={{ height: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{fontSize: 64, marginBottom: 16}}>🍳</div>
          <h3 style={{fontSize: 20, fontWeight: 600, marginBottom: 8}}>Kitchen is clear</h3>
          <p style={{color: 'var(--color-text-muted)'}}>Waiting for new orders to arrive.</p>
        </div>
      ) : (
        <div className="kds-grid">
          <AnimatePresence>
            {orders.map(order => {
              const elapsed = getElapsedMinutes(order.createdAt);
              const isUrgent = elapsed >= 15;
              const isWarning = elapsed >= 10 && elapsed < 15;
              const colorConfig = statusColors[order.status] || statusColors.PENDING;

              return (
                <motion.div 
                  key={order.id}
                  className={`kds-ticket ${isUrgent ? 'urgent' : ''}`}
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
                  transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                  style={{
                    background: '#fff',
                    borderRadius: 12,
                    border: `1px solid ${isUrgent ? '#FCA5A5' : 'var(--color-border)'}`,
                    boxShadow: isUrgent ? '0 4px 20px rgba(239, 68, 68, 0.15)' : '0 2px 8px rgba(0,0,0,0.05)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                  }}
                >
                  <div className="ticket-header" style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--color-border)',
                    background: isUrgent ? '#FEF2F2' : '#F8FAFC',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start'
                  }}>
                    <div>
                      <div style={{fontSize: 18, fontWeight: 700, fontFamily: 'monospace'}}>
                        {order.orderNumber || `#${order.id.slice(-4).toUpperCase()}`}
                      </div>
                      <div style={{fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2}}>
                        {orderTypeIcons[order.orderType] || '🍽️'} {order.table?.tableNumber ? `Table ${order.table.tableNumber}` : (order.customerName || order.orderType?.replace('_', ' ') || 'Takeout')}
                      </div>
                      {order.paymentStatus && order.paymentStatus !== 'UNPAID' && (
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: order.paymentStatus === 'PAID' ? '#DCFCE7' : '#FEF3C7', color: order.paymentStatus === 'PAID' ? '#16A34A' : '#92400E', fontWeight: 600, marginTop: 2, display: 'inline-block' }}>
                          {order.paymentStatus}
                        </span>
                      )}
                      {order.offlinePending && (
                        <span style={{ fontSize: 10, marginLeft: 6, padding: '1px 6px', borderRadius: 4, background: '#DBEAFE', color: '#1D4ED8', fontWeight: 700, display: 'inline-block' }}>
                          WAITING TO SYNC
                        </span>
                      )}
                    </div>
                    <div style={{textAlign: 'right'}}>
                      <div style={{
                        display: 'inline-block',
                        padding: '4px 8px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        background: colorConfig.bg,
                        color: colorConfig.text,
                        border: `1px solid ${colorConfig.border}`,
                      }}>
                        {colorConfig.label}
                      </div>
                      <div style={{
                        fontSize: 14, 
                        fontWeight: 700, 
                        marginTop: 6,
                        color: isUrgent ? '#DC2626' : (isWarning ? '#D97706' : 'var(--color-text-muted)')
                      }}>
                        {elapsed} min
                      </div>
                    </div>
                  </div>

                  <div className="ticket-body" style={{padding: 16, flex: 1, overflowY: 'auto'}}>
                    <ul style={{listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12}}>
                      {order.items.map(item => (
                        <li key={item.id} style={{display: 'flex', alignItems: 'flex-start', gap: 12}}>
                          <div style={{
                            width: 24, height: 24, 
                            background: '#F1F5F9', borderRadius: 4,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13, fontWeight: 700, color: 'var(--color-text)'
                          }}>
                            {item.quantity}
                          </div>
                          <div style={{flex: 1}}>
                            <div style={{fontSize: 15, fontWeight: 600}}>{item.name}</div>
                            {item.variantName && (
                              <div style={{fontSize: 12, color: '#6366F1', marginTop: 2}}>Size: {item.variantName}</div>
                            )}
                            {item.modifiers && (Array.isArray(item.modifiers) ? item.modifiers : []).length > 0 && (
                              <div style={{fontSize: 13, color: '#64748B', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2}}>
                                {(Array.isArray(item.modifiers) ? item.modifiers : []).map((mod, idx) => (
                                  <div key={idx}>+ {mod.option || mod.name}</div>
                                ))}
                              </div>
                            )}
                            {item.notes && (
                              <div style={{fontSize: 13, color: '#B45309', background: '#FEF3C7', padding: '4px 8px', borderRadius: 4, marginTop: 6, display: 'inline-block'}}>
                                ⚠️ {item.notes}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {order.notes && (
                      <div style={{marginTop: 16, paddingTop: 16, borderTop: '1px dashed var(--color-border)', fontSize: 14, color: '#DC2626'}}>
                        <strong>Note:</strong> {order.notes}
                      </div>
                    )}
                  </div>

                  <div className="ticket-footer" style={{
                    padding: 12, borderTop: '1px solid var(--color-border)',
                    display: 'flex', gap: 8, background: '#F8FAFC'
                  }}>
                    {canUpdateStatus && order.status === 'CONFIRMED' && (
                      <button className="btn btn-primary" style={{flex: 1}} onClick={() => updateStatus(order.id, 'PREPARING')}>
                        Start Preparing
                      </button>
                    )}
                    {canUpdateStatus && order.status === 'PREPARING' && (
                      <button className="btn btn-success" style={{flex: 1, background: '#10B981', color: '#fff'}} onClick={() => updateStatus(order.id, 'READY')}>
                        Mark Ready
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <style jsx>{`
        .kds-container {
          padding: 24px;
          height: calc(100vh - 64px);
          display: flex;
          flex-direction: column;
        }
        .kds-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 20px;
          align-items: start;
          flex: 1;
          overflow-y: auto;
          padding-bottom: 40px;

          /* Size rows to their tickets, and pack them from the top.
           *
           * Without these the grid inherits a definite height from
           * .kds-container's 100vh and shares it out between however many rows
           * there are — so with five rows each got about 117px while the
           * tickets rendered at 260-400px. Every ticket overflowed its own row
           * and covered the one beneath it, which put "Start Preparing" and
           * "Mark Ready" underneath the next ticket: visible, but not
           * clickable. The kitchen could see the buttons and not press them.
           *
           * The rows must size to content and the GRID must scroll, not the
           * rows compress. */
          grid-auto-rows: min-content;
          align-content: start;
        }
        .kds-ticket.urgent {
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
          70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
      `}</style>
    </div>
  );
}
