'use client';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';

const ROLES = [
  { id: 'owner', label: 'Owner', desc: 'Full business control', icon: '👑' },
  { id: 'manager', label: 'Manager', desc: 'Stock & Staff management', icon: '💼' },
  { id: 'cashier', label: 'Cashier', desc: 'Billing and shift operations', icon: '💳' },
  { id: 'waiter', label: 'Waiter', desc: 'Can take and manage table orders', icon: '🍽️' },
  { id: 'chef', label: 'Chef', desc: 'Kitchen status and prep workflow', icon: '👨‍🍳' },
  { id: 'staff', label: 'Staff', desc: 'General staff fallback role', icon: '🧰' },
];

export default function StaffPage() {
  const {
    can,
    role: actorRole,
    accessLevel,
    accessibleBranchIds,
    branches,
    currentBranch,
  } = useAdminAccess();
  const canInvite = can('staff.invite');
  const canWrite = can('staff.write');
  const canDelete = can('staff.delete');
  const canManageCustomRoles = can('custom_roles.write');
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editMember, setEditMember] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [customRoles, setCustomRoles] = useState([]);
  const [permissionCatalog, setPermissionCatalog] = useState([]);
  const [customRolesEnabled, setCustomRolesEnabled] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [roleForm, setRoleForm] = useState({
    key: '',
    name: '',
    description: '',
    actions: []
  });
  
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'cashier',
    pin: '',
    isActive: true,
    customRoleId: '',
    accessLevel: 'branch',
    branchIds: []
  });

  const isBranchManager = actorRole === 'manager' && accessLevel !== 'corporate';
  const assignableRoles = actorRole === 'owner'
    ? ROLES
    : ROLES.filter((role) => !['owner', 'manager'].includes(role.id));
  const availableBranches = (branches || []).filter((branch) => branch.id !== 'all');
  const fixedBranch = availableBranches.find((branch) => branch.id === currentBranch?.id)
    || availableBranches.find((branch) => accessibleBranchIds.includes(branch.id))
    || null;

  useEffect(() => {
    if (!actorRole || (isBranchManager && !fixedBranch)) return;
    loadData();
  // The selected branch is the security boundary for this screen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorRole, fixedBranch?.id, isBranchManager]);

  const loadData = async () => {
    try {
      if (isBranchManager && fixedBranch) {
        const branchTeam = await api.get(`/v2/branches/${fixedBranch.id}/members`);
        setStaff([
          ...(branchTeam.assigned || []).map((member) => ({
            id: member.id,
            name: member.name,
            email: member.email,
            role: member.branchRole,
            customRole: member.customRole ? { name: member.customRole } : null,
            isActive: member.isActive,
            branchScoped: true,
          })),
          ...(branchTeam.pending || []).map((invitation) => ({
            id: `invitation:${invitation.id}`,
            name: invitation.name,
            email: invitation.email,
            role: invitation.role,
            isActive: false,
            invitationPending: true,
            expiresAt: invitation.expiresAt,
          })),
        ]);
      } else {
        const res = await api.getStaff();
        setStaff(res.staff);
      }
      if (can('custom_roles.read')) {
        api.getCustomRoles()
          .then(result => setCustomRoles(result.roles || []))
          .catch(() => setCustomRoles([]));
      }
      if (canManageCustomRoles) {
        api.getCustomRolePermissionCatalog()
          .then(result => setPermissionCatalog(result.permissions || []))
          .catch(() => setPermissionCatalog([]));
      }
      api.getEntitlements()
        .then(result => setCustomRolesEnabled(result.features?.custom_roles?.allowed === true))
        .catch(() => setCustomRolesEnabled(false));
    } catch (err) {
      console.error(err);
      toast.error('Failed to load team members');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditMember(null);
    setForm({
      name: '',
      email: '',
      password: '', // Not used for invitations
      role: 'cashier',
      pin: '', // Not used for invitations
      isActive: true,
      customRoleId: '',
      accessLevel: 'branch',
      branchIds: fixedBranch ? [fixedBranch.id] : []
    });
    setShowModal(true);
  };

  const openEdit = (member) => {
    setEditMember(member);
    setForm({
      name: member.name || '',
      email: member.email,
      password: '', // Keep empty for no change
      role: member.role,
      pin: '',
      isActive: member.isActive,
      customRoleId: member.customRoleId || ''
    });
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editMember) {
        // Editing existing staff member
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        if (!payload.pin) delete payload.pin;

        await api.updateStaff(editMember.id, payload);
        toast.success('Team member updated');
      } else {
        // Creating new staff via invitation
        const invitationAccessLevel = form.role === 'owner'
          ? 'corporate'
          : isBranchManager
            ? 'branch'
            : form.accessLevel;
        const invitationBranchIds = invitationAccessLevel === 'corporate'
          ? []
          : isBranchManager && fixedBranch
            ? [fixedBranch.id]
            : form.branchIds;
        if (invitationAccessLevel !== 'corporate' && invitationBranchIds.length === 0) {
          toast.error('Select the branch this team member will work in.');
          setSaving(false);
          return;
        }
        const payload = {
          email: form.email,
          name: form.name,
          role: form.role,
          customRoleId: form.customRoleId || undefined,
          accessLevel: invitationAccessLevel,
          branchIds: invitationBranchIds
        };

        await api.post('/v2/auth/invitations/send', payload);
        toast.success('Invitation sent! The team member will receive an email to set up their account.');
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      toast.error(err.message || 'Action failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to remove this team member? This action cannot be undone.')) return;
    try {
      await api.deleteStaff(id);
      toast.success('Team member removed');
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const createCustomRole = async (event) => {
    event.preventDefault();
    try {
      await api.createCustomRole({
        key: roleForm.key,
        name: roleForm.name,
        description: roleForm.description,
        permissions: {
          actions: roleForm.actions
        }
      });
      const result = await api.getCustomRoles();
      setCustomRoles(result.roles || []);
      setShowRoleModal(false);
      setRoleForm({
        key: '',
        name: '',
        description: '',
        actions: []
      });
      toast.success('Custom role created');
    } catch (error) {
      toast.error(error.message);
    }
  };

  const permissionGroups = permissionCatalog.reduce((groups, permission) => {
    const group = permission.group || 'Other';
    groups[group] = [...(groups[group] || []), permission];
    return groups;
  }, {});

  const toggleRolePermission = (permission) => {
    setRoleForm((current) => ({
      ...current,
      actions: current.actions.includes(permission)
        ? current.actions.filter((item) => item !== permission)
        : [...current.actions, permission],
    }));
  };

  const filteredStaff = search 
    ? staff.filter(s => s.name?.toLowerCase().includes(search.toLowerCase()) || s.email.toLowerCase().includes(search.toLowerCase()))
    : staff;

  if (loading) return (
    <div>
      <div className="page-header"><div className="skeleton skeleton-heading" /></div>
      <div className="skeleton skeleton-card" style={{height:400}} />
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Team Management</h1>
          <div className="page-header-subtitle">Invite staff members via email - they'll create their own secure credentials</div>
        </div>
        <div style={{display:'flex', gap:8}}>
          {customRolesEnabled && canManageCustomRoles && <button className="btn btn-outline" onClick={() => setShowRoleModal(true)}>Custom Roles</button>}
          {canInvite && <button className="btn btn-primary" onClick={openCreate}>📧 Invite Team Member</button>}
        </div>
      </div>

      <div style={{marginBottom:24, display:'flex', gap:16, alignItems:'center'}}>
        <div className="form-group" style={{margin:0, flex:1, maxWidth:400}}>
          <input 
            className="input" 
            value={search} 
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Search name or email..." 
          />
        </div>
        <div style={{fontSize:13, color:'var(--color-text-muted)'}}>
          Showing {filteredStaff.length} members
        </div>
      </div>

      <div className="card animate-in">
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>POS PIN</th>
                <th>Status</th>
                <th>Last Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredStaff.map((member, i) => (
                <tr key={member.id} style={{animationDelay: `${i * 30}ms`}} className="animate-in">
                  <td>
                    <div style={{display:'flex', alignItems:'center', gap:12}}>
                      <div style={{
                        width:36, height:36, borderRadius:50, 
                        background:'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                        color:'white', display:'flex', alignItems:'center', justifyContent:'center',
                        fontWeight:700, fontSize:14
                      }}>
                        {member.name ? member.name.charAt(0).toUpperCase() : '?'}
                      </div>
                      <div>
                        <div style={{fontWeight:600}}>{member.name || 'Unnamed Staff'}</div>
                        <div style={{fontSize:12, color:'var(--color-text-muted)'}}>{member.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge badge-neutral`} style={{display:'flex', alignItems:'center', width:'fit-content', gap:4}}>
                      {ROLES.find(r => r.id === member.role)?.icon} {(member.customRole?.name || member.role).toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-neutral">Configured via secure hash</span>
                  </td>
                  <td>
                    <span className={`badge badge-dot ${member.isActive ? 'badge-success' : member.invitationPending ? 'badge-warning' : 'badge-danger'}`}>
                      {member.isActive ? 'Active' : member.invitationPending ? 'Invitation pending' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <span style={{fontSize:12, color:'var(--color-text-muted)'}}>
                      {member.invitationPending ? `Expires ${new Date(member.expiresAt).toLocaleDateString()}` : member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleDateString() : 'Never'}
                    </span>
                  </td>
                  <td>
                    <div className="data-table-actions">
                      {canWrite && <button className="btn btn-ghost btn-icon-sm" onClick={() => openEdit(member)} aria-label={`Edit ${member.name || member.email}`}>✏️</button>}
                      {canDelete && member.role !== 'owner' && (
                        <button className="btn btn-ghost btn-icon-sm" onClick={() => handleDelete(member.id)} style={{color:'var(--color-danger)'}}>🗑️</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && ((editMember && canWrite) || (!editMember && canInvite)) && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth: 550}}>
            <div className="modal-header">
              <h2>{editMember ? 'Edit Team Member' : 'Add New Member'}</h2>
              <button className="btn btn-ghost btn-icon-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body" style={{padding: '32px'}}>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Full Name</label>
                    <input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="John Doe" required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email Address</label>
                    <input
                      className="input"
                      type="email"
                      value={form.email}
                      onChange={e => setForm({...form, email: e.target.value})}
                      placeholder="john@restaurant.com"
                      required
                      disabled={editMember} // Email cannot be changed
                    />
                  </div>
                </div>

                {!editMember && (
                  <div className="alert alert-info" style={{marginBottom: 24, padding: 16, background: 'var(--color-bg-info)', border: '1px solid var(--color-info)', borderRadius: 12}}>
                    <div style={{display: 'flex', alignItems: 'start', gap: 12}}>
                      <span style={{fontSize: 20}}>📧</span>
                      <div>
                        <div style={{fontWeight: 600, marginBottom: 4}}>Invitation-Based Registration</div>
                        <div style={{fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5}}>
                          An invitation email will be sent to <strong>{form.email || 'the provided email'}</strong>.
                          The team member will create their own secure password and PIN when accepting the invitation.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {customRoles.length > 0 && form.role !== 'owner' && (
                  <div className="form-group">
                    <label className="form-label">Enterprise Custom Role (Optional)</label>
                    <select className="input" value={form.customRoleId} onChange={e => setForm({...form, customRoleId: e.target.value})}>
                      <option value="">Use standard role permissions</option>
                      {customRoles.filter(role => role.isActive).map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
                    </select>
                  </div>
                )}

                {editMember && (
                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label">New Password (Optional)</label>
                      <input className="input" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="••••••••" />
                      <div style={{fontSize:12, color:'var(--color-text-muted)', marginTop:6}}>Leave blank to keep current password</div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">POS Login PIN (Optional)</label>
                      <input className="input" type="text" maxLength={4} value={form.pin} onChange={e => setForm({...form, pin: e.target.value.replace(/\D/g,'')})} placeholder="1234" />
                      <div style={{fontSize:12, color:'var(--color-text-muted)', marginTop:6}}>Leave blank to keep current PIN</div>
                    </div>
                  </div>
                )}

                <label className="form-label">Select Access Role</label>
                <div className="grid-2" style={{gap:12, marginBottom:24}}>
                  {assignableRoles.map(role => (
                    <div 
                      key={role.id}
                      onClick={() => setForm({...form, role: role.id})}
                      style={{
                        padding: '16px', borderRadius: '16px', border: '2px solid',
                        borderColor: form.role === role.id ? 'var(--color-primary)' : 'var(--color-border)',
                        background: form.role === role.id ? 'var(--color-bg-primary-fade)' : 'white',
                        cursor: 'pointer', transition: 'all 0.2s', position: 'relative'
                      }}
                    >
                      <div style={{fontSize:20, marginBottom:8}}>{role.icon}</div>
                      <div style={{fontWeight:700, fontSize:14}}>{role.label}</div>
                      <div style={{fontSize:11, color:'var(--color-text-muted)', lineHeight:1.4}}>{role.desc}</div>
                      {form.role === role.id && (
                        <div style={{position:'absolute', top:12, right:12, color:'var(--color-primary)'}}>✓</div>
                      )}
                    </div>
                  ))}
                </div>

                {!editMember && isBranchManager && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4" style={{marginBottom: 24}}>
                    <div style={{fontSize: 12, fontWeight: 800, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.08em'}}>Branch assignment</div>
                    <div style={{fontWeight: 700, marginTop: 6}}>{fixedBranch?.name || 'Assigned branch'}</div>
                    <div style={{fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4}}>This invitation is automatically restricted to your branch. Owners, managers, and cross-branch access can only be granted by the restaurant owner.</div>
                  </div>
                )}

                {!editMember && actorRole === 'owner' && form.role !== 'owner' && (
                  <div style={{marginBottom: 24}}>
                    <div className="form-group">
                      <label className="form-label">Location access</label>
                      <select className="input" value={form.accessLevel} onChange={(event) => setForm({...form, accessLevel: event.target.value, branchIds: []})}>
                        <option value="branch">Single branch</option>
                        <option value="multi-branch">Multiple branches</option>
                        <option value="corporate">All branches (corporate)</option>
                      </select>
                    </div>
                    {form.accessLevel !== 'corporate' && (
                      <div className="form-group">
                        <label className="form-label">Assigned {form.accessLevel === 'branch' ? 'branch' : 'branches'}</label>
                        <div style={{border: '1px solid var(--color-border)', borderRadius: 12, padding: 12, display: 'grid', gap: 8, maxHeight: 180, overflowY: 'auto'}}>
                          {availableBranches.length === 0 && <div style={{fontSize: 12, color: 'var(--color-text-muted)'}}>No active branches are available.</div>}
                          {availableBranches.map((branch) => (
                            <label key={branch.id} style={{display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer'}}>
                              <input
                                type={form.accessLevel === 'branch' ? 'radio' : 'checkbox'}
                                name="invitation-branch"
                                checked={form.branchIds.includes(branch.id)}
                                onChange={(event) => setForm({
                                  ...form,
                                  branchIds: form.accessLevel === 'branch'
                                    ? [branch.id]
                                    : event.target.checked
                                      ? [...new Set([...form.branchIds, branch.id])]
                                      : form.branchIds.filter((id) => id !== branch.id),
                                })}
                              />
                              <span><strong>{branch.name}</strong>{branch.code ? ` · ${branch.code}` : ''}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!editMember && actorRole === 'owner' && form.role === 'owner' && (
                  <div className="alert alert-info" style={{marginBottom: 24, padding: 14, borderRadius: 12}}>
                    Co-owner access covers the entire restaurant chain. Only an existing owner can grant this role.
                  </div>
                )}

                <div className="form-group">
                  <label style={{display:'flex', alignItems:'center', gap:10, cursor:'pointer'}}>
                    <input 
                      type="checkbox" 
                      style={{width:18, height:18}}
                      checked={form.isActive} 
                      onChange={e => setForm({...form, isActive: e.target.checked})} 
                    />
                    <div>
                      <div style={{fontWeight:600, fontSize:14}}>Active Account</div>
                      <div style={{fontSize:12, color:'var(--color-text-muted)'}}>If disabled, this user will not be able to log in.</div>
                    </div>
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Processing...' : (editMember ? 'Save Changes' : '📧 Send Invitation')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRoleModal && canManageCustomRoles && (
        <div className="modal-overlay" onClick={() => setShowRoleModal(false)}>
          <div className="modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header"><h2>Create Custom Role</h2><button className="btn btn-ghost" onClick={() => setShowRoleModal(false)}>✕</button></div>
            <form onSubmit={createCustomRole}>
              <div className="modal-body">
                <div className="grid-2">
                  <div className="form-group"><label className="form-label">Stable key</label><input required className="input" value={roleForm.key} onChange={e => setRoleForm({...roleForm, key:e.target.value})} placeholder="floor_supervisor" /></div>
                  <div className="form-group"><label className="form-label">Name</label><input required className="input" value={roleForm.name} onChange={e => setRoleForm({...roleForm, name:e.target.value})} placeholder="Floor Supervisor" /></div>
                </div>
                <div className="form-group"><label className="form-label">Description</label><input className="input" value={roleForm.description} onChange={e => setRoleForm({...roleForm, description:e.target.value})} /></div>
                <div className="form-group">
                  <label className="form-label">Permissions</label>
                  <div className="max-h-[360px] space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
                    {Object.entries(permissionGroups).map(([group, permissions]) => (
                      <fieldset key={group}>
                        <legend className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{group}</legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {permissions.map((permission) => (
                            <label key={permission.key} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm transition hover:border-slate-300">
                              <input
                                type="checkbox"
                                checked={roleForm.actions.includes(permission.key)}
                                onChange={() => toggleRolePermission(permission.key)}
                                className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
                              />
                              <span>
                                <span className="block font-semibold text-slate-800">{permission.description}</span>
                                <span className="mt-0.5 block font-mono text-[10px] text-slate-400">{permission.key}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    ))}
                    {permissionCatalog.length === 0 ? (
                      <p className="text-sm text-slate-500">No delegable permissions are available for this account.</p>
                    ) : null}
                  </div>
                  <div className="form-hint">Least privilege is enforced: you can grant only explicit permissions already available to your own account.</div>
                </div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={() => setShowRoleModal(false)}>Cancel</button><button className="btn btn-primary">Create Role</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
