'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, CheckCircle2, Clock3, Copy, Mail, MapPin, RefreshCw, Store, UserCog, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import saApi from '@/lib/saApi';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL'];
const title = (value) => String(value || '').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function BranchRequestsPage() {
  const [status, setStatus] = useState('PENDING');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [provisioned, setProvisioned] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await saApi.getBranchRequests(status); setRequests(data.requests || []); }
    catch (requestError) { setError(requestError.message || 'Location requests could not be loaded.'); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  async function decide(event) {
    event.preventDefault();
    if (!action || note.trim().length < 5) return;
    setSaving(true);
    try {
      if (action.type === 'approve') {
        const result = await saApi.approveBranchRequest(action.request.id, { reviewNote: note.trim() });
        setProvisioned(result);
      } else await saApi.rejectBranchRequest(action.request.id, { reviewNote: note.trim() });
      toast.success(action.type === 'approve' ? 'Location provisioned' : 'Location request rejected');
      setAction(null); setNote(''); await load();
    } catch (requestError) { toast.error(requestError.message || 'The decision could not be saved.'); }
    finally { setSaving(false); }
  }

  async function resend(request) {
    setSaving(true);
    try {
      const result = await saApi.resendBranchManagerInvitation(request.id, { reason: 'Activation link reissued by platform administrator' });
      setProvisioned({ ...result, branch: request.provisionedBranch });
      toast.success('Activation link reissued');
      await load();
    } catch (requestError) { toast.error(requestError.message || 'The activation link could not be reissued.'); }
    finally { setSaving(false); }
  }

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-400">Tenant provisioning</p><h1 className="mt-1 text-2xl font-black">Location requests</h1><p className="mt-1 max-w-2xl text-sm text-sa-500">Review owner requests, confirm subscription capacity, and provision branches into the correct restaurant tenant.</p></div><button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-sa-700 px-4 py-2 text-sm font-bold hover:bg-sa-800 disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh</button></div>

    <div className="flex flex-wrap gap-2 rounded-2xl border border-sa-800 bg-sa-900 p-2">{STATUSES.map((item) => <button key={item} onClick={() => setStatus(item)} className={`rounded-xl px-4 py-2 text-xs font-black ${status === item ? 'bg-orange-500 text-white' : 'text-sa-400 hover:bg-sa-800 hover:text-white'}`}>{title(item)}</button>)}</div>
    {error && <div className="rounded-xl border border-red-800 bg-red-500/10 p-4 text-sm font-bold text-red-300">{error}</div>}

    <div className="grid gap-4 xl:grid-cols-2">{loading ? [1, 2, 3, 4].map((item) => <div key={item} className="h-64 animate-pulse rounded-2xl border border-sa-800 bg-sa-900" />) : requests.map((request) => {
      const profile = request.profile || {};
      const manager = request.managerProfile || {};
      return <article key={request.id} className="rounded-2xl border border-sa-800 bg-sa-900 p-5 shadow-xl shadow-black/10"><div className="flex items-start gap-4"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-orange-500/10 text-orange-400"><Store size={21} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-black">{profile.name}</h2><Status value={request.status} /></div><p className="mt-1 text-xs font-bold uppercase tracking-widest text-sa-500">{profile.code} · {profile.timezone}</p></div></div>
        <div className="mt-5 grid gap-3 rounded-xl bg-sa-950 p-4 text-sm sm:grid-cols-2"><Info icon={Building2}><Link href={`/superadmin/restaurants/${request.restaurant.id}`} className="font-bold text-blue-400 hover:text-blue-300">{request.restaurant.name}</Link><span className="block text-xs text-sa-600">{request.restaurant.restaurantCode}</span></Info><Info icon={MapPin}>{[profile.address, profile.city, profile.state].filter(Boolean).join(', ') || 'Address not supplied'}</Info><Info icon={Clock3}>Requested {new Date(request.requestedAt).toLocaleString()}</Info><Info icon={Building2}>{request.restaurant.subscription?.plan?.name || 'No plan'} · {request.restaurant.subscription?.status || 'No subscription'}<span className={`block text-xs ${request.locationCapacity?.eligible ? 'text-emerald-500' : 'text-red-400'}`}>{request.locationCapacity?.current ?? '—'} active + {request.locationCapacity?.pending ?? '—'} pending / {request.locationCapacity?.limit ?? 'unlimited'} · {request.locationCapacity?.eligible ? 'eligible' : 'not eligible'}</span></Info><Info icon={UserCog}><span className="font-bold text-sa-200">{manager.name || 'Manager details required'}</span><span className="block text-xs text-sa-500">{manager.jobTitle || 'Branch administrator'}</span></Info><Info icon={Mail}>{manager.email || 'Email not supplied'}{manager.phone && <span className="block text-xs text-sa-500">{manager.phone}</span>}</Info></div>
        <div className="mt-4"><p className="text-xs font-black uppercase tracking-wider text-sa-500">Owner justification</p><p className="mt-1 text-sm text-sa-300">{request.reason || 'No reason supplied'}</p><p className="mt-2 text-xs text-sa-500">Requested by {request.requester?.name || request.requester?.email || 'restaurant owner'}</p></div>
        {request.reviewNote && <div className="mt-4 rounded-xl border border-sa-800 p-3 text-sm text-sa-400"><span className="font-bold text-sa-300">Review record:</span> {request.reviewNote}</div>}
        {request.status === 'APPROVED' && request.managerInvitation && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sa-800 p-3"><div><p className="text-xs font-black text-sa-200">Branch admin activation</p><p className="text-xs text-sa-500">{request.managerInvitation.status === 'accepted' ? `Activated ${new Date(request.managerInvitation.acceptedAt).toLocaleString()}` : `Pending for ${request.managerInvitation.email} · expires ${new Date(request.managerInvitation.expiresAt).toLocaleDateString()}`}</p></div>{request.managerInvitation.status !== 'accepted' && <button disabled={saving} onClick={() => resend(request)} className="rounded-lg border border-sa-700 px-3 py-2 text-xs font-black text-orange-300 hover:bg-sa-800 disabled:opacity-50">Resend activation</button>}</div>}
        {request.status === 'PENDING' && <div className="mt-5 flex justify-end gap-2 border-t border-sa-800 pt-4"><button onClick={() => { setAction({ type: 'reject', request }); setNote(''); }} className="inline-flex items-center gap-2 rounded-xl border border-red-900 px-4 py-2 text-sm font-black text-red-400 hover:bg-red-500/10"><XCircle size={16} /> Reject</button><button onClick={() => { setAction({ type: 'approve', request }); setNote(''); }} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-black text-sa-950 hover:bg-brand-400"><CheckCircle2 size={16} /> Approve, provision & invite</button></div>}
      </article>;
    })}</div>
    {!loading && !requests.length && <div className="rounded-2xl border border-dashed border-sa-700 py-16 text-center"><CheckCircle2 size={32} className="mx-auto text-sa-600" /><h2 className="mt-3 font-black">No {status === 'ALL' ? '' : title(status).toLowerCase()} location requests</h2><p className="mt-1 text-sm text-sa-500">The queue is clear.</p></div>}

    {action && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4"><form onSubmit={decide} className="w-full max-w-lg rounded-2xl border border-sa-700 bg-sa-900 p-6 shadow-2xl"><p className="text-xs font-black uppercase tracking-widest text-orange-400">Recorded platform decision</p><h2 className="mt-1 text-xl font-black">{action.type === 'approve' ? 'Approve and provision' : 'Reject'} {action.request.profile?.name}</h2><p className="mt-2 text-sm text-sa-500">{action.type === 'approve' ? `This revalidates the subscription, creates the isolated location, and sends ${action.request.managerProfile?.email || 'the branch administrator'} a single-use activation link. No reusable password is exposed.` : 'The owner will see this reason in their request history.'}</p><label className="mt-5 block text-xs font-bold text-sa-400">Decision note<textarea autoFocus required minLength={5} rows={4} value={note} onChange={(event) => setNote(event.target.value)} className="mt-2 w-full rounded-xl border border-sa-700 bg-sa-950 p-3 text-sm text-white outline-none focus:border-orange-500" placeholder={action.type === 'approve' ? 'Capacity and manager details verified; approved for opening…' : 'Reason and next steps for the restaurant owner…'} /></label><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setAction(null)} className="rounded-xl border border-sa-700 px-4 py-2 text-sm font-bold">Cancel</button><button disabled={saving || note.trim().length < 5} className={`rounded-xl px-4 py-2 text-sm font-black text-white disabled:opacity-50 ${action.type === 'approve' ? 'bg-orange-500' : 'bg-red-600'}`}>{saving ? 'Saving…' : action.type === 'approve' ? 'Approve, provision & invite' : 'Reject request'}</button></div></form></div>}
    {provisioned && <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4"><div className="w-full max-w-lg rounded-2xl border border-sa-700 bg-sa-900 p-6 shadow-2xl"><div className="grid h-11 w-11 place-items-center rounded-full bg-emerald-500/10 text-emerald-400"><CheckCircle2 size={22} /></div><h2 className="mt-4 text-xl font-black">{provisioned.branch?.name || 'Location'} is provisioned</h2><p className="mt-2 text-sm text-sa-400">The branch administrator invitation for <span className="font-bold text-white">{provisioned.managerAccess?.email}</span> is {provisioned.managerAccess?.emailDelivery === 'failed' ? 'waiting to be resent' : 'ready'}. They create their own password during activation.</p>{provisioned.managerAccess?.invitationUrl && <div className="mt-4 rounded-xl border border-orange-900/60 bg-orange-500/10 p-3"><p className="text-xs font-black uppercase tracking-wider text-orange-300">Development activation link</p><p className="mt-2 break-all text-xs text-sa-300">{provisioned.managerAccess.invitationUrl}</p><button onClick={() => navigator.clipboard?.writeText(provisioned.managerAccess.invitationUrl)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-orange-900 px-3 py-2 text-xs font-black text-orange-300"><Copy size={14} /> Copy link</button></div>}<button onClick={() => setProvisioned(null)} className="mt-5 w-full rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-black text-sa-950">Done</button></div></div>}
  </div>;
}

function Info({ icon: Icon, children }) { return <div className="flex items-start gap-2 text-sa-400"><Icon size={15} className="mt-0.5 shrink-0 text-sa-600" /><div>{children}</div></div>; }
function Status({ value }) { const color = value === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-400' : value === 'PENDING' ? 'bg-amber-500/10 text-amber-300' : value === 'REJECTED' ? 'bg-red-500/10 text-red-400' : 'bg-sa-800 text-sa-400'; return <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider ${color}`}>{value}</span>; }
