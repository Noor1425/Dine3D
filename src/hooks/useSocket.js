'use client';
import { useEffect, useRef, useCallback, useState } from 'react';
import { io } from 'socket.io-client';

export function useSocket(config = {}) {
  const { restaurantId, orderId, trackingToken } = config || {};
  const socketRef = useRef(null);
  const listenersRef = useRef({});
  const connectionAttemptRef = useRef(0);
  const [socketState, setSocketState] = useState(null);

  useEffect(() => {
    // Guard: don't initialize socket if no context
    if (!restaurantId && !orderId) {
      return;
    }
    
    try {
      // Authenticated users are authorized via HttpOnly cookies.
      // Guest order tracking requires an explicit tracking token.
      const token = trackingToken || null;

      const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;
      const backendUrl = process.env.NEXT_PUBLIC_SOCKET_URL
        || (configuredApiUrl?.startsWith('http') ? new URL(configuredApiUrl).origin : null)
        || (process.env.NODE_ENV === 'production'
          ? window.location.origin
          : `${window.location.protocol}//${window.location.hostname}:4000`);

      const socket = io(backendUrl, {
        transports: ['websocket', 'polling'],
        auth: token ? { token } : {},
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      });

      socket.on('connect', () => {
        connectionAttemptRef.current = 0; // Reset on successful connection
        if (restaurantId) {
          socket.emit('join-restaurant', { restaurantId });
        }
        if (orderId) {
          socket.emit('join-order', { orderId });
        }
      });

      socket.on('connect_error', (err) => {
        connectionAttemptRef.current += 1;
        console.warn(`[SOCKET] Connection error (attempt ${connectionAttemptRef.current}):`, err?.message || err);
      });

      Object.entries(listenersRef.current).forEach(([event, callbacks]) => {
        callbacks.forEach((callback) => {
          socket.on(event, callback);
        });
      });

      socketRef.current = socket;
      setSocketState(socket);

      return () => {
        try {
          if (restaurantId) {
            socket.emit('leave-restaurant', { restaurantId });
          }
          if (orderId) {
            socket.emit('leave-order', { orderId });
          }
          socket.disconnect();
        } catch (e) {
          console.warn('[SOCKET] Error during cleanup:', e);
        } finally {
          socketRef.current = null;
          setSocketState(null);
        }
      };
    } catch (error) {
      console.error('[SOCKET] Initialization error:', error);
      return () => {}; // Return empty cleanup
    }
  }, [restaurantId, orderId, trackingToken]);

  const on = useCallback((event, callback) => {
    if (!listenersRef.current[event]) {
      listenersRef.current[event] = new Set();
    }

    if (!listenersRef.current[event].has(callback)) {
      listenersRef.current[event].add(callback);
      if (socketRef.current) {
        socketRef.current.on(event, callback);
      }
    }
  }, []);

  const off = useCallback((event, callback) => {
    const callbacks = listenersRef.current[event];
    if (!callbacks) return;

    if (callback) {
      if (socketRef.current) {
        socketRef.current.off(event, callback);
      }
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        delete listenersRef.current[event];
      }
      return;
    }

    callbacks.forEach((listener) => {
      if (socketRef.current) {
        socketRef.current.off(event, listener);
      }
    });
    delete listenersRef.current[event];
  }, []);

  const emit = useCallback((event, payload, ack) => {
    if (!socketRef.current) {
      console.warn(`[SOCKET] Cannot emit "${event}" - socket not initialized`);
      return;
    }

    socketRef.current.emit(event, payload, ack);
  }, []);

  return { on, off, emit, socket: socketState };
}
