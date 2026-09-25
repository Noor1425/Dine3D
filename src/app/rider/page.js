'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';

/**
 * THE RIDER PORTAL
 *
 * This runs on a phone, outdoors, on mobile data, held in one hand with a bag
 * of food in the other. Everything below follows from that:
 *
 *   - One screen. The rider's open deliveries, largest thing first.
 *   - One obvious action per card, sized for a thumb, never two side by side
 *     where a wrong tap closes a delivery that never happened.
 *   - Address and phone are tappable — maps and calling are the two things a
 *     rider actually needs from a phone.
 *   - Cash owed is stated in words on the card, because getting that wrong
 *     costs the rider their own money.
 *
 * It deliberately shares nothing with the admin shell: no sidebar, no branch
 * switcher, no restaurant data. A rider's account can reach their own
 * deliveries and nothing else, and the screen matches the permission.
 */

const STATUS = {
  ASSIGNED: { label: 'New', tone: '#b45309', bg: '#fffbeb', action: 'Accept', next: 'accept' },
  ACCEPTED: { label: 'Accepted', tone: '#1d4ed8', bg: '#eff6ff', action: 'Picked up', next: 'pickup' },
  PICKED_UP: { label: 'On the way', tone: '#7c3aed', bg: '#f5f3ff', action: 'Delivered', next: 'deliver' },
  DELIVERED: { label: 'Delivered', tone: '#047857', bg: '#ecfdf5' },
  FAILED: { label: 'Failed', tone: '#b91c1c', bg: '#fef2f2' },
  CANCELLED: { label: 'Cancelled', tone: '#64748b', bg: '#f8fafc' },
};

/**
 * Make the phone noticeable. A vibration works in a pocket where a sound does
 * not, and a system notification survives the screen being off — but only if
 * the rider has granted it, which is asked for once and never nagged.
 */
function announce() {
  try { navigator.vibrate?.([220, 90, 220]); } catch { /* not every phone has it */ }
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const alert = new Notification('New delivery', { body: 'A new order has been assigned to you.', tag: 'dine3d-delivery' });
    setTimeout(() => alert.close(), 8000);
  } catch { /* notifications are a convenience, never a requirement */ }
}

const money = (value, currency = 'Rs.') =>
  `${currency} ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function RiderPortalPage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirming, setConfirming] = useState(null);
  const [proofCode, setProofCode] = useState('');
  const [cash, setCash] = useState('');
  const pollRef = useRef(null);
  const [restaurantId, setRestaurantId] = useState(null);
  const { on, off } = useSocket({ restaurantId });

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const payload = await api.getMyDeliveries();
      setData(payload);
      setError('');
      // Used only to open the socket room; the room itself is derived on the
      // server from the signed-in account, never from anything sent here.
      if (payload?.rider?.restaurantId) setRestaurantId(payload.rider.restaurantId);
    } catch (loadError) {
      if (loadError.status === 401) return router.replace('/admin/login?next=/rider');
      if (loadError.code === 'NOT_A_RIDER') {
        setError('This account is not set up as a delivery rider. Ask your manager to add you.');
      } else {
        setError(loadError.message || 'Could not load your deliveries.');
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  /**
   * New work arrives on its own, three ways, deliberately layered.
   *
   * The socket is instant and is what a rider actually experiences. Polling
   * stays as the floor, because a phone that has just come out of a tunnel or
   * off a dead battery may have missed the event entirely — and a delivery
   * nobody knows about is the one failure this screen cannot have. Refocus
   * covers the common case of the screen being woken in a pocket.
   */
  useEffect(() => {
    pollRef.current = setInterval(() => load({ quiet: true }), 20000);
    const onFocus = () => load({ quiet: true });
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(pollRef.current); window.removeEventListener('focus', onFocus); };
  }, [load]);

  useEffect(() => {
    if (!restaurantId) return undefined;
    const handler = (payload) => {
      load({ quiet: true });
      // A rider is holding a bag, not watching a screen. A new assignment has
      // to make the phone do something.
      if (payload?.type === 'assigned' || payload?.type === 'reassigned') announce();
    };
    on('delivery-updated', handler);
    return () => off('delivery-updated', handler);
  }, [restaurantId, on, off, load]);

  const act = async (assignment, action) => {
    setBusy(assignment.id);
    setError('');
    try {
      if (action === 'accept') await api.acceptDelivery(assignment.id);
      if (action === 'pickup') await api.pickUpDelivery(assignment.id);
      await load({ quiet: true });
    } catch (actionError) {
      setError(actionError.message || 'That did not go through.');
    } finally {
      setBusy('');
    }
  };

  const complete = async () => {
    setBusy(confirming.id);
    setError('');
    try {
      await api.completeDelivery(confirming.id, {
        proofCode: proofCode.trim(),
        ...(Number(confirming.cashToCollect) > 0 ? { cashCollected: Number(cash || confirming.cashToCollect) } : {}),
      });
      setConfirming(null);
      setProofCode('');
      setCash('');
      await load({ quiet: true });
    } catch (completeError) {
      setError(completeError.message || 'That did not go through.');
    } finally {
      setBusy('');
    }
  };

  const toggleShift = async () => {
    setBusy('shift');
    setError('');
    // Browsers only grant this from a real tap. Going on shift is the one
    // deliberate action a rider takes at the start of a run, so it is the
    // honest moment to ask — once, and never again if they decline.
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch { /* not every browser supports it */ }
    try {
      await api.setRiderAvailability(!data.rider.isAvailable);
      await load({ quiet: true });
    } catch (shiftError) {
      setError(shiftError.message || 'Could not change your shift.');
    } finally {
      setBusy('');
    }
  };

  if (loading) return <div className="rider-empty">Loading your deliveries…</div>;

  if (error && !data) {
    return (
      <div className="rider-shell">
        <div className="rider-error">{error}</div>
      </div>
    );
  }

  const { rider, active = [], recent = [], summary = {} } = data || {};

  return (
    <div className="rider-shell">
      <header className="rider-head">
        <div>
          <p className="rider-eyebrow">Dine3D delivery</p>
          <h1>My deliveries</h1>
        </div>
        <button
          type="button"
          className={`rider-shift ${rider?.isAvailable ? 'on' : 'off'}`}
          onClick={toggleShift}
          disabled={busy === 'shift'}
        >
          {rider?.isAvailable ? 'On shift' : 'Off shift'}
        </button>
      </header>

      <section className="rider-summary">
        <div><span>{summary.active ?? 0}</span>On the road</div>
        <div><span>{summary.delivered ?? 0}</span>Delivered today</div>
        <div><span>{money(summary.cashCollected)}</span>Cash collected</div>
        <div><span>{money(summary.earnings)}</span>Your fees</div>
      </section>

      {error ? <div className="rider-error">{error}</div> : null}

      {active.length === 0 ? (
        <div className="rider-none">
          <strong>Nothing to deliver right now.</strong>
          <span>{rider?.isAvailable ? 'New orders will appear here on their own.' : 'You are off shift — tap "Off shift" above to start taking orders.'}</span>
        </div>
      ) : (
        <div className="rider-list">
          {active.map((assignment) => {
            const state = STATUS[assignment.status] || STATUS.ASSIGNED;
            const order = assignment.order || {};
            const owed = Number(assignment.cashToCollect || 0);
            return (
              <article key={assignment.id} className="rider-card">
                <div className="rider-card-top">
                  <span className="rider-status" style={{ color: state.tone, background: state.bg }}>{state.label}</span>
                  <span className="rider-order">{order.orderNumber}</span>
                </div>

                <a
                  className="rider-address"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.customerAddress || '')}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {order.customerAddress || 'No address given'}
                </a>

                <div className="rider-meta">
                  <span>{order.customerName || 'Customer'}</span>
                  {order.customerPhone ? <a href={`tel:${order.customerPhone}`}>Call {order.customerPhone}</a> : null}
                </div>

                {owed > 0 ? (
                  <p className="rider-cash">Collect <strong>{money(owed)}</strong> in cash</p>
                ) : (
                  <p className="rider-paid">Already paid — collect nothing</p>
                )}

                {state.next ? (
                  <button
                    type="button"
                    className="rider-action"
                    disabled={busy === assignment.id}
                    onClick={() => {
                      if (state.next === 'deliver') {
                        setConfirming(assignment);
                        setCash(String(owed || ''));
                        return;
                      }
                      act(assignment, state.next);
                    }}
                  >
                    {busy === assignment.id ? 'Working…' : state.action}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {recent.length > 0 ? (
        <section className="rider-recent">
          <h2>Finished today</h2>
          {recent.map((assignment) => {
            const state = STATUS[assignment.status] || STATUS.DELIVERED;
            return (
              <div key={assignment.id} className="rider-recent-row">
                <span>{assignment.order?.orderNumber}</span>
                <span style={{ color: state.tone }}>{state.label}</span>
              </div>
            );
          })}
        </section>
      ) : null}

      {confirming ? (
        <div className="rider-modal-backdrop" role="dialog" aria-modal="true">
          <div className="rider-modal">
            <h2>Confirm delivery</h2>
            <p>Ask the customer for their four-digit code.</p>

            <label>
              Confirmation code
              <input
                inputMode="numeric"
                maxLength={4}
                value={proofCode}
                onChange={(event) => setProofCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="0000"
                autoFocus
              />
            </label>

            {Number(confirming.cashToCollect) > 0 ? (
              <label>
                Cash collected
                <input
                  inputMode="decimal"
                  value={cash}
                  onChange={(event) => setCash(event.target.value)}
                />
              </label>
            ) : null}

            {error ? <div className="rider-error">{error}</div> : null}

            <div className="rider-modal-actions">
              <button type="button" className="ghost" onClick={() => { setConfirming(null); setProofCode(''); setError(''); }}>
                Back
              </button>
              <button
                type="button"
                className="rider-action"
                disabled={proofCode.length !== 4 || busy === confirming.id}
                onClick={complete}
              >
                {busy === confirming.id ? 'Confirming…' : 'Delivered'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
