'use client';

import { createContext, useContext, useMemo } from 'react';

const SuperAdminAccessContext = createContext({ permissions: [], sessionType: 'normal', can: () => false });

export function SuperAdminAccessProvider({ permissions, sessionType, children }) {
  const value = useMemo(() => ({
    permissions,
    sessionType,
    can: (permission) => permissions.includes(permission)
  }), [permissions, sessionType]);
  return <SuperAdminAccessContext.Provider value={value}>{children}</SuperAdminAccessContext.Provider>;
}

export const useSuperAdminAccess = () => useContext(SuperAdminAccessContext);
