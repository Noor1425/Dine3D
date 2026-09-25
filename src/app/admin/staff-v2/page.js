'use client';

import { useState, useEffect } from 'react';
import { 
  Users, Search, Filter, Plus, Mail, Edit2, Trash2, 
  Building2, CheckCircle, XCircle, Clock, MoreVertical,
  ChevronDown, UserPlus, Shield
} from 'lucide-react';
import apiClient from '@/lib/api';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';

/**
 * Professional Staff Management UI
 * Manage staff with roles, branch assignments, and access levels
 */
export default function StaffV2Page() {
  const { can, role: actorRole, accessLevel, currentBranch } = useAdminAccess();
  const canInvite = can('staff.invite');
  const canWrite = can('staff.write');
  const canDelete = can('staff.delete');
  const [staff, setStaff] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [filters, setFilters] = useState({
    search: '',
    role: 'all',
    status: 'all',
    branch: 'all',
    accessLevel: 'all'
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [staffRes, branchesRes] = await Promise.all([
        apiClient.get('/v2/staff'),
        apiClient.get('/v2/branches')
      ]);
      setStaff(staffRes.staff || []);
      setBranches(branchesRes.branches || []);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredStaff = staff.filter(member => {
    if (filters.search) {
      const search = filters.search.toLowerCase();
      if (!member.user.name.toLowerCase().includes(search) &&
          !member.user.email.toLowerCase().includes(search)) {
        return false;
      }
    }
    if (filters.role !== 'all' && member.role !== filters.role) return false;
    if (filters.status !== 'all' && member.status !== filters.status) return false;
    if (filters.accessLevel !== 'all' && member.accessLevel !== filters.accessLevel) return false;
    if (filters.branch !== 'all') {
      const hasAccess = member.branchMembers?.some(bm => bm.branchId === filters.branch);
      if (!hasAccess) return false;
    }
    return true;
  });

  const handleDeleteStaff = async (memberId) => {
    if (!confirm('Are you sure you want to remove this staff member?')) return;

    try {
      await apiClient.delete(`/v2/staff/${memberId}`);
      setStaff(staff.filter(s => s.id !== memberId));
    } catch (error) {
      alert('Failed to delete staff member');
    }
  };

  return (
    <div className="min-h-screen min-w-0 max-w-full bg-gray-50 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
            <div className="min-w-[12rem] flex-1">
              <h1 className="flex items-center text-2xl font-bold text-gray-900 sm:text-3xl">
                <Users className="mr-3 h-8 w-8 shrink-0 text-blue-600" />
                Staff Management
              </h1>
              <p className="text-gray-600 mt-2">
                Manage team members, roles, and branch access
              </p>
            </div>
            {canInvite && <button
              onClick={() => setShowInviteModal(true)}
              className="flex max-w-full items-center space-x-2 rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-blue-700 sm:px-6"
            >
              <UserPlus className="w-5 h-5" />
              <span>Invite Staff Member</span>
            </button>}
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {/* Search */}
            <div className="md:col-span-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name or email..."
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Role Filter */}
            <div>
              <select
                value={filters.role}
                onChange={(e) => setFilters({ ...filters, role: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Roles</option>
                <option value="owner">Owner</option>
                <option value="manager">Manager</option>
                <option value="staff">Staff</option>
              </select>
            </div>

            {/* Access Level Filter */}
            <div>
              <select
                value={filters.accessLevel}
                onChange={(e) => setFilters({ ...filters, accessLevel: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Access Levels</option>
                <option value="corporate">Corporate</option>
                <option value="multi-branch">Multi-Branch</option>
                <option value="branch">Single Branch</option>
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
        </div>

        {/* Staff List */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-600 mt-4">Loading staff...</p>
            </div>
          ) : filteredStaff.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Staff Found</h3>
              <p className="text-gray-500">Try adjusting your filters or invite new team members.</p>
            </div>
          ) : (
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Staff Member
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Role
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Access Level
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Branches
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredStaff.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                            <span className="text-blue-600 font-semibold">
                              {member.user.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{member.user.name}</p>
                            <p className="text-sm text-gray-500">{member.user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                          <Shield className="w-3 h-3 mr-1" />
                          {member.role}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                          member.accessLevel === 'corporate' ? 'bg-green-100 text-green-700' :
                          member.accessLevel === 'multi-branch' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {member.accessLevel === 'corporate' && '🌐 All Branches'}
                          {member.accessLevel === 'multi-branch' && '🏢 Multiple'}
                          {member.accessLevel === 'branch' && '🏪 Single'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {member.accessLevel === 'corporate' ? (
                          <span className="text-sm text-gray-600">All ({branches.length})</span>
                        ) : (
                          <span className="text-sm text-gray-600">
                            {member.branchMembers?.length || 0} branch(es)
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {member.status === 'active' ? (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            <XCircle className="w-3 h-3 mr-1" />
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          {canWrite && <button
                            onClick={() => {
                              setSelectedStaff(member);
                              setShowEditModal(true);
                            }}
                            className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>}
                          {canDelete && <button
                            onClick={() => handleDeleteStaff(member.id)}
                            className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                            title="Remove"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Invite Modal */}
        {showInviteModal && canInvite && (
          <InviteStaffModal
            branches={branches}
            actorRole={actorRole}
            actorAccessLevel={accessLevel}
            currentBranch={currentBranch}
            onClose={() => setShowInviteModal(false)}
            onSuccess={() => {
              setShowInviteModal(false);
              loadData();
            }}
          />
        )}

        {/* Edit Modal */}
        {showEditModal && canWrite && selectedStaff && (
          <EditStaffModal
            member={selectedStaff}
            branches={branches}
            onClose={() => {
              setShowEditModal(false);
              setSelectedStaff(null);
            }}
            onSuccess={() => {
              setShowEditModal(false);
              setSelectedStaff(null);
              loadData();
            }}
          />
        )}
      </div>
    </div>
  );
}

function InviteStaffModal({ branches, actorRole, actorAccessLevel, currentBranch, onClose, onSuccess }) {
  const isBranchManager = actorRole === 'manager' && actorAccessLevel !== 'corporate';
  const fixedBranch = branches.find((branch) => branch.id === currentBranch?.id) || branches[0] || null;
  const roles = actorRole === 'owner'
    ? ['staff', 'cashier', 'waiter', 'chef', 'manager', 'owner']
    : ['staff', 'cashier', 'waiter', 'chef'];
  const [formData, setFormData] = useState({
    email: '',
    role: 'staff',
    accessLevel: 'branch',
    branchIds: isBranchManager && fixedBranch ? [fixedBranch.id] : []
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload = isBranchManager
        ? { ...formData, accessLevel: 'branch', branchIds: fixedBranch ? [fixedBranch.id] : [] }
        : formData;
      await apiClient.post('/v2/auth/invitations/send', payload);
      onSuccess();
    } catch (err) {
      setError(err.message || 'Failed to send invitation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Invite Staff Member</h2>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="staff@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Role *</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({
                ...formData,
                role: e.target.value,
                ...(e.target.value === 'owner' ? { accessLevel: 'corporate', branchIds: [] } : {}),
              })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              {roles.map((role) => <option key={role} value={role}>{role.charAt(0).toUpperCase() + role.slice(1)}</option>)}
            </select>
          </div>

          {isBranchManager ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Branch assignment</p>
              <p className="mt-1 font-semibold text-gray-900">{fixedBranch?.name || 'Assigned branch'}</p>
              <p className="mt-1 text-xs text-gray-600">The server automatically restricts this worker to your branch. Manager, owner, and cross-branch roles require the restaurant owner.</p>
            </div>
          ) : formData.role === 'owner' ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Co-owner access applies to the complete restaurant chain.
            </div>
          ) : <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Access Level *</label>
            <select
              value={formData.accessLevel}
              onChange={(e) => setFormData({ ...formData, accessLevel: e.target.value, branchIds: [] })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="branch">Single Branch</option>
              <option value="multi-branch">Multiple Branches</option>
              <option value="corporate">Corporate (All Branches)</option>
            </select>
          </div>}

          {!isBranchManager && formData.role !== 'owner' && formData.accessLevel !== 'corporate' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Assign Branches * (Select {formData.accessLevel === 'branch' ? '1' : 'multiple'})
              </label>
              <div className="max-h-48 overflow-y-auto border border-gray-300 rounded-lg p-3 space-y-2">
                {branches.map((branch) => (
                  <label key={branch.id} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type={formData.accessLevel === 'branch' ? 'radio' : 'checkbox'}
                      name="branch"
                      checked={formData.branchIds.includes(branch.id)}
                      onChange={(e) => {
                        if (formData.accessLevel === 'branch') {
                          setFormData({ ...formData, branchIds: [branch.id] });
                        } else {
                          const newIds = e.target.checked
                            ? [...formData.branchIds, branch.id]
                            : formData.branchIds.filter(id => id !== branch.id);
                          setFormData({ ...formData, branchIds: newIds });
                        }
                      }}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700">{branch.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || (!isBranchManager && formData.accessLevel !== 'corporate' && formData.branchIds.length === 0) || (isBranchManager && !fixedBranch)}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Send Invitation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditStaffModal({ member, branches, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    role: member.role,
    accessLevel: member.accessLevel,
    status: member.status,
    branchIds: member.branchMembers?.map(bm => bm.branchId) || []
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await apiClient.put(`/v2/staff/${member.id}`, formData);
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update staff member');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Edit Staff Member</h2>
        <p className="text-gray-600 mb-6">{member.user.name} ({member.user.email})</p>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Access Level</label>
            <select
              value={formData.accessLevel}
              onChange={(e) => setFormData({ ...formData, accessLevel: e.target.value, branchIds: [] })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="branch">Single Branch</option>
              <option value="multi-branch">Multiple Branches</option>
              <option value="corporate">Corporate (All Branches)</option>
            </select>
          </div>

          {formData.accessLevel !== 'corporate' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Branch Access
              </label>
              <div className="max-h-48 overflow-y-auto border border-gray-300 rounded-lg p-3 space-y-2">
                {branches.map((branch) => (
                  <label key={branch.id} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type={formData.accessLevel === 'branch' ? 'radio' : 'checkbox'}
                      name="branch"
                      checked={formData.branchIds.includes(branch.id)}
                      onChange={(e) => {
                        if (formData.accessLevel === 'branch') {
                          setFormData({ ...formData, branchIds: [branch.id] });
                        } else {
                          const newIds = e.target.checked
                            ? [...formData.branchIds, branch.id]
                            : formData.branchIds.filter(id => id !== branch.id);
                          setFormData({ ...formData, branchIds: newIds });
                        }
                      }}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700">{branch.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
