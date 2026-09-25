/**
 * CART COMPONENT - NEW SCHEMA
 * 
 * Professional cart with:
 * - Tenant/table-scoped IndexedDB persistence (survives page refresh)
 * - Real-time pricing calculations
 * - Complete breakdown display (items, tax, service fee, total)
 * - Quantity controls
 * - Remove item functionality
 * - Checkout flow
 * 
 * Usage:
 * <Cart tableId={tableId} />
 * 
 * Features:
 * - Add items from menu modal
 * - View complete order with all modifiers
 * - Adjust quantities
 * - Remove items
 * - See tax & service charge breakdown
 * - Proceed to checkout (creates order via API)
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCart } from '@/hooks/useCart';
import { api } from '@/lib/api';

export default function Cart({ tableId, restaurantId }) {
  // ──────────────────────────────────────────────────
  // STATE
  // ──────────────────────────────────────────────────

  const { cartItems, addItem, removeItem, updateQuantity, clearCart } = useCart(restaurantId, tableId);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [taxConfig, setTaxConfig] = useState({
    taxPercent: 0,
    serviceChargePercent: 0,
    serviceFeeFixed: 0
  });

  // ──────────────────────────────────────────────────
  // LOAD TAX CONFIG
  // ──────────────────────────────────────────────────

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await api.get(`/restaurants/${restaurantId}/config`);
        setTaxConfig({
          taxPercent: response.data.taxPercent || 0,
          serviceChargePercent: response.data.serviceChargePercent || 0,
          serviceFeeFixed: response.data.serviceFeeFixed || 0
        });
      } catch (error) {
        console.error('Error loading restaurant config:', error);
      }
    };

    if (restaurantId) {
      loadConfig();
    }
  }, [restaurantId]);

  // ──────────────────────────────────────────────────
  // CALCULATIONS
  // ──────────────────────────────────────────────────

  // Calculate totals
  const itemTotals = cartItems.reduce((sum, item) => {
    const itemPrice = (item.selectedVariantPrice || item.basePrice) * item.quantity;
    const modifierTotal = (item.modifiers || []).reduce((mSum, mod) => mSum + (mod.price * mod.quantity || mod.price), 0);
    return sum + itemPrice + modifierTotal;
  }, 0);

  const subtotal = Math.round(itemTotals * 100) / 100;
  const tax = Math.round(subtotal * (taxConfig.taxPercent / 100) * 100) / 100;
  const serviceCharge = Math.round(subtotal * (taxConfig.serviceChargePercent / 100) * 100) / 100;
  const serviceFee = taxConfig.serviceFeeFixed;
  const total = subtotal + tax + serviceCharge + serviceFee;

  // ──────────────────────────────────────────────────
  // PLACE ORDER
  // ──────────────────────────────────────────────────

  const handlePlaceOrder = useCallback(async () => {
    if (cartItems.length === 0) {
      alert('Cart is empty');
      return;
    }

    setIsLoading(true);

    try {
      // Format items for API
      const items = cartItems.map(item => ({
        menuItemId: item.id,
        variantId: item.variantId || null,
        quantity: item.quantity,
        modifiers: (item.modifiers || []).map(mod => ({
          modifierId: mod.id
        }))
      }));

      // Create order
      const response = await api.post('/orders', {
        tableId,
        items
      });

      if (response.data.success) {
        setOrderPlaced(true);
        clearCart();
        setTimeout(() => {
          setOrderPlaced(false);
          setIsOpen(false);
        }, 2000);
      }
    } catch (error) {
      console.error('Error placing order:', error);
      alert('Failed to place order: ' + (error.response?.data?.error || error.message));
    } finally {
      setIsLoading(false);
    }
  }, [cartItems, tableId, clearCart]);

  // ──────────────────────────────────────────────────
  // CART EMPTY STATE
  // ──────────────────────────────────────────────────

  if (cartItems.length === 0) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 bg-blue-600 hover:bg-blue-700 text-white rounded-full w-16 h-16 flex items-center justify-center text-2xl shadow-lg"
      >
        🛒
        <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center">
          0
        </span>
      </button>
    );
  }

  // ──────────────────────────────────────────────────
  // CART BUTTON
  // ──────────────────────────────────────────────────

  const CartButton = () => (
    <button
      onClick={() => setIsOpen(true)}
      className="fixed bottom-4 right-4 bg-blue-600 hover:bg-blue-700 text-white rounded-full w-16 h-16 flex items-center justify-center text-2xl shadow-lg relative"
    >
      🛒
      <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
        {cartItems.length}
      </span>
    </button>
  );

  // ──────────────────────────────────────────────────
  // CART MODAL
  // ──────────────────────────────────────────────────

  return (
    <>
      <CartButton />

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50 animate-in fade-in">
          <div className="bg-white w-full rounded-t-3xl overflow-y-auto max-h-[90vh] animate-in slide-in-from-bottom">
            {/* HEADER */}
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">Your Order</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            {/* SUCCESS MESSAGE */}
            {orderPlaced && (
              <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg m-4">
                ✓ Order placed successfully!
              </div>
            )}

            {/* CART ITEMS */}
            <div className="p-4 space-y-3">
              {cartItems.map((item, index) => (
                <div
                  key={`${item.id}-${index}`}
                  className="border border-gray-200 rounded-lg p-4 space-y-2"
                >
                  {/* ITEM HEADER */}
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">{item.name}</h3>
                      {item.selectedVariantName && (
                        <p className="text-sm text-gray-600">{item.selectedVariantName}</p>
                      )}
                    </div>
                    <button
                      onClick={() => removeItem(index)}
                      className="text-red-600 hover:text-red-700 text-lg"
                    >
                      ×
                    </button>
                  </div>

                  {/* MODIFIERS */}
                  {item.modifiers && item.modifiers.length > 0 && (
                    <div className="text-sm text-gray-600 space-y-1">
                      {item.modifiers.map((mod, mIdx) => (
                        <div key={mIdx} className="flex justify-between">
                          <span>├ {mod.name}</span>
                          <span>+{mod.price} PKR</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* QUANTITY & PRICE */}
                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-2 border border-gray-300 rounded-lg p-1">
                      <button
                        onClick={() => updateQuantity(index, item.quantity - 1)}
                        className="w-6 h-6 text-gray-600 hover:text-gray-900 font-bold"
                        disabled={item.quantity <= 1}
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm font-medium">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(index, item.quantity + 1)}
                        className="w-6 h-6 text-gray-600 hover:text-gray-900 font-bold"
                      >
                        +
                      </button>
                    </div>

                    <div className="text-right">
                      <div className="text-sm text-gray-600">
                        {((item.selectedVariantPrice || item.basePrice) * item.quantity).toLocaleString()} PKR
                      </div>
                      {item.modifiers && item.modifiers.length > 0 && (
                        <div className="text-xs text-gray-500">
                          +{item.modifiers.reduce((sum, m) => sum + m.price, 0).toLocaleString()} modifiers
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* BREAKDOWN */}
            <div className="bg-gray-50 p-4 space-y-2 border-t border-gray-200">
              <div className="text-xs text-gray-600 uppercase tracking-wider font-semibold">
                Order Breakdown
              </div>

              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-gray-700">
                  <span>Subtotal ({cartItems.length} items)</span>
                  <span>{subtotal.toLocaleString()} PKR</span>
                </div>

                {tax > 0 && (
                  <div className="flex justify-between text-gray-700">
                    <span>Tax ({taxConfig.taxPercent}%)</span>
                    <span>+{tax.toLocaleString()} PKR</span>
                  </div>
                )}

                {serviceCharge > 0 && (
                  <div className="flex justify-between text-gray-700">
                    <span>Service Charge ({taxConfig.serviceChargePercent}%)</span>
                    <span>+{serviceCharge.toLocaleString()} PKR</span>
                  </div>
                )}

                {serviceFee > 0 && (
                  <div className="flex justify-between text-gray-700">
                    <span>Delivery Fee</span>
                    <span>+{serviceFee.toLocaleString()} PKR</span>
                  </div>
                )}

                <div className="border-t border-gray-300 pt-2 flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span className="text-blue-600">{total.toLocaleString()} PKR</span>
                </div>
              </div>
            </div>

            {/* FOOTER - PLACE ORDER BUTTON */}
            <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 space-y-2">
              <button
                onClick={handlePlaceOrder}
                disabled={isLoading || cartItems.length === 0}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition"
              >
                {isLoading ? 'Placing Order...' : `Place Order - ${total.toLocaleString()} PKR`}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="w-full text-gray-700 bg-gray-200 hover:bg-gray-300 font-bold py-3 px-4 rounded-lg transition"
              >
                Continue Shopping
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
