'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import saApi from '@/lib/saApi';
import ConfirmActionDialog from '@/components/superadmin/ConfirmActionDialog';

const emptyCreateForm = {
  name: '',
  email: '',
  password: '',
  role: 'platform_admin',
  permissions: [],
  reason: ''
};

function PermissionPicker({ permissions, selected, onToggle }) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {permissions.map((permission) => (
        <label
          key={permission}
          className="flex cursor-pointer gap-2 rounded-lg border border-sa-800 bg-sa-950 p-2 text-xs focus-within:border-orange-500"
        >
          <input
            type="checkbox"
            checked={selected.includes(permission)}
            onChange={() => onToggle(permission)}
          />
          {permission}
        </label>
      ))}
    </div>
  );
}

function AdminFormModal({ title, roles, permissions, values, submitting, onChange, onToggle, onClose, onSubmit, createMode = false }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="admin-form-title">
      <button type="button" className="absolute inset-0 bg-black/80" aria-label="Close" onClick={() => !submitting && onClose()} />
      <form onSubmit={onSubmit} className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-sa-700 bg-sa-900 p-6 shadow-2xl">
        <h2 id="admin-form-title" className="text-xl font-black">{title}</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {createMode && (
            <>
              <label className="text-xs font-bold text-sa-400">
                Name
                <input required value={values.name} onChange={(event) => onChange('name', event.target.value)} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white focus:border-orange-500 focus:outline-none" />
              </label>
              <label className="text-xs font-bold text-sa-400">
                Email
                <input required type="email" value={values.email} onChange={(event) => onChange('email', event.target.value)} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white focus:border-orange-500 focus:outline-none" />
              </label>
              <label className="text-xs font-bold text-sa-400 md:col-span-2">
                Temporary password
                <input required minLength={14} type="password" autoComplete="new-password" value={values.password} onChange={(event) => onChange('password', event.target.value)} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white focus:border-orange-500 focus:outline-none" />
                <span className="mt-1 block font-normal">Use at least 14 characters and deliver it through a secure channel.</span>
              </label>
            </>
          )}
          <label className="text-xs font-bold text-sa-400 md:col-span-2">
            Role
            <select value={values.role} onChange={(event) => onChange('role', event.target.value)} className="mt-1 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white focus:border-orange-500 focus:outline-none">
              {roles.filter((role) => role !== 'platform_owner').map((role) => <option key={role}>{role}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-sa-400 md:col-span-2">
            Audit reason
            <textarea required minLength={5} maxLength={500} value={values.reason} onChange={(event) => onChange('reason', event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-sa-700 bg-sa-950 px-3 py-2 text-white focus:border-orange-500 focus:outline-none" />
          </label>
        </div>
        <h3 className="mt-5 text-sm font-black">Direct permissions</h3>
        <p className="mt-1 text-xs text-sa-500">These are added to the permissions inherited from the selected role.</p>
        <PermissionPicker permissions={permissions} selected={values.permissions} onToggle={onToggle} />
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" disabled={submitting} onClick={onClose} className="rounded-xl border border-sa-700 px-4 py-2 text-sm font-bold disabled:opacity-50">Cancel</button>
          <button disabled={submitting || values.reason.trim().length < 5} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-black text-sa-950 disabled:opacity-50">
            {submitting ? 'Saving…' : createMode ? 'Create administrator' : 'Save permissions'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AdminUsersPage() {
  const [data, setData] = useState({ admins: [], availableRoles: [], availablePermissions: [] });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [action, setAction] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ role: '', permissions: [], reason: '' });
  const [form, setForm] = useState(emptyCreateForm);

  const load = async () => {
    setLoading(true);
    try {
      setData(await saApi.getAdmins());
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = (setter, permission) => setter((current) => ({
    ...current,
    permissions: current.permissions.includes(permission)
      ? current.permissions.filter((item) => item !== permission)
      : [...current.permissions, permission]
  }));

  const create = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await saApi.createAdmin(form);
      toast.success('Super Admin created');
      setShowCreate(false);
      setForm(emptyCreateForm);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (admin) => {
    setEditing(admin);
    setEditForm({ role: admin.role, permissions: Array.isArray(admin.permissions) ? admin.permissions : [], reason: '' });
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    if (submitting || !editing) return;
    setSubmitting(true);
    try {
      await saApi.updateAdmin(editing.id, { ...editForm, confirmed: true });
      toast.success('Administrator permissions updated');
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = async ({ reason, confirmation }) => {
    if (action.type === 'revoke') {
      await saApi.revokeAdminSessions(action.admin.id, { reason, confirmation, confirmed: true });
    } else {
      await saApi.updateAdmin(action.admin.id, {
        isActive: !action.admin.isActive,
        reason,
        confirmation,
        confirmed: true
      });
    }
    toast.success(action.type === 'revoke' ? 'Administrator sessions revoked' : 'Administrator status updated');
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Platform team</h1>
          <p className="mt-1 text-sm text-sa-500">Granular control-plane roles, permissions, MFA status, and revocable sessions.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-black text-sa-950 focus:outline-none focus:ring-2 focus:ring-orange-300">Add administrator</button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-sa-800 bg-sa-900">
        {loading ? <div className="h-48 animate-pulse bg-sa-900" aria-label="Loading administrators" /> : data.admins.length === 0 ? (
          <div className="p-10 text-center text-sm text-sa-500">No administrators found.</div>
        ) : (
          <div className="divide-y divide-sa-800">
            {data.admins.map((admin) => (
              <div key={admin.id} className="grid gap-3 p-4 text-sm lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-center">
                <div>
                  <div className="font-black">
                    {admin.name || admin.email}
                    {admin.isPrimary && <span className="ml-2 rounded bg-orange-500/10 px-2 py-0.5 text-[10px] text-orange-400">PRIMARY OWNER</span>}
                  </div>
                  <div className="text-xs text-sa-500">{admin.email} · last login {admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString() : 'never'}</div>
                </div>
                <div>
                  <div className="capitalize">{admin.role.replaceAll('_', ' ')}</div>
                  <div className="text-xs text-sa-500">{admin.permissions.length} direct permissions</div>
                </div>
                <div className="text-xs">
                  <span className={admin.isActive ? 'text-emerald-400' : 'text-red-400'}>{admin.isActive ? 'Active' : 'Inactive'}</span>
                  {' · '}
                  <span className={admin.twoFactorEnabled ? 'text-emerald-400' : 'text-amber-400'}>{admin.twoFactorEnabled ? 'MFA enabled' : 'MFA not enabled'}</span>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {!admin.isPrimary && <button onClick={() => startEdit(admin)} className="rounded-lg border border-sa-700 px-3 py-1.5 font-bold hover:border-orange-500">Edit access</button>}
                  <button onClick={() => setAction({ type: 'revoke', admin })} className="rounded-lg border border-sa-700 px-3 py-1.5 font-bold hover:border-orange-500">Revoke sessions</button>
                  {!admin.isPrimary && <button onClick={() => setAction({ type: 'status', admin })} className={`rounded-lg border px-3 py-1.5 font-bold ${admin.isActive ? 'border-red-900 text-red-400' : 'border-emerald-900 text-emerald-400'}`}>{admin.isActive ? 'Deactivate' : 'Activate'}</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <AdminFormModal
          title="Add Super Admin"
          roles={data.availableRoles}
          permissions={data.availablePermissions}
          values={form}
          submitting={submitting}
          createMode
          onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))}
          onToggle={(permission) => toggle(setForm, permission)}
          onClose={() => setShowCreate(false)}
          onSubmit={create}
        />
      )}

      {editing && (
        <AdminFormModal
          title={`Edit access · ${editing.email}`}
          roles={data.availableRoles}
          permissions={data.availablePermissions}
          values={editForm}
          submitting={submitting}
          onChange={(field, value) => setEditForm((current) => ({ ...current, [field]: value }))}
          onToggle={(permission) => toggle(setEditForm, permission)}
          onClose={() => setEditing(null)}
          onSubmit={saveEdit}
        />
      )}

      <ConfirmActionDialog
        open={Boolean(action)}
        onClose={() => setAction(null)}
        onConfirm={confirm}
        title={action?.type === 'revoke' ? 'Revoke administrator sessions' : `${action?.admin?.isActive ? 'Deactivate' : 'Activate'} administrator`}
        description={action?.type === 'revoke' ? 'Invalidates all active identity and refresh sessions for this administrator.' : 'Changes whether this administrator can authenticate to the control plane.'}
        confirmLabel={action?.type === 'revoke' ? 'Revoke sessions' : action?.admin?.isActive ? 'Deactivate administrator' : 'Activate administrator'}
        confirmationText={action?.admin?.email}
        tone="danger"
      />
    </div>
  );
}
