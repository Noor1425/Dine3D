'use client';

import { createContext, useContext, useMemo } from 'react';
import { hasTenantPermission } from '@/lib/tenantAccess';

const EMPTY_ACCESS = Object.freeze({
  role: null,
  sessionType: 'normal',
  permissions: [],
  deniedPermissions: [],
  accessLevel: 'branch',
  accessibleBranchIds: [],
  branches: [],
  currentBranch: null,
  can: () => false,
  canAny: () => false,
  canAll: () => false,
});

const AdminAccessContext = createContext(EMPTY_ACCESS);

export function AdminAccessProvider({ session, member, branches = [], currentBranch = null, children }) {
  const value = useMemo(() => {
    const policy = {
      permissions: session?.permissions || [],
      deniedPermissions: session?.deniedPermissions || [],
      sessionType: session?.sessionType || 'normal',
    };
    const can = (permission) => hasTenantPermission(policy, permission);
    return {
      role: session?.role || null,
      sessionType: policy.sessionType,
      permissions: policy.permissions,
      deniedPermissions: policy.deniedPermissions,
      accessLevel: member?.accessLevel || 'branch',
      accessibleBranchIds: member?.accessibleBranchIds || [],
      branches,
      currentBranch,
      can,
      canAny: (permissions) => (permissions || []).some(can),
      canAll: (permissions) => (permissions || []).every(can),
    };
  }, [branches, currentBranch, member, session]);

  return <AdminAccessContext.Provider value={value}>{children}</AdminAccessContext.Provider>;
}

export function AdminPermission({ any, all, children, fallback = null }) {
  const access = useAdminAccess();
  const allowed = any ? access.canAny(any) : all ? access.canAll(all) : false;
  return allowed ? children : fallback;
}

export const useAdminAccess = () => useContext(AdminAccessContext);
