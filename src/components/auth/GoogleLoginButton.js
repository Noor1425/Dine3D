'use client';
import { useState } from 'react';

/**
 * Premium Google Login Button
 * @param {Object} props
 * @param {Function} props.getGoogleUrl - Function to fetch the Google Auth URL (api.getGoogleUrl or saApi.getGoogleUrl)
 */
export default function GoogleLoginButton({ getGoogleUrl, label = "Continue with Google" }) {
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const { url } = await getGoogleUrl();
      if (url) {
        window.location.href = url;
      } else {
        throw new Error("Failed to get Google authentication URL");
      }
    } catch (err) {
      alert(err.message || "Google Login failed");
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleGoogleLogin}
      disabled={loading}
      className="w-full flex items-center justify-center gap-3 h-12 bg-white border border-neutral-200 rounded-xl px-4 py-2 text-neutral-700 font-bold hover:bg-neutral-50 transition-all shadow-sm active:scale-95 disabled:opacity-50"
    >
      {loading ? (
        <div className="w-5 h-5 border-2 border-neutral-300 border-t-neutral-600 rounded-full animate-spin" />
      ) : (
        <>
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.706c-.18-.54-.282-1.117-.282-1.706 0-.589.102-1.166.282-1.706V4.962H.957C.347 6.177 0 7.551 0 9s.347 2.823.957 4.038l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.582C13.462.894 11.426 0 9 0 5.482 0 2.438 2.017.957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"/>
          </svg>
          <span className="text-sm tracking-tight">{label}</span>
        </>
      )}
    </button>
  );
}
