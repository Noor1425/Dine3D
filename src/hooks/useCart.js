'use client';
import { useReducer, useEffect, useCallback, useState } from 'react';
import { clearPublicCart, loadPublicCart, savePublicCart } from '@/lib/offline/publicQrDatabase';

const generateCartId = (item, modifiers, variant, notes = '') => {
  let baseId = variant ? `${item.id}_${variant.id}` : item.id;
  const normalizedNotes = String(notes || '').trim().toLowerCase();
  const noteKey = normalizedNotes ? `_note-${normalizedNotes.replace(/\s+/g, '-').slice(0, 40)}` : '';
  if (!modifiers || modifiers.length === 0) return `${baseId}${noteKey}`;
  const sortedMods = [...modifiers].sort((a, b) => {
    const left = `${a.group || ''}:${a.option || ''}:${a.quantity || 1}`;
    const right = `${b.group || ''}:${b.option || ''}:${b.quantity || 1}`;
    return left.localeCompare(right);
  });
  const modifierKey = sortedMods
    .map((modifier) => `${modifier.group || 'group'}-${modifier.option.replace(/\s+/g, '-')}-x${modifier.quantity || 1}`)
    .join('_');
  return `${baseId}_${modifierKey}${noteKey}`;
};

const cartReducer = (state, action) => {
  switch (action.type) {
    case 'ADD_ITEM': {
      const normalizedNotes = String(action.notes || '').trim();
      const cartId = generateCartId(action.item, action.modifiers, action.variant, normalizedNotes);
      const existing = state.items.find(i => i.cartId === cartId);
      if (existing) {
        return {
          ...state,
          items: state.items.map(i =>
            i.cartId === cartId ? { ...i, quantity: i.quantity + action.quantity } : i
          ),
        };
      }
      
      // ✅ FIX: Ensure all prices are numbers, not strings or Decimals, and account for mod quantities
      const modifierTotal = (action.modifiers || []).reduce((sum, m) => sum + (parseFloat(m.price || 0) * parseInt(m.quantity || 1)), 0);
      const basePrice = action.variant ? parseFloat(action.variant.price || 0) : parseFloat(action.item.basePrice || action.item.price || 0);
      const finalPrice = basePrice + modifierTotal;

      return { 
        ...state, 
        items: [...state.items, { 
          cartId,
          menuItemId: action.item.id,
          variantId: action.variant?.id || null,
          variantName: action.variant?.name || null,
          name: action.item.name,
          imageUrl: action.item.imageUrl || null,
          basePrice,
          price: finalPrice,
          modifiers: action.modifiers || [],
          quantity: action.quantity,
          notes: normalizedNotes || null,
        }] 
      };
    }
    case 'REMOVE_ITEM':
      return { ...state, items: state.items.filter(i => i.cartId !== action.cartId) };
    case 'UPDATE_QUANTITY':
      if (action.quantity <= 0) {
        return { ...state, items: state.items.filter(i => i.cartId !== action.cartId) };
      }
      return {
        ...state,
        items: state.items.map(i =>
          i.cartId === action.cartId ? { ...i, quantity: action.quantity } : i
        ),
      };
    case 'CLEAR':
      return { ...state, items: [] };
    case 'LOAD':
      return { ...state, items: action.items };
    default:
      return state;
  }
};

export function useCart(restaurantId = null, tableId = null) {
  const [state, dispatch] = useReducer(cartReducer, { items: [] });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    if (!restaurantId) {
      dispatch({ type: 'LOAD', items: [] });
      return undefined;
    }
    loadPublicCart(restaurantId, tableId).then((items) => {
      if (!cancelled) {
        dispatch({ type: 'LOAD', items });
        setLoaded(true);
      }
    }).catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [restaurantId, tableId]);

  useEffect(() => {
    if (!restaurantId || !loaded) return;
    savePublicCart(restaurantId, tableId, state.items).catch(() => {});
  }, [state.items, restaurantId, tableId, loaded]);

  const addItem = useCallback((item, quantity = 1, modifiers = [], variant = null, notes = '') => {
    dispatch({ type: 'ADD_ITEM', item, quantity, modifiers, variant, notes });
  }, []);

  const removeItem = useCallback((cartId) => {
    dispatch({ type: 'REMOVE_ITEM', cartId });
  }, []);

  const updateQuantity = useCallback((cartId, quantity) => {
    dispatch({ type: 'UPDATE_QUANTITY', cartId, quantity });
  }, []);

  const clearCart = useCallback(() => {
    dispatch({ type: 'CLEAR' });
    clearPublicCart(restaurantId, tableId).catch(() => {});
  }, [restaurantId, tableId]);

  // ✅ FIX: Ensure all prices are numbers when calculating total
  const total = state.items.reduce((sum, i) => {
    const itemPrice = parseFloat(i.price || 0);
    const itemQty = parseInt(i.quantity || 1);
    const itemTotal = itemPrice * itemQty;
    return sum + itemTotal;
  }, 0);
  
  const count = state.items.reduce((sum, i) => sum + i.quantity, 0);

  return { items: state.items, cartItems: state.items, total, count, addItem, removeItem, updateQuantity, clearCart };
}
