'use client';
import { useInputDialog } from '@/components/ui/InputDialog';
import { LoadingScreen } from '@/components/ui/Loading';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';

/**
 * DELIVERY — the restaurant's side of the road.
 *
 * Two questions this screen answers, in this order:
 *
 *   1. Which orders are out, with whom, and how long have they been out?
 *   2. Who is on shift and how loaded are they?
 *
 * The second exists to serve the first. An operator standing at a counter is
 * deciding who to hand the next bag to, so a rider's current load is on the
 * card rather than behind a click.
 */

const STATUS = {
  ASSIGNED: { label: 'Assigned', tone: 'text-amber-700', bg: 'bg-amber-50 ring-amber-200' },
  ACCEPTED: { label: 'Accepted', tone: 'text-blue-700', bg: 'bg-blue-50 ring-blue-200' },
  PICKED_UP: { label: 'On the way', tone: 'text-violet-700', bg: 'bg-violet-50 ring-violet-200' },
  DELIVERED: { label: 'Delivered', tone: 'text-emerald-700', bg: 'bg-emerald-50 ring-emerald-200' },
  FAILED: { label: 'Failed', tone: 'text-rose-700', bg: 'bg-rose-50 ring-rose-200' },
  CANCELLED: { label: 'Cancelled', tone: 'text-slate-600', bg: 'bg-slate-100 ring-slate-200' },
};

const OPEN = ['ASSIGNED', 'ACCEPTED', 'PICKED_UP'];
const money = (value) => `Rs. ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/** How long an order has been with a rider — the number an operator watches. */
const elapsed = (since) => {
  if (!since) return '';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export default function DeliveryPage() {
  // window.prompt() throws inside the Electron till, so a browser prompt is a
  // control that silently does nothing on the device staff actually use.
  const [inputDialog, askForInput] = useInputDialog();
  const { can } = useAdminAccess();
  const canAssign = can('delivery.assign');
  const canManageRiders = can('delivery.riders.write');

  const [tab, setTab] = useState('active');
  const [assignments, setAssignments] = useState([]);
  const [riders, setRiders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [assigning, setAssigning] = useState(null);
  const [showAddRider, setShowAddRider] = useState(false);
  const [restaurantId, setRestaurantId] = useState(null);
  const { on, off } = useSocket({ restaurantId });
  const [newRider, setNewRider] = useState({ name: '', email: '', password: '', phone: '', vehicleType: '', vehicleNumber: '' });

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [assignmentsResult, ridersResult] = await Promise.all([
        api.getDeliveryAssignments('?limit=200'),
        api.getRiders(),
      ]);
      setAssignments(assignmentsResult.assignments || []);
      setRiders(ridersResult.riders || []);
      const tenant = (ridersResult.riders || [])[0]?.restaurantId
        || (assignmentsResult.assignments || [])[0]?.restaurantId;
      if (tenant) setRestaurantId(tenant);
    } catch (error) {
      toast.error(error.message || 'Could not load deliveries.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Live first, polling as the floor. Two people at a counter must not be able
   * to hand the same order to two riders because one screen was 20 seconds
   * stale, and a dropped socket must not leave the board frozen either.
   */
  useEffect(() => {
    const timer = setInterval(() => load({ quiet: true }), 25000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!restaurantId) return undefined;
    const handler = () => load({ quiet: true });
    on('delivery-updated', handler);
    return () => off('delivery-updated', handler);
  }, [restaurantId, on, off, load]);

  const open = useMemo(() => assignments.filter((row) => OPEN.includes(row.status)), [assignments]);
  const closed = useMemo(() => assignments.filter((row) => !OPEN.includes(row.status)), [assignments]);
  const onShift = useMemo(() => riders.filter((rider) => rider.isActive && rider.isAvailable), [riders]);

  const assign = async (assignment, riderId) => {
    setBusy(assignment.id);
    try {
      await api.assignRider({ orderId: assignment.order.id, riderId });
      toast.success('Rider changed.');
      setAssigning(null);
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.message || 'Could not assign that rider.');
    } finally {
      setBusy('');
    }
  };

  const close = async (assignment, action) => {
    const cancelling = action === 'cancel';
    const answer = await askForInput({
      title: cancelling ? 'Cancel this delivery' : 'Mark this delivery failed',
      description: cancelling
        ? 'The rider is released and the customer is no longer expecting it.'
        : 'Record what went wrong so the order can be put right.',
      confirmLabel: cancelling ? 'Cancel delivery' : 'Mark failed',
      destructive: true,
      fields: [{
        name: 'reason',
        label: cancelling ? 'Why is it being cancelled?' : 'What went wrong?',
        required: true,
      }],
    });
    if (!answer) return;
    const { reason } = answer;
    setBusy(assignment.id);
    try {
      if (action === 'cancel') await api.cancelDelivery(assignment.id, reason);
      else await api.failDelivery(assignment.id, reason);
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.message || 'Could not update that delivery.');
    } finally {
      setBusy('');
    }
  };

  const addRider = async () => {
    setBusy('new-rider');
    try {
      await api.createRider(newRider);
      toast.success(`${newRider.name} can now sign in at /rider`);
      setShowAddRider(false);
      setNewRider({ name: '', email: '', password: '', phone: '', vehicleType: '', vehicleNumber: '' });
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.message || 'Could not add that rider.');
    } finally {
      setBusy('');
    }
  };

  const toggleAvailability = async (rider) => {
    setBusy(rider.id);
    try {
      await api.updateRider(rider.id, { isAvailable: !rider.isAvailable });
      await load({ quiet: true });
    } catch (error) {
      toast.error(error.message || 'Could not change that rider.');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return <LoadingScreen title="Loading deliveries" detail="Riders on the road and drops waiting to be assigned." />;
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 pb-10">
    {inputDialog}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Delivery</h1>
          <p className="mt-1 text-sm text-slate-500">
            {open.length} on the road · {onShift.length} rider{onShift.length === 1 ? '' : 's'} on shift
          </p>
        </div>
        {canManageRiders ? (
          <button
            type="button"
            onClick={() => setShowAddRider(true)}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white"
          >
            + Add rider
          </button>
        ) : null}
      </div>

      <div className="flex w-fit gap-1 rounded-xl bg-slate-100 p-1">
        {[
          { id: 'active', label: `On the road (${open.length})` },
          { id: 'history', label: 'Finished' },
          { id: 'riders', label: `Riders (${riders.length})` },
        ].map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${tab === entry.id ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab !== 'riders' ? (
        <div className="space-y-3">
          {(tab === 'active' ? open : closed).length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              {tab === 'active' ? 'Nothing is out for delivery right now.' : 'No finished deliveries yet.'}
            </div>
          ) : (tab === 'active' ? open : closed).map((assignment) => {
            const state = STATUS[assignment.status] || STATUS.ASSIGNED;
            const order = assignment.order || {};
            return (
              <article key={assignment.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ring-1 ${state.bg} ${state.tone}`}>
                        {state.label}
                      </span>
                      <span className="text-sm font-bold text-slate-900">{order.orderNumber}</span>
                      {OPEN.includes(assignment.status) ? (
                        <span className="text-xs text-slate-400">{elapsed(assignment.assignedAt)} out</span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{order.customerAddress || 'No address'}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {order.customerName || 'Customer'}
                      {order.customerPhone ? ` · ${order.customerPhone}` : ''}
                      {order.branch?.name ? ` · ${order.branch.name}` : ''}
                    </p>
                  </div>

                  <div className="text-right">
                    <div className="text-sm font-bold text-slate-900">{assignment.rider?.id ? (riders.find((r) => r.id === assignment.rider.id)?.name || 'Rider') : 'Unassigned'}</div>
                    <div className="text-xs text-slate-500">
                      {Number(assignment.cashToCollect) > 0 ? `${money(assignment.cashToCollect)} to collect` : 'Prepaid'}
                    </div>
                    {assignment.reassignCount > 0 ? (
                      <div className="mt-0.5 text-[11px] text-amber-600">Reassigned {assignment.reassignCount}×</div>
                    ) : null}
                  </div>
                </div>

                {assignment.failureReason ? (
                  <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{assignment.failureReason}</p>
                ) : null}

                {canAssign && OPEN.includes(assignment.status) ? (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    {assigning === assignment.id ? (
                      <select
                        autoFocus
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        defaultValue=""
                        onChange={(event) => event.target.value && assign(assignment, event.target.value)}
                      >
                        <option value="">Move to…</option>
                        {onShift.filter((rider) => rider.id !== assignment.riderId).map((rider) => (
                          <option key={rider.id} value={rider.id}>
                            {rider.name} — {rider.activeDeliveries} out
                          </option>
                        ))}
                      </select>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === assignment.id}
                        onClick={() => setAssigning(assignment.id)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
                      >
                        Change rider
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy === assignment.id}
                      onClick={() => close(assignment, 'fail')}
                      className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700"
                    >
                      Mark failed
                    </button>
                    <button
                      type="button"
                      disabled={busy === assignment.id}
                      onClick={() => close(assignment, 'cancel')}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {riders.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 sm:col-span-2">
              No riders yet. Add one and they can sign in at <strong>/rider</strong> on their phone.
            </div>
          ) : riders.map((rider) => (
            <div key={rider.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-slate-900">{rider.name}</div>
                  <div className="text-xs text-slate-500">
                    {rider.phone || 'No phone'}
                    {rider.vehicleType ? ` · ${rider.vehicleType}` : ''}
                    {rider.vehicleNumber ? ` ${rider.vehicleNumber}` : ''}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{rider.branchName || 'No branch'}</div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${rider.isAvailable ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
                  {rider.isActive ? (rider.isAvailable ? 'On shift' : 'Off shift') : 'Inactive'}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span><strong className="text-slate-900">{rider.activeDeliveries}</strong> out now · {rider.lifetimeDeliveries} all time</span>
                {canManageRiders ? (
                  <button
                    type="button"
                    disabled={busy === rider.id}
                    onClick={() => toggleAvailability(rider)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 font-bold text-slate-700"
                  >
                    {rider.isAvailable ? 'Send off shift' : 'Put on shift'}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddRider && canManageRiders ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <h2 className="text-lg font-black text-slate-900">Add a rider</h2>
            <p className="mt-1 text-sm text-slate-500">
              They sign in at <strong>/rider</strong> with this email and password, on their own phone.
            </p>

            <div className="mt-4 space-y-3">
              {[
                ['name', 'Name', 'Imran Ali'],
                ['email', 'Sign-in email', 'imran@riders.example'],
                ['password', 'Password (at least 8 characters)', ''],
                ['phone', 'Phone', '0300 1234567'],
                ['vehicleType', 'Vehicle', 'Bike'],
                ['vehicleNumber', 'Registration', 'LEA-1234'],
              ].map(([field, label, placeholder]) => (
                <label key={field} className="block text-xs font-bold text-slate-600">
                  {label}
                  <input
                    type={field === 'password' ? 'password' : 'text'}
                    value={newRider[field]}
                    placeholder={placeholder}
                    onChange={(event) => setNewRider({ ...newRider, [field]: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900"
                  />
                </label>
              ))}
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setShowAddRider(false)}
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy === 'new-rider' || !newRider.name || !newRider.email || newRider.password.length < 8}
                onClick={addRider}
                className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy === 'new-rider' ? 'Adding…' : 'Add rider'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
