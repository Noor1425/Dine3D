'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RestaurantView } from '@/components/RestaurantView';
import api from '@/lib/api';

export default function RestaurantPage() {
  const { slug } = useParams();
  const [isExchanging, setIsExchanging] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const ticket = urlParams.get('ticket');

    if (ticket) {
      setIsExchanging(true);
      const exchangeTicket = async () => {
        try {
          await api.post('/auth/preview/exchange', { ticket });
          setIsPreview(true);
          const newUrl = window.location.pathname;
          window.history.replaceState({}, document.title, newUrl);
        } catch (err) {
          console.error('Ticket exchange failed:', err);
          alert('Session expired or invalid ticket.');
        } finally {
          setIsExchanging(false);
        }
      };
      exchangeTicket();
    }
  }, []);

  const handleExitPreview = async () => {
    try {
      await api.post('/auth/exit-context');
      const isProd = window.location.hostname !== 'localhost' && !window.location.hostname.endsWith('.localhost');
      window.location.href = isProd
        ? 'https://admin.dine3d.ai/superadmin/restaurants'
        : 'http://localhost:3000/superadmin/restaurants';
    } catch (err) {
      console.error('Failed to exit preview:', err);
    }
  };

  if (isExchanging) {
    return <div className="flex items-center justify-center min-h-screen bg-black text-gold font-bold">ESTABLISHING SECURE PREVIEW...</div>;
  }

  return (
    <div className="relative">
      {isPreview && (
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-black/80 backdrop-blur-md border-b border-gold/20 p-2 flex justify-between items-center px-6">
          <div className="text-gold font-bold flex items-center gap-2">
            <span className="w-2 h-2 bg-gold rounded-full animate-pulse"></span>
            SUPERADMIN PREVIEW MODE (READ-ONLY)
          </div>
          <button 
            onClick={handleExitPreview}
            className="bg-gold text-black px-4 py-1 rounded-full text-sm font-bold hover:bg-white transition-colors"
          >
            EXIT PREVIEW
          </button>
        </div>
      )}
      <div className={isPreview ? 'pt-12' : ''}>
        <RestaurantView slug={slug} />
      </div>
    </div>
  );
}
