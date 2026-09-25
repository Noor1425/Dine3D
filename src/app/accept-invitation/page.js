'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Lock, User, Building2, CheckCircle, XCircle, Clock, Eye, EyeOff } from 'lucide-react';
import apiClient from '@/lib/api';

function AcceptInvitationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [step, setStep] = useState('loading'); // 'loading', 'create-account', 'accept', 'success', 'error'
  const [invitation, setInvitation] = useState(null);
  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
    name: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isNewUser, setIsNewUser] = useState(false);

  useEffect(() => {
    if (token) {
      loadInvitation();
    } else {
      setError('Invalid invitation link');
      setStep('error');
    }
  }, [token]);

  const loadInvitation = async () => {
    try {
      const response = await apiClient.get(`/v2/auth/invitations/${token}`);
      setInvitation(response.invitation);
      setIsNewUser(!response.invitation.existingAccount);
      setStep('create-account');
    } catch (err) {
      const errorCode = err.code;
      if (errorCode === 'INVALID_TOKEN') {
        setError('This invitation link is invalid');
      } else if (errorCode === 'ALREADY_ACCEPTED') {
        setError('This invitation has already been accepted');
      } else if (errorCode === 'EXPIRED') {
        setError('This invitation has expired. Please request a new invitation.');
      } else if (errorCode === 'REVOKED') {
        setError('This invitation has been revoked');
      } else {
        setError('Failed to load invitation. Please check the link and try again.');
      }
      setStep('error');
    }
  };

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    setError(null);
  };

  const validateForm = () => {
    if (isNewUser) {
      if (!formData.name) {
        setError('Please enter your name');
        return false;
      }
      if (formData.password.length < 15) {
        setError('Use at least 15 characters. A memorable passphrase works well.');
        return false;
      }
      if (formData.password !== formData.confirmPassword) {
        setError('Passwords do not match');
        return false;
      }
    } else if (!formData.password) {
      setError('Enter the current password for the invited account.');
      return false;
    }
    return true;
  };

  const handleAccept = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.post('/v2/auth/invitations/accept', {
        token,
        password: formData.password,
        name: isNewUser ? formData.name : undefined,
      });

      if (response.success) {
        setStep('success');
        setTimeout(() => {
          router.push('/admin/dashboard');
        }, 2000);
      }
    } catch (err) {
      setError(err.message || 'Failed to accept invitation. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Loading State
  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-gray-600">Loading invitation...</p>
        </div>
      </div>
    );
  }

  // Success State
  if (step === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
            <CheckCircle className="w-12 h-12 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Welcome to the Team!</h1>
          <p className="text-gray-600 mb-2">
            You've successfully joined <strong>{invitation?.restaurant?.name}</strong>
          </p>
          <p className="text-sm text-gray-500">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  // Error State
  if (step === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-red-100 rounded-full mb-6">
            <XCircle className="w-12 h-12 text-red-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Invalid Invitation</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <a
            href="/admin/login"
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Go to Login
          </a>
        </div>
      </div>
    );
  }

  // Accept Invitation Form
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
            <Mail className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Join the Team</h1>
          <p className="text-gray-600">You've been invited to join</p>
        </div>

        {/* Invitation Details Card */}
        {invitation && (
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Building2 className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">{invitation.restaurant.name}</h3>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center text-sm text-gray-600">
                    <Mail className="w-4 h-4 mr-2" />
                    {invitation.email}
                  </div>
                  <div className="flex items-center text-sm">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                      {invitation.role}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">
                      {invitation.accessLevel === 'corporate' && '• All Branches'}
                      {invitation.accessLevel === 'multi-branch' && '• Multiple Branches'}
                      {invitation.accessLevel === 'branch' && '• Single Branch'}
                    </span>
                  </div>
                  <div className="flex items-center text-xs text-gray-500">
                    <Clock className="w-3 h-3 mr-1" />
                    Expires: {new Date(invitation.expiresAt).toLocaleDateString()}
                  </div>
                  {invitation.branches?.length > 0 && <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700"><span className="font-semibold">Assigned location:</span> {invitation.branches.map((branch) => `${branch.name} (${branch.code})`).join(', ')}</div>}
                </div>
                <div className="mt-3 text-xs text-gray-500">
                  Invited by {invitation.sender?.name || 'restaurant administrator'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Form Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
              <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <form onSubmit={handleAccept} className="space-y-6">
            {isNewUser ? (
              <>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Create Your Account</h3>
                  <p className="text-sm text-gray-600 mb-6">
                    Set up your account to get started
                  </p>
                </div>

                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                    Your Name *
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      id="name"
                      name="name"
                      type="text"
                      required
                      value={formData.name}
                      onChange={handleInputChange}
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="John Doe"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                    Password *
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={15}
                      maxLength={128}
                      autoComplete="new-password"
                      value={formData.password}
                      onChange={handleInputChange}
                      className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="At least 15 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                    Confirm Password *
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={15}
                      maxLength={128}
                      autoComplete="new-password"
                      value={formData.confirmPassword}
                      onChange={handleInputChange}
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Repeat password"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirm your existing account</h3>
                  <p className="text-sm text-gray-600">Enter the current password for {invitation?.email}. This prevents someone with a forwarded link from taking over your account.</p>
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">Current password *</label>
                  <input id="password" name="password" type={showPassword ? 'text' : 'password'} required autoComplete="current-password" value={formData.password} onChange={handleInputChange} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-4 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Accepting...
                </>
              ) : (
                'Accept Invitation & Join Team'
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-sm text-gray-600">
          <p>
            Need help? <a href="https://wa.me/923144704840" target="_blank" rel="noreferrer noopener" className="text-blue-600 hover:text-blue-700">Message us on WhatsApp</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center">
        <div className="inline-block w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <AcceptInvitationContent />
    </Suspense>
  );
}
