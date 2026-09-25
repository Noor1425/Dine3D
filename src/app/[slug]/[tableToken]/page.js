'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';
import { RestaurantView } from '@/components/RestaurantView';

export default function TablePage() {
  const { slug, tableToken } = useParams();
  const [table, setTable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const fetchTable = async () => {
      try {
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          const ticket = params.get('ticket');
          if (ticket) {
            try {
              await api.exchangePreviewTicket(ticket);
              // Clean URL
              const newUrl = window.location.pathname;
              window.history.replaceState({}, '', newUrl);
            } catch (err) {
              console.error('Ticket exchange failed', err);
            }
          }
        }
        const res = await api.validateTable(slug, tableToken);
        setTable(res.table);
      } catch (e) {
        setError(e.message);
        setUnavailable(e.status === 503 || e.code === 'ONLINE_ORDERING_UNAVAILABLE' || e.code === 'NETWORK_UNAVAILABLE');
      } finally {
        setLoading(false);
      }
    };
    fetchTable();
  }, [slug, tableToken]);

  if (loading) return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
      <div className="text-white text-xl animate-pulse font-bold">Validating Table…</div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-white p-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center text-3xl mb-6">
        {unavailable ? '◷' : '⌁'}
      </div>
      <h2 className="text-3xl font-black mb-3">
        {unavailable ? 'Online ordering is temporarily unavailable' : 'This QR code is unavailable'}
      </h2>
      <p className="text-neutral-400 max-w-md leading-relaxed">
        {unavailable
          ? 'The restaurant is not accepting new online orders right now. Please speak with a team member or try again later.'
          : 'This table QR code may have been replaced, revoked, or deactivated. Please ask a team member for assistance.'}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-8 rounded-full bg-white text-black px-6 py-3 text-sm font-black"
      >
        Try again
      </button>
    </div>
  );

  return <RestaurantView slug={slug} table={table} qrToken={tableToken} />;
}
