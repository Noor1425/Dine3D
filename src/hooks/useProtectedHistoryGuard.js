'use client';

import { useEffect } from 'react';
import api from '@/lib/api';

/**
 * Protects authenticated shells from the browser back/forward cache (bfcache).
 * A cached page is concealed before it is snapshotted and is only revealed
 * after the server confirms that the current cookie still represents the
 * expected type of session.
 */
export default function useProtectedHistoryGuard({ scope, enabled = true }) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;

    const root = document.documentElement;
    const previousVisibility = root.style.visibility;
    let active = true;

    const conceal = () => {
      root.style.visibility = 'hidden';
      root.setAttribute('data-auth-restoring', 'true');
    };

    const reveal = () => {
      root.style.visibility = previousVisibility;
      root.removeAttribute('data-auth-restoring');
    };

    const sendToLogin = () => {
      api.clearTokens();
      const loginPath = scope === 'superadmin' ? '/superadmin/login' : '/admin/login';
      window.location.replace(`${loginPath}?reason=session_expired`);
    };

    const validateRestoredSession = async () => {
      try {
        const session = await api.getMe();
        const valid = scope === 'superadmin'
          ? session?.user?.role === 'superadmin'
          : Boolean(session?.restaurant);

        if (!valid) throw new Error('Session no longer has access to this area');
        if (active) reveal();
      } catch (error) {
        // Restaurant workstations may deliberately operate offline. Explicit
        // logout locks this vault first, so a signed-out user cannot pass this
        // fallback even when a cached POS document still exists.
        if (scope === 'admin' && error?.code === 'NETWORK_UNAVAILABLE') {
          try {
            const stored = JSON.parse(localStorage.getItem('dine3d_restaurant') || 'null');
            if (stored?.id) {
              const { getValidOfflineAccess } = await import('@/lib/offline/database');
              const offline = await getValidOfflineAccess(stored.id);
              if (offline && active) {
                reveal();
                return;
              }
            }
          } catch {
            // Fall through to the secure login redirect.
          }
        }

        if (active) sendToLogin();
      }
    };

    const handlePageHide = () => conceal();
    const handlePageShow = (event) => {
      const navigation = window.performance?.getEntriesByType?.('navigation')?.[0];
      if (!event.persisted && navigation?.type !== 'back_forward') {
        reveal();
        return;
      }

      conceal();
      void validateRestoredSession();
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      active = false;
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      reveal();
    };
  }, [enabled, scope]);
}
