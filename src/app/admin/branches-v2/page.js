'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Building2, CalendarDays, ChevronLeft,
  Clock3, Edit3, Mail, MapPin, MoreVertical, PackageSearch, Phone, Plus,
  RefreshCw, Search, Store, Trash2, UserCog, Users, WalletCards, X,
} from 'lucide-react';
import api from '@/lib/api';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const ROLES = ['manager', 'cashier', 'chef', 'waiter', 'staff'];
const EMPTY_HOURS = Object.fromEntries(DAYS.map((day) => [day, { closed: day === 'sunday', open: '09:00', close: '22:00' }]));
const TIMEZONES = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles'];

const money = (value) => `PKR ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const titleCase = (value) => String(value || '').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const apiMessage = (error, fallback) => error?.message || fallback;

export default function BranchesPage() {
  const { can, accessLevel, role: actorRole } = useAdminAccess();
  const isBranchScoped = accessLevel !== 'corporate';
  const canWrite = can('locations.write') && (accessLevel === 'corporate' || actorRole === 'manager');
  const canRequest = actorRole === 'owner' && accessLevel === 'corporate';
  const canDelete = can('locations.delete') && accessLevel === 'corporate';
  const [data, setData] = useState({ branches: [], canManageAll: false, usage: {} });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [menu, setMenu] = useState(null);

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const [response, requestData] = await Promise.all([
        api.get(`/v2/branches?includeInactive=${status !== 'active'}`),
        canRequest ? api.get('/v2/branches/requests/mine') : Promise.resolve({ requests: [] }),
      ]);
      setData({ ...response, requests: requestData.requests || [] });
    } catch (requestError) {
      setError(apiMessage(requestError, 'Locations could not be loaded.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [status, canRequest]);

  useEffect(() => { load(); }, [load]);

  const branches = useMemo(() => data.branches.filter((branch) => {
    if (status === 'active' && !branch.isActive) return false;
    if (status === 'inactive' && branch.isActive) return false;
    const text = `${branch.name} ${branch.code} ${branch.city || ''} ${branch.address || ''}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  }), [data.branches, query, status]);

  const portfolio = useMemo(() => data.branches.reduce((result, branch) => ({
    sales: result.sales + Number(branch.metrics?.todaySales || 0),
    orders: result.orders + Number(branch.metrics?.todayOrders || 0),
    team: result.team + Number(branch.teamCount || 0),
    alerts: result.alerts + Number(branch.metrics?.lowStockAlerts || 0),
  }), { sales: 0, orders: 0, team: 0, alerts: 0 }), [data.branches]);

  async function deactivate(branch) {
    setMenu(null);
    if (!window.confirm(`Deactivate ${branch.name}? Historical orders and reports will be preserved.`)) return;
    try { await api.delete(`/v2/branches/${branch.id}`); await load(true); }
    catch (requestError) { window.alert(apiMessage(requestError, 'The branch could not be deactivated.')); }
  }

  return (
    <div className="min-h-full bg-[#f6f7f9] text-slate-950">
      <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col gap-5 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-700">
              <Building2 size={15} /> {isBranchScoped ? 'Branch administration' : 'Multi-location operations'}
            </div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{isBranchScoped ? 'My branch' : 'Restaurant locations'}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-slate-500">{isBranchScoped ? 'Manage your location profile, hours, tax, service charges, and receipt settings. Chain identity and branch status remain under owner control.' : 'Monitor every branch, assign accountable managers, and keep each team inside its approved location.'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => load(true)} disabled={refreshing} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
            {canRequest && <button onClick={() => setEditing({ request: true })} disabled={data.canRequestLocation === false} title={data.canRequestLocation === false ? 'Your current subscription does not have available location capacity.' : ''} className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"><Plus size={17} /> Request location</button>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 py-5 lg:grid-cols-4">
          <Metric icon={WalletCards} label="Today’s sales" value={money(portfolio.sales)} />
          <Metric icon={CalendarDays} label="Today’s orders" value={portfolio.orders.toLocaleString()} />
          <Metric icon={Users} label="Assigned team" value={portfolio.team.toLocaleString()} />
          <Metric icon={AlertTriangle} label="Stock alerts" value={portfolio.alerts.toLocaleString()} warning={portfolio.alerts > 0} />
        </div>

        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, code, city, or address" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100" />
          </div>
          <div className="flex rounded-xl bg-slate-100 p-1">
            {['active', 'all', 'inactive'].map((item) => <button key={item} onClick={() => setStatus(item)} className={`rounded-lg px-3 py-2 text-xs font-bold ${status === item ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}>{titleCase(item)}</button>)}
          </div>
          {data.usage?.limit != null && <span className="px-2 text-xs font-semibold text-slate-500">{data.usage.current} active + {data.usage.pending || 0} pending of {data.usage.limit} locations</span>}
        </div>

        {canRequest && data.requests?.length > 0 && <RequestQueue requests={data.requests} onCancel={async (request) => {
          if (!window.confirm(`Cancel the request for ${request.profile?.name}?`)) return;
          try { await api.patch(`/v2/branches/requests/${request.id}/cancel`, {}); await load(true); }
          catch (requestError) { window.alert(apiMessage(requestError, 'The request could not be cancelled.')); }
        }} />}

        {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}
        {loading ? <Loading /> : branches.length === 0 ? <Empty canCreate={canRequest} onCreate={() => setEditing({ request: true })} /> : (
          <div className="grid gap-4 xl:grid-cols-2">
            {branches.map((branch) => (
              <article key={branch.id} className={`relative overflow-visible rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${branch.isActive ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-75'}`}>
                <div className="flex items-start gap-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white"><Store size={21} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-black">{branch.name}</h2>
                      {branch.isPrimary && <Badge tone="blue">Primary</Badge>}
                      <Badge tone={branch.isActive ? 'green' : 'gray'}>{branch.isActive ? 'Operating' : 'Inactive'}</Badge>
                    </div>
                    <p className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-400">{branch.code} · {branch.timezone}</p>
                  </div>
                  {(canWrite || canDelete) && <div className="relative">
                    <button aria-label="Location actions" onClick={() => setMenu(menu === branch.id ? null : branch.id)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><MoreVertical size={18} /></button>
                    {menu === branch.id && <div className="absolute right-0 top-10 z-20 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                      {canWrite && <button onClick={() => { setEditing(branch); setMenu(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50"><Edit3 size={15} /> {isBranchScoped ? 'Branch settings' : 'Edit profile'}</button>}
                      {canDelete && !branch.isPrimary && branch.isActive && <button onClick={() => deactivate(branch)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50"><Trash2 size={15} /> Deactivate</button>}
                    </div>}
                  </div>}
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <SmallMetric label="Sales today" value={money(branch.metrics?.todaySales)} />
                  <SmallMetric label="Orders" value={branch.metrics?.todayOrders || 0} />
                  <SmallMetric label="Open orders" value={branch.metrics?.openOrders || 0} />
                  <SmallMetric label="30-day sales" value={money(branch.metrics?.sales30d)} />
                </div>

                <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                  <Info icon={MapPin}>{[branch.address, branch.city, branch.state].filter(Boolean).join(', ') || 'Address not configured'}</Info>
                  <Info icon={Phone}>{branch.phone || 'Phone not configured'}</Info>
                  <Info icon={Clock3}>{todayHours(branch.businessHours)}</Info>
                  <Info icon={PackageSearch}>{branch.metrics?.lowStockAlerts || 0} inventory alerts</Info>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <div className="flex items-center gap-3">
                    <AvatarStack people={branch.managers || []} />
                    <div><p className="text-xs font-bold text-slate-900">{branch.managers?.length ? branch.managers.map((manager) => manager.name).join(', ') : 'Branch admin not assigned'}</p><p className="text-xs text-slate-400">{branch.teamCount || 0} assigned team members</p></div>
                  </div>
                  <button onClick={() => setDetail(branch)} className="inline-flex items-center gap-2 text-sm font-black text-blue-700 hover:text-blue-900">Manage location <ArrowRight size={16} /></button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {editing && <BranchForm branch={editing.id ? editing : null} requestMode={editing.request === true} restricted={isBranchScoped} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(true); }} />}
      {detail && <BranchDrawer branch={detail} actorRole={actorRole} canWrite={canWrite} canManageTeam={can('staff.invite') || can('staff.write')} onClose={() => setDetail(null)} onEdit={() => { setEditing(detail); setDetail(null); }} onChanged={async () => { await load(true); }} />}
    </div>
  );
}

function Metric({ icon: Icon, label, value, warning }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400"><Icon size={15} className={warning ? 'text-amber-500' : 'text-blue-600'} /> {label}</div><p className={`mt-2 text-xl font-black sm:text-2xl ${warning ? 'text-amber-700' : ''}`}>{value}</p></div>;
}
function SmallMetric({ label, value }) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 truncate text-sm font-black text-slate-900">{value}</p></div>; }
function Badge({ children, tone }) { const colors = tone === 'green' ? 'bg-emerald-50 text-emerald-700' : tone === 'blue' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'; return <span className={`min-w-0 max-w-full rounded-full px-2 py-1 text-center text-[10px] font-black uppercase tracking-wider ${colors}`}>{children}</span>; }
function Info({ icon: Icon, children }) { return <div className="flex min-w-0 items-center gap-2"><Icon size={15} className="shrink-0 text-slate-400" /><span className="truncate">{children}</span></div>; }
function AvatarStack({ people }) { return <div className="flex -space-x-2">{people.slice(0, 3).map((person) => <div key={person.id} title={person.name} className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-blue-100 text-[10px] font-black text-blue-700">{initials(person.name)}</div>)}{people.length === 0 && <div className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-slate-100 text-slate-400"><UserCog size={14} /></div>}</div>; }
function initials(name) { return String(name || '?').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
function todayHours(hours) { const day = DAYS[(new Date().getDay() + 6) % 7]; const schedule = hours?.[day]; return !schedule || schedule.closed ? 'Hours not configured' : `${schedule.open}–${schedule.close} today`; }
function Loading() { return <div className="grid gap-4 xl:grid-cols-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>; }
function Empty({ canCreate, onCreate }) { return <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><Store size={34} className="mx-auto text-slate-300" /><h2 className="mt-4 text-lg font-black">No matching locations</h2><p className="mt-1 text-sm text-slate-500">Try a different filter or create the next restaurant branch.</p>{canCreate && <button onClick={onCreate} className="mt-5 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white">Add location</button>}</div>; }

function RequestQueue({ requests, onCancel }) {
  return <section className="mb-5 rounded-2xl border border-blue-200 bg-blue-50/60 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h2 className="text-sm font-black">Location requests</h2><p className="text-xs text-slate-500">Approval provisions the operating location and sends its branch admin a secure activation link.</p></div><Badge tone="blue">{requests.filter((item) => item.status === 'PENDING').length} pending</Badge></div><div className="mt-3 grid gap-2 lg:grid-cols-2">{requests.slice(0, 6).map((request) => <div key={request.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-blue-100 bg-white p-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-100 text-blue-700"><Store size={16} /></div><div className="min-w-[12rem] flex-1"><p className="truncate text-sm font-bold">{request.profile?.name} <span className="text-slate-400">· {request.profile?.code}</span></p><p className="truncate text-xs text-slate-500">Branch admin: {request.managerProfile?.name || request.managerProfile?.email || 'details required'}</p><p className="text-xs text-slate-500">{request.status === 'APPROVED' ? request.managerInvitation?.status === 'accepted' ? 'Provisioned · admin activated' : 'Provisioned · admin activation pending' : request.status === 'REJECTED' ? request.reviewNote : request.status === 'CANCELLED' ? 'Cancelled' : `Submitted ${new Date(request.requestedAt).toLocaleDateString()}`}</p></div><Badge tone={request.status === 'APPROVED' ? 'green' : request.status === 'PENDING' ? 'blue' : 'gray'}>{titleCase(request.status)}</Badge>{request.status === 'PENDING' && <button onClick={() => onCancel(request)} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Cancel ${request.profile?.name} request`}><X size={15} /></button>}</div>)}</div></section>;
}

function BranchDrawer({ branch, actorRole, canWrite, canManageTeam, onClose, onEdit, onChanged }) {
  const [team, setTeam] = useState({ assigned: [], available: [], pending: [], canManageTeam: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [candidate, setCandidate] = useState('');
  const [role, setRole] = useState('staff');
  const [saving, setSaving] = useState(false);
  const [invite, setInvite] = useState({ name: '', email: '' });
  const [invitationUrl, setInvitationUrl] = useState('');

  const loadTeam = useCallback(async () => {
    setLoading(true); setError('');
    try { setTeam(await api.get(`/v2/branches/${branch.id}/members`)); }
    catch (requestError) { setError(apiMessage(requestError, 'Team assignments could not be loaded.')); }
    finally { setLoading(false); }
  }, [branch.id]);
  useEffect(() => { loadTeam(); }, [loadTeam]);

  async function assign() {
    const [principalType, principalId] = candidate.split(':');
    if (!principalId) return;
    setSaving(true); setError('');
    try { await api.post(`/v2/branches/${branch.id}/members`, { principalType, principalId, role }); setCandidate(''); await loadTeam(); await onChanged(); }
    catch (requestError) { setError(apiMessage(requestError, 'Assignment failed.')); }
    finally { setSaving(false); }
  }
  async function remove(member) {
    if (!window.confirm(`Remove ${member.name} from ${branch.name}?`)) return;
    try { await api.delete(`/v2/branches/${branch.id}/members/${member.principalType}/${member.principalId}`); await loadTeam(); await onChanged(); }
    catch (requestError) { setError(apiMessage(requestError, 'Removal failed.')); }
  }
  async function changeRole(member, nextRole) {
    setSaving(true); setError('');
    try {
      await api.post(`/v2/branches/${branch.id}/members`, { principalType: member.principalType, principalId: member.principalId, role: nextRole });
      await loadTeam(); await onChanged();
    } catch (requestError) { setError(apiMessage(requestError, 'The branch role could not be changed.')); }
    finally { setSaving(false); }
  }
  async function inviteManager(event) {
    event.preventDefault(); setSaving(true); setError(''); setInvitationUrl('');
    try {
      const response = await api.post('/v2/auth/invitations/send', { ...invite, role: 'manager', accessLevel: 'branch', branchIds: [branch.id] });
      setInvite({ name: '', email: '' });
      setInvitationUrl(response.invitation?.invitationUrl || '');
      await loadTeam(); await onChanged();
    } catch (requestError) { setError(apiMessage(requestError, 'The manager invitation could not be sent.')); }
    finally { setSaving(false); }
  }

  const allowedToManage = canManageTeam && team.canManageTeam;
  const assignableRoles = actorRole === 'owner' ? ROLES : ROLES.filter((item) => item !== 'manager');
  return <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/35 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside className="flex h-full w-full max-w-2xl flex-col bg-[#f7f8fa] shadow-2xl">
      <header className="border-b border-slate-200 bg-white p-4 sm:p-6"><div className="flex min-w-0 flex-wrap items-start gap-2 sm:gap-4"><button onClick={onClose} className="mt-0.5 shrink-0 rounded-lg p-2 hover:bg-slate-100"><ChevronLeft size={19} /></button><div className="min-w-[12rem] flex-1"><p className="text-xs font-black uppercase tracking-widest text-blue-700">{branch.code}</p><h2 className="truncate text-2xl font-black">{branch.name}</h2><p className="mt-1 text-sm text-slate-500">People assigned here inherit only this location’s operational access.</p></div>{canWrite && <button onClick={onEdit} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"><Edit3 size={15} /> Edit</button>}<button onClick={onClose} className="shrink-0 rounded-lg p-2 hover:bg-slate-100"><X size={19} /></button></div></header>
      <div className="flex-1 overflow-y-auto p-5 sm:p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><SmallMetric label="Team" value={team.assigned.length} /><SmallMetric label="Open orders" value={branch.metrics?.openOrders || 0} /><SmallMetric label="Open shifts" value={branch.metrics?.openShifts || 0} /></div>
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-black">Branch team</h3><p className="text-xs text-slate-500">Managers can coordinate workers assigned to this location.</p></div><Users size={20} className="shrink-0 text-slate-400" /></div>
          {allowedToManage && actorRole === 'owner' && !team.assigned.some((person) => person.branchRole === 'manager') && <form onSubmit={inviteManager} className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3"><div className="flex items-center gap-2"><UserCog size={16} className="text-blue-700" /><div><p className="text-xs font-black text-blue-950">Invite the accountable branch manager</p><p className="text-[11px] text-blue-700">They create their own password from a single-use invitation and receive access to this branch only.</p></div></div><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input required minLength={2} value={invite.name} onChange={(event) => setInvite({ ...invite, name: event.target.value })} placeholder="Manager name" className="h-10 rounded-lg border border-blue-200 bg-white px-3 text-sm" /><input required type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} placeholder="manager@company.com" className="h-10 rounded-lg border border-blue-200 bg-white px-3 text-sm" /><button disabled={saving} className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-black text-white disabled:opacity-50">Send invite</button></div>{invitationUrl && <div className="mt-3 rounded-lg bg-white p-2 text-xs text-blue-800"><span className="font-bold">Development invite link:</span> <a className="break-all underline" href={invitationUrl}>{invitationUrl}</a></div>}</form>}
          {allowedToManage && team.available.length > 0 && <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_130px_auto]">
            <select value={candidate} onChange={(event) => setCandidate(event.target.value)} className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">Choose team member</option>{team.available.map((person) => <option key={`${person.principalType}:${person.principalId}`} value={`${person.principalType}:${person.principalId}`}>{person.name} · {titleCase(person.baseRole)}</option>)}</select>
            <select value={role} onChange={(event) => setRole(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm">{assignableRoles.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select>
            <button onClick={assign} disabled={!candidate || saving} className="h-10 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-40">Assign</button>
          </div>}
          {allowedToManage && !loading && team.available.length === 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500"><span className="min-w-[12rem] flex-1">Everyone is already assigned here. Create another worker from Team when needed.</span><a href="/admin/staff" className="shrink-0 font-black text-blue-700">Open Team</a></div>}
          {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
          <div className="mt-4 divide-y divide-slate-100">
            {loading ? <p className="py-8 text-center text-sm text-slate-400">Loading team…</p> : team.assigned.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">No branch team assigned yet.</p> : team.assigned.map((person) => { const canManagePerson = allowedToManage && (actorRole === 'owner' || person.branchRole !== 'manager'); return <div key={person.id} className="flex min-w-0 flex-wrap items-center gap-3 py-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-100 text-xs font-black text-blue-700">{initials(person.name)}</div><div className="min-w-[10rem] flex-1"><p className="truncate text-sm font-bold">{person.name}</p><p className="truncate text-xs text-slate-400">{person.email}</p></div>{canManagePerson ? <select aria-label={`Role for ${person.name}`} disabled={saving} value={person.branchRole} onChange={(event) => changeRole(person, event.target.value)} className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold capitalize">{assignableRoles.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select> : <Badge tone={person.branchRole === 'manager' ? 'blue' : 'gray'}>{titleCase(person.branchRole)}</Badge>}{canManagePerson && <button onClick={() => remove(person)} className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${person.name}`}><X size={16} /></button>}</div>; })}
          </div>
          {team.pending?.length > 0 && <div className="mt-4 border-t border-slate-100 pt-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Pending invitations</p>{team.pending.map((person) => <div key={person.id} className="mt-2 flex items-center gap-3 rounded-xl bg-amber-50 p-3"><div className="grid h-8 w-8 place-items-center rounded-full bg-amber-100 text-amber-700"><Mail size={14} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{person.name || person.email}</p><p className="truncate text-xs text-amber-700">{person.email} · expires {new Date(person.expiresAt).toLocaleDateString()}</p></div><Badge tone="gray">Pending {titleCase(person.role)}</Badge></div>)}</div>}
        </section>
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black">Location profile</h3><div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><Info icon={MapPin}>{[branch.address, branch.city, branch.state, branch.postalCode].filter(Boolean).join(', ') || 'Not configured'}</Info><Info icon={Phone}>{branch.phone || 'Not configured'}</Info><Info icon={Mail}>{branch.email || 'Not configured'}</Info><Info icon={Clock3}>{branch.timezone}</Info></div></section>
      </div>
    </aside>
  </div>;
}

function BranchForm({ branch, requestMode, restricted = false, onClose, onSaved }) {
  const [form, setForm] = useState({ code: branch?.code || '', name: branch?.name || '', address: branch?.address || '', city: branch?.city || '', state: branch?.state || '', postalCode: branch?.postalCode || '', country: branch?.country || 'PK', phone: branch?.phone || '', email: branch?.email || '', timezone: branch?.timezone || 'Asia/Karachi', orderPrefix: branch?.orderPrefix || '', closeoutHour: branch?.closeoutHour || '04:00', openedAt: branch?.openedAt ? String(branch.openedAt).slice(0, 10) : '', notes: branch?.notes || '', reason: '', businessHours: branch?.businessHours || EMPTY_HOURS, isActive: branch?.isActive ?? true, taxPercent: branch?.taxPercent ?? '', taxMode: branch?.taxMode || '', serviceChargePercent: branch?.serviceChargePercent ?? '', serviceFeeFixed: branch?.serviceFeeFixed ?? '', receiptFooter: branch?.receiptFooter || '', manager: { name: '', email: '', phone: '', jobTitle: 'Branch administrator' } });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const setManager = (field, value) => setForm((current) => ({ ...current, manager: { ...current.manager, [field]: value } }));
  const setHours = (day, field, value) => setForm((current) => ({ ...current, businessHours: { ...current.businessHours, [day]: { ...current.businessHours[day], [field]: value } } }));
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    const managerFields = ['address', 'city', 'state', 'postalCode', 'country', 'phone', 'email', 'timezone', 'orderPrefix', 'closeoutHour', 'businessHours', 'taxPercent', 'taxMode', 'serviceChargePercent', 'serviceFeeFixed', 'receiptFooter', 'notes'];
    const payload = restricted
      ? Object.fromEntries(managerFields.map((field) => [field, form[field]]))
      : form;
    try { branch ? await api.put(`/v2/branches/${branch.id}`, payload) : await api.post('/v2/branches/requests', payload); await onSaved(); }
    catch (requestError) { setError(apiMessage(requestError, 'The location could not be saved.')); }
    finally { setSaving(false); }
  }
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/45 p-3 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form onSubmit={submit} className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
    <header className="sticky top-0 z-10 flex min-w-0 items-start justify-between gap-3 border-b border-slate-200 bg-white/95 p-4 backdrop-blur sm:p-5"><div className="min-w-0 flex-1"><p className="text-xs font-black uppercase tracking-widest text-blue-700">{requestMode ? 'Platform approval' : restricted ? 'Branch administration' : 'Location setup'}</p><h2 className="text-xl font-black">{restricted ? 'Branch settings' : branch ? 'Edit branch profile' : 'Request a restaurant branch'}</h2>{requestMode && <p className="mt-1 text-xs text-slate-500">Your platform administrator will review the location and subscription capacity before provisioning it.</p>}{restricted && <p className="mt-1 text-xs text-slate-500">Changes apply only to {branch?.name}. The chain owner can review and override these settings.</p>}</div><button type="button" onClick={onClose} className="shrink-0 rounded-lg p-2 hover:bg-slate-100"><X size={19} /></button></header>
    <div className="space-y-6 p-5 sm:p-6">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
      {restricted ? <FormSection title="Owner-controlled identity" subtitle="Branch code, name, opening date, and status can only be changed by the restaurant owner."><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Branch code</p><p className="mt-1 text-sm font-black">{form.code}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Location name</p><p className="mt-1 text-sm font-black">{form.name}</p></div></div></FormSection> : <FormSection title="Identity" subtitle="Use a short immutable code that staff can recognize."><div className="grid gap-4 sm:grid-cols-[150px_1fr]"><Field label="Branch code" required><input required maxLength={12} disabled={branch?.isPrimary} value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} /></Field><Field label="Location name" required><input required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Gulberg Main" /></Field></div></FormSection>}
      <FormSection title="Address & contact" subtitle="Shown to operations teams and used on location records."><div className="grid gap-4 sm:grid-cols-2"><Field label="Street address" wide><input value={form.address} onChange={(e) => set('address', e.target.value)} /></Field><Field label="City"><input value={form.city} onChange={(e) => set('city', e.target.value)} /></Field><Field label="State / region"><input value={form.state} onChange={(e) => set('state', e.target.value)} /></Field><Field label="Postal code"><input value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} /></Field><Field label="Country code"><input maxLength={2} value={form.country} onChange={(e) => set('country', e.target.value.toUpperCase())} /></Field><Field label="Phone"><input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field><Field label="Branch email"><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field></div></FormSection>
      <FormSection title="Operating controls" subtitle="Location-specific timezone, order numbering, and business-day close."><div className="grid gap-4 sm:grid-cols-3"><Field label="Timezone"><select value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>{TIMEZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></Field><Field label="Order prefix"><input maxLength={8} value={form.orderPrefix} onChange={(e) => set('orderPrefix', e.target.value.toUpperCase())} placeholder="GUL" /></Field><Field label="Business day closes"><input type="time" value={form.closeoutHour} onChange={(e) => set('closeoutHour', e.target.value)} /></Field>{!restricted && <Field label="Opening date"><input type="date" value={form.openedAt} onChange={(e) => set('openedAt', e.target.value)} /></Field>}{!restricted && branch && !branch.isPrimary && <Field label="Status"><select value={String(form.isActive)} onChange={(e) => set('isActive', e.target.value === 'true')}><option value="true">Operating</option><option value="false">Inactive</option></select></Field>}</div></FormSection>
      <FormSection title="Financial profile" subtitle={restricted ? 'Set branch-level values or leave them blank to inherit chain defaults. The chain owner retains full control.' : 'Leave values blank to inherit the restaurant chain defaults.'}><div className="grid gap-4 sm:grid-cols-3"><Field label="Tax percent"><input type="number" min="0" max="100" step="0.01" value={form.taxPercent} onChange={(e) => set('taxPercent', e.target.value)} placeholder="Inherit" /></Field><Field label="Tax mode"><select value={form.taxMode} onChange={(e) => set('taxMode', e.target.value)}><option value="">Inherit chain default</option><option value="EXCLUSIVE">Exclusive</option><option value="INCLUSIVE">Inclusive</option></select></Field><Field label="Service charge %"><input type="number" min="0" max="100" step="0.01" value={form.serviceChargePercent} onChange={(e) => set('serviceChargePercent', e.target.value)} placeholder="Inherit" /></Field><Field label="Fixed service fee"><input type="number" min="0" step="0.01" value={form.serviceFeeFixed} onChange={(e) => set('serviceFeeFixed', e.target.value)} placeholder="Inherit" /></Field><Field label="Receipt footer" wide><input value={form.receiptFooter} onChange={(e) => set('receiptFooter', e.target.value)} placeholder="Inherit chain receipt footer" /></Field></div></FormSection>
      <FormSection title="Weekly hours" subtitle="These hours help teams understand when this location operates."><div className="space-y-2">{DAYS.map((day) => <div key={day} className="grid grid-cols-2 items-center gap-2 rounded-xl bg-slate-50 p-2.5 sm:grid-cols-[96px_1fr_1fr_auto]"><span className="col-span-2 text-xs font-bold sm:col-span-1">{titleCase(day)}</span><input aria-label={`${day} opening time`} type="time" disabled={form.businessHours[day]?.closed} value={form.businessHours[day]?.open || '09:00'} onChange={(e) => setHours(day, 'open', e.target.value)} className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs disabled:opacity-40" /><input aria-label={`${day} closing time`} type="time" disabled={form.businessHours[day]?.closed} value={form.businessHours[day]?.close || '22:00'} onChange={(e) => setHours(day, 'close', e.target.value)} className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs disabled:opacity-40" /><label className="col-span-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500 sm:col-span-1"><input type="checkbox" checked={form.businessHours[day]?.closed || false} onChange={(e) => setHours(day, 'closed', e.target.checked)} /> Closed</label></div>)}</div></FormSection>
      <FormSection title="Internal notes"><Field label="Notes"><textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Parking, delivery entrance, escalation contacts…" /></Field></FormSection>
      {requestMode && <FormSection title="Accountable branch administrator" subtitle="Approval sends this person a single-use link. They choose their own password and receive access to this location only."><div className="grid gap-4 sm:grid-cols-2"><Field label="Full name" required><input required minLength={2} value={form.manager.name} onChange={(e) => setManager('name', e.target.value)} placeholder="Ayesha Khan" /></Field><Field label="Gmail or work email" required><input required type="email" value={form.manager.email} onChange={(e) => setManager('email', e.target.value)} placeholder="manager@company.com" /></Field><Field label="Phone"><input type="tel" value={form.manager.phone} onChange={(e) => setManager('phone', e.target.value)} /></Field><Field label="Job title"><input value={form.manager.jobTitle} onChange={(e) => setManager('jobTitle', e.target.value)} /></Field></div></FormSection>}
      {requestMode && <FormSection title="Business justification" subtitle="This is included in the platform administrator's approval record."><Field label="Why is this location required?" required><textarea required minLength={10} rows={3} value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="New operating location, expected opening date, and required capacity…" /></Field></FormSection>}
    </div>
    <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white/95 p-4 backdrop-blur"><button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={saving} className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : branch ? 'Save changes' : 'Submit for approval'}</button></footer>
  </form></div>;
}

function FormSection({ title, subtitle, children }) { return <section><div className="mb-3"><h3 className="text-sm font-black">{title}</h3>{subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}</div>{children}</section>; }
function Field({ label, required, wide, children }) { return <label className={wide ? 'sm:col-span-2' : ''}><span className="mb-1.5 block text-xs font-bold text-slate-600">{label}{required && ' *'}</span><div className="[&_input]:h-10 [&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-slate-200 [&_input]:px-3 [&_input]:text-sm [&_input]:outline-none [&_input]:focus:border-blue-500 [&_select]:h-10 [&_select]:w-full [&_select]:rounded-xl [&_select]:border [&_select]:border-slate-200 [&_select]:bg-white [&_select]:px-3 [&_select]:text-sm [&_textarea]:w-full [&_textarea]:rounded-xl [&_textarea]:border [&_textarea]:border-slate-200 [&_textarea]:p-3 [&_textarea]:text-sm">{children}</div></label>; }
