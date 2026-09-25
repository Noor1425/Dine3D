'use client';

import { useState } from 'react';
import { Building2, ChevronDown, Check, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api';

/**
 * Restaurant Switcher Component
 * Dropdown to switch between restaurants (for multi-restaurant users)
 */
export default function RestaurantSwitcher({ currentRestaurant, restaurants = [], onSwitch }) {
  const [isOpen, setIsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const handleSwitch = async (restaurantId) => {
    if (restaurantId === currentRestaurant?.id) {
      setIsOpen(false);
      return;
    }

    try {
      setSwitching(true);
      const response = await apiClient.post('/v2/auth/switch-restaurant', {
        restaurantId
      });

      if (response.success) {
        onSwitch?.(response.restaurant);
        setIsOpen(false);
        // Reload the page to update context
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to switch restaurant:', error);
      alert('Failed to switch restaurant. Please try again.');
    } finally {
      setSwitching(false);
    }
  };

  if (!currentRestaurant) return null;

  // If only one restaurant, show static display
  if (restaurants.length <= 1) {
    return (
      <div className="flex min-w-0 max-w-[240px] items-center space-x-2 rounded-lg bg-gray-50 px-3 py-2">
        <Building2 className="h-5 w-5 flex-shrink-0 text-gray-600" />
        <span className="min-w-0 truncate font-medium text-gray-900">{currentRestaurant.name}</span>
      </div>
    );
  }

  return (
    <div className="relative min-w-0 max-w-full">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={switching}
        className="flex min-w-0 max-w-[240px] items-center space-x-2 rounded-lg border border-gray-300 bg-white px-3 py-2 transition-colors hover:bg-gray-50 disabled:opacity-50"
      >
        {currentRestaurant.logo ? (
          <img
            src={currentRestaurant.logo}
            alt={currentRestaurant.name}
            className="w-6 h-6 rounded object-cover"
          />
        ) : (
          <Building2 className="w-5 h-5 text-gray-600" />
        )}
        <span className="min-w-0 truncate font-medium text-gray-900">{currentRestaurant.name}</span>
        {switching ? (
          <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />
        ) : (
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed left-3 right-3 top-16 z-20 rounded-lg border border-gray-200 bg-white shadow-lg sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72">
            <div className="p-2 border-b border-gray-200">
              <p className="text-xs font-medium text-gray-500 px-3 py-2">
                Switch Restaurant
              </p>
            </div>
            <div className="p-2 max-h-96 overflow-y-auto">
              {restaurants.map((restaurant) => (
                  <button
                    key={restaurant.id}
                    onClick={() => handleSwitch(restaurant.id)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors ${
                      restaurant.id === currentRestaurant.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex min-w-0 items-center space-x-3">
                      {restaurant.logo ? (
                        <img
                          src={restaurant.logo}
                          alt={restaurant.name}
                          className="w-8 h-8 rounded object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-gray-400" />
                        </div>
                      )}
                      <div className="min-w-0 text-left">
                        <p className="truncate font-medium text-gray-900">{restaurant.name}</p>
                        <p className="truncate text-xs text-gray-500">{restaurant.role}</p>
                      </div>
                    </div>
                    {restaurant.id === currentRestaurant.id && (
                      <Check className="w-5 h-5 text-blue-600" />
                    )}
                  </button>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
