'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { clearPublicOrderHistory, loadPublicOrderHistory, savePublicOrderHistory } from '@/lib/offline/publicQrDatabase';

const normalizeStatus = (status) => String(status || 'PENDING').trim().toUpperCase();

/**
 * useOrderHistory - Manages persistent order history for a specific table.
 * Production-grade isolation ensures that orders from one table NEVER appear on another.
 */
export function useOrderHistory(slug, tableId) {
  const [history, setHistory] = useState([]);
  
  const storageReady = Boolean(slug && tableId);

  // Load history on mount or when tableId changes
  useEffect(() => {
    if (typeof window === 'undefined' || !storageReady) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    loadPublicOrderHistory(slug, tableId).then((parsed) => {
      if (!cancelled) {
        const restaurantHistory = (parsed || [])
          .filter(o => o.slug === slug)
          .map((order) => ({
            ...order,
            status: normalizeStatus(order.status),
          }));
        setHistory(restaurantHistory);
      }
    }).catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [slug, tableId, storageReady]);

  const saveOrder = useCallback((id, status = 'pending', trackingToken = null) => {
    if (!storageReady) return;
    
    const newOrder = { 
      id, 
      slug, 
      at: Date.now(), 
      status: normalizeStatus(status),
      trackingToken,
    };

    setHistory(prev => {
      // Keep only most recent 20 orders to avoid localStorage bloat
      const updated = [newOrder, ...prev.filter(o => o.id !== id)].slice(0, 20);
      savePublicOrderHistory(slug, tableId, updated).catch(() => {});
      return updated;
    });
  }, [slug, tableId, storageReady]);

  const updateOrderStatus = useCallback((id, status) => {
    if (!storageReady) return;
    setHistory(prev => {
      const normalizedStatus = normalizeStatus(status);
      const currentOrder = prev.find(o => o.id === id);

      // Polling commonly returns the same status. Preserve the existing state
      // reference so React does not restart status-sync effects unnecessarily.
      if (!currentOrder || normalizeStatus(currentOrder.status) === normalizedStatus) {
        return prev;
      }

      const updated = prev.map(o => o.id === id ? { ...o, status: normalizedStatus } : o);
      savePublicOrderHistory(slug, tableId, updated).catch(() => {});
      return updated;
    });
  }, [slug, tableId, storageReady]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    if (storageReady) clearPublicOrderHistory(slug, tableId).catch(() => {});
  }, [slug, tableId, storageReady]);

  // Derived state for easy consumption
  const terminalStatuses = useMemo(
    () => new Set(['SERVED', 'DELIVERED', 'PICKED_UP', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED']),
    []
  );
  const activeOrders = useMemo(
    () => history.filter(o => !terminalStatuses.has(normalizeStatus(o.status))),
    [history, terminalStatuses]
  );
  const completedOrders = useMemo(
    () => history.filter(o => terminalStatuses.has(normalizeStatus(o.status))),
    [history, terminalStatuses]
  );

  return {
    history,
    activeOrders,
    completedOrders,
    saveOrder,
    updateOrderStatus,
    clearHistory
  };
}
