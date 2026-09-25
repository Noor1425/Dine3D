'use client';

import { Building2, CheckCircle2, Shield, ArrowRight } from 'lucide-react';

/**
 * Professional Restaurant Selector Component
 * Displays available restaurants in a clean, card-based layout
 */
export default function RestaurantSelector({ restaurants = [], onSelect, loading = false }) {
  if (restaurants.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">No restaurants available</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {restaurants.map((restaurant) => (
        <button
          key={restaurant.id}
          onClick={() => onSelect(restaurant)}
          disabled={loading}
          className="w-full bg-white border-2 border-gray-200 rounded-xl p-5 hover:border-blue-500 hover:shadow-lg transition-all duration-200 text-left group disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4 flex-1">
              {/* Restaurant Icon */}
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                <Building2 className="w-6 h-6 text-white" />
              </div>

              {/* Restaurant Info */}
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 text-lg mb-1 group-hover:text-blue-600 transition-colors truncate">
                  {restaurant.name}
                </h3>
                <div className="flex items-center space-x-4 text-sm text-gray-500">
                  <span className="flex items-center space-x-1">
                    <Shield className="w-3.5 h-3.5" />
                    <span className="capitalize">{restaurant.membership?.role || 'member'}</span>
                  </span>
                  {restaurant.membership?.accessLevel && (
                    <span className="flex items-center space-x-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span className="capitalize">
                        {restaurant.membership.accessLevel === 'corporate' && 'All Branches'}
                        {restaurant.membership.accessLevel === 'multi-branch' && 'Multiple Branches'}
                        {restaurant.membership.accessLevel === 'branch' && 'Single Branch'}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Arrow Icon */}
            <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all flex-shrink-0" />
          </div>
        </button>
      ))}
    </div>
  );
}
