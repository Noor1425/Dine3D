/**
 * MENU ITEM MODAL COMPONENT - NEW SCHEMA
 * 
 * Professional variant and modifier selection UI
 * Features:
 * - Radio buttons for variants (only one per item)
 * - Checkboxes for modifiers (multiple allowed)
 * - Real-time price calculation (using backend formula)
 * - Clean, professional Foodpanda-style layout
 * 
 * Usage:
 * <MenuItemModal item={menuItem} onAddToCart={handleAddToCart} onClose={handleClose} />
 * 
 * MenuItem structure:
 * {
 *   id: "...",
 *   name: "...",
 *   description: "...",
 *   basePrice: 1300,
 *   variants: [
 *     { id: "...", name: "Small", price: 1300 },
 *     { id: "...", name: "Large", price: 1900 }
 *   ],
 *   modifierGroups: [
 *     {
 *       id: "...",
 *       name: "Toppings",
 *       isRequired: false,
 *       maxSelectable: 5,
 *       modifiers: [
 *         { id: "...", name: "Extra Cheese", price: 150 },
 *       ]
 *     }
 *   ]
 * }
 */

'use client';

import { useState, useCallback } from 'react';
import { Decimal } from 'decimal.js';

export default function MenuItemModal({ item, onAddToCart, onClose }) {
  // ──────────────────────────────────────────────────
  // STATE
  // ──────────────────────────────────────────────────

  const [selectedVariant, setSelectedVariant] = useState(
    item.variants?.[0]?.id || null
  );

  const [selectedModifiers, setSelectedModifiers] = useState({});
  const [quantity, setQuantity] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  // ──────────────────────────────────────────────────
  // CALCULATIONS
  // ──────────────────────────────────────────────────

  // Get selected variant price
  const variantPrice = selectedVariant
    ? item.variants.find(v => v.id === selectedVariant)?.price || item.basePrice
    : item.basePrice;

  // Calculate modifier total
  const modifierTotal = Object.entries(selectedModifiers).reduce((sum, [modifierId, isSelected]) => {
    if (!isSelected) return sum;

    let found = null;
    for (const group of item.modifierGroups || []) {
      const mod = group.modifiers?.find(m => m.id === modifierId);
      if (mod) {
        found = mod;
        break;
      }
    }

    return sum + (found?.price || 0);
  }, 0);

  // Calculate item total
  const itemTotal = new Decimal(variantPrice).plus(new Decimal(modifierTotal)).times(new Decimal(quantity));

  // ──────────────────────────────────────────────────
  // VARIANT SELECTION (Radio Buttons)
  // ──────────────────────────────────────────────────

  const handleVariantChange = useCallback((variantId) => {
    setSelectedVariant(variantId);
  }, []);

  // ──────────────────────────────────────────────────
  // MODIFIER SELECTION (Checkboxes)
  // ──────────────────────────────────────────────────

  const handleModifierChange = useCallback((modifierId, checked, groupId) => {
    setSelectedModifiers(prev => {
      const updated = { ...prev };

      if (checked) {
        // Check if group has max selectable limit
        const group = item.modifierGroups.find(g => g.id === groupId);
        const groupSelections = Object.entries(updated)
          .filter(([mId]) => {
            // Count how many from this group
            const mod = group?.modifiers?.find(m => m.id === mId);
            return !!mod;
          })
          .length;

        if (group?.maxSelectable && groupSelections >= group.maxSelectable) {
          // Don't allow more selections
          return prev;
        }

        updated[modifierId] = true;
      } else {
        delete updated[modifierId];
      }

      return updated;
    });
  }, [item.modifierGroups]);

  // ──────────────────────────────────────────────────
  // ADD TO CART
  // ──────────────────────────────────────────────────

  const handleAddToCart = useCallback(async () => {
    setIsLoading(true);

    try {
      // Prepare order item
      const orderItem = {
        menuItemId: item.id,
        variantId: selectedVariant,
        quantity: quantity,
        modifiers: Object.entries(selectedModifiers)
          .filter(([_, isSelected]) => isSelected)
          .map(([modifierId]) => ({ modifierId }))
      };

      onAddToCart(orderItem);
      onClose();
    } catch (error) {
      console.error('Error adding to cart:', error);
    } finally {
      setIsLoading(false);
    }
  }, [item.id, selectedVariant, quantity, selectedModifiers, onAddToCart, onClose]);

  // ──────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end z-50">
      <div className="bg-white w-full rounded-t-3xl overflow-y-auto max-h-[90vh] animate-in slide-in-from-bottom">
        {/* HEADER */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">{item.name}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {/* CONTENT */}
        <div className="p-4 space-y-6">
          {/* DESCRIPTION */}
          {item.description && (
            <p className="text-gray-600 text-sm">{item.description}</p>
          )}

          {/* VARIANTS - Radio Buttons */}
          {item.variants && item.variants.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-900">Size</h3>
              <div className="space-y-2">
                {item.variants.map(variant => (
                  <label
                    key={variant.id}
                    className="flex items-center p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition"
                  >
                    <input
                      type="radio"
                      name="variant"
                      value={variant.id}
                      checked={selectedVariant === variant.id}
                      onChange={() => handleVariantChange(variant.id)}
                      className="w-4 h-4 text-blue-600 cursor-pointer"
                    />
                    <div className="flex-1 ml-3">
                      <div className="font-medium text-gray-900">{variant.name}</div>
                    </div>
                    <div className="text-blue-600 font-semibold">
                      {variant.price.toLocaleString()} PKR
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* MODIFIER GROUPS - Checkboxes */}
          {item.modifierGroups && item.modifierGroups.length > 0 && (
            <div className="space-y-6">
              {item.modifierGroups.map(group => (
                <div key={group.id}>
                  <h3 className="font-semibold text-gray-900">
                    {group.name}
                    {group.isRequired && <span className="text-red-500"> *</span>}
                  </h3>
                  {group.maxSelectable && (
                    <p className="text-xs text-gray-500 mt-1">
                      Select up to {group.maxSelectable}
                    </p>
                  )}

                  <div className="space-y-2 mt-3">
                    {group.modifiers && group.modifiers.map(modifier => {
                      const isSelected = selectedModifiers[modifier.id] || false;
                      return (
                        <label
                          key={modifier.id}
                          className="flex items-center p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) =>
                              handleModifierChange(modifier.id, e.target.checked, group.id)
                            }
                            className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                          />
                          <div className="flex-1 ml-3">
                            <div className="font-medium text-gray-900">
                              {modifier.name}
                            </div>
                          </div>
                          {modifier.price > 0 && (
                            <div className="text-gray-600 text-sm">
                              +{modifier.price} PKR
                            </div>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* QUANTITY SELECTOR */}
          <div className="flex items-center justify-between px-3 py-2 border border-gray-300 rounded-lg">
            <span className="text-gray-700 font-medium">Quantity</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-lg font-bold"
              >
                −
              </button>
              <span className="w-8 text-center font-semibold">{quantity}</span>
              <button
                onClick={() => setQuantity(Math.min(99, quantity + 1))}
                className="w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-lg font-bold"
              >
                +
              </button>
            </div>
          </div>

          {/* PRICE BREAKDOWN */}
          <div className="bg-gray-50 p-4 rounded-lg space-y-2">
            <div className="text-xs text-gray-600 uppercase tracking-wider font-semibold">
              Price Breakdown
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Variant Price</span>
              <span className="text-gray-900">
                {(variantPrice * quantity).toLocaleString()} PKR
              </span>
            </div>
            {modifierTotal > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Modifiers</span>
                <span className="text-gray-900">
                  +{(modifierTotal * quantity).toLocaleString()} PKR
                </span>
              </div>
            )}
            <div className="border-t border-gray-300 pt-2 flex justify-between font-bold">
              <span>Total</span>
              <span className="text-blue-600">{itemTotal.toLocaleString()} PKR</span>
            </div>
          </div>
        </div>

        {/* FOOTER - ADD TO CART BUTTON */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4">
          <button
            onClick={handleAddToCart}
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition"
          >
            {isLoading ? 'Adding...' : `Add to Cart - ${itemTotal.toLocaleString()} PKR`}
          </button>
        </div>
      </div>
    </div>
  );
}
