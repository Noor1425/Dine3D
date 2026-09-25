'use client';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { useTheme } from '@/hooks/useTheme';
import { useCart } from '@/hooks/useCart';
import { useSocket } from '@/hooks/useSocket';
import { useOrderHistory } from '@/hooks/useOrderHistory';
import { toast } from 'sonner';
import { notFound } from 'next/navigation';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import {
  acknowledgeQrSubmission,
  getOrCreatePendingQrSubmission,
  markQrSubmissionAttempt,
} from '@/lib/offline/publicQrDatabase';

/* ─── Emoji map ─────────────────────────────────────────────────────── */
const EMOJI_MAP = {
  burger:'🍔',pizza:'🍕',ramen:'🍜',sushi:'🍣',steak:'🥩',chicken:'🍗',salad:'🥗',
  taco:'🌮',pasta:'🍝',dessert:'🍰',drink:'🥤',coffee:'☕',naan:'🫓',biryani:'🍛'
};
const FALLBACK = ['🍽️', '🥘', '🥗', '🍲'];
const getEmoji = (name = '') => {
  const n = name.toLowerCase();
  for (const [k, v] of Object.entries(EMOJI_MAP)) if (n.includes(k)) return v;
  return FALLBACK[name.length % FALLBACK.length];
};
const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', PKR: 'Rs.', AED: 'د.إ', SAR: 'ر.س', INR: '₹' };
const getSymbol = (restaurant) => CURRENCY_SYMBOLS[restaurant?.currency] || 'Rs.';
const fmtTime = (d) => {
  if (!d) return 'Recently';
  const date = new Date(d);
  if (isNaN(date.getTime())) return 'Recently';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const getContrastColor = (hex) => {
  if (!hex) return '#ffffff';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#000000' : '#ffffff';
};

const fmt = (p, restaurant) => {
  const symbol = getSymbol(restaurant);
  const price = parseFloat(p || 0);
  // Never show negative prices with confusing minus sign
  if (price < 0) {
    return `−${symbol}${Math.abs(price).toFixed(2)}`;  // Minus sign for negative
  }
  return `${symbol}${price.toFixed(2)}`;
};

// NEW HELPER: Format modifiers with absolute prices
const fmtModifier = (price, symbol) => {
  const p = parseFloat(price || 0);
  if (p === 0) return 'No charge';
  return p < 0 ? `(Save ${symbol}${Math.abs(p).toFixed(2)})` : `+${symbol}${p.toFixed(2)}`;
};

const getModifierGroupLayout = (groupName = '') => {
  const normalized = groupName.toLowerCase();
  if (normalized.includes('sauce') || normalized.includes('dip')) return 'chip';
  if (
    normalized.includes('drink')
    || normalized.includes('bottle')
    || normalized.includes('beverage')
    || normalized.includes('combo')
  ) {
    return 'card';
  }
  return 'list';
};

const getModifierGroupRule = (group) => {
  const limit = group?.maxSelection || group?.maxSelectable || null;
  if (group?.isRequired && limit === 1) return 'Required • choose 1';
  if (group?.isRequired && limit) return `Required • up to ${limit}`;
  if (limit === 1) return 'Optional • choose 1';
  if (limit) return `Optional • up to ${limit}`;
  return group?.isRequired ? 'Required' : 'Optional';
};

const createInitialExpandedSections = (item) => {
  const sections = { details: false };
  if (item?.variants?.length > 0) sections.size = true;
  (item?.modifierGroups || []).slice(0, 2).forEach((group) => {
    sections[group.name] = true;
  });
  return sections;
};

const normalizeOrderStatus = (status) => String(status || 'PENDING').trim().toUpperCase();

const CUSTOMER_TRACKER_STATUS_MAP = {
  CREATED: 'PENDING',
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  SERVED: 'COMPLETED',
  DELIVERED: 'COMPLETED',
  PICKED_UP: 'COMPLETED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'COMPLETED',
  FAILED: 'CANCELLED',
};

/* ═══════════════════════════════════════════════════════════════════════
   STORE VIEW COMPONENT (Shared between [slug] and [slug]/[tableToken])
   ═══════════════════════════════════════════════════════════════════════ */
export function RestaurantView({ slug, table = null, qrToken = null }) {
  const [restaurant, setRestaurant]         = useState(null);
  const [categories, setCategories]         = useState([]);
  const [uncategorized, setUncategorized]   = useState([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);
  const [showCart, setShowCart]             = useState(false);
  const [viewingItem, setViewingItem]       = useState(null);
  const [itemQty, setItemQty]               = useState(1);
  const [selectedMods, setSelectedMods]     = useState({});
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [modQtys, setModQtys]               = useState({}); // ✅ NEW: Track modifier quantities
  const [itemNotes, setItemNotes]           = useState('');
  const [expandedSections, setExpandedSections] = useState({});
  const [orderPlaced, setOrderPlaced]       = useState(false);
  const [trackingOrderId, setTrackingOrderId] = useState(null);
  const [showTracker, setShowTracker]       = useState(false);
  const [isOrderActive, setIsOrderActive]   = useState(false);
  const [placing, setPlacing]               = useState(false);
  const [name, setName]                     = useState('');
  const [phone, setPhone]                   = useState('');
  const [notes, setNotes]                   = useState('');
  const [search, setSearch]                 = useState('');
  const [navSolid, setNavSolid]             = useState(false);
  const [viewing3D, setViewing3D]           = useState(null);
  const [showSearch, setShowSearch]         = useState(false);
  const [showLookup, setShowLookup]         = useState(false);
  const [lookupId, setLookupId]             = useState('');
  const [errors, setErrors]                 = useState({});
  const [, setTouched]                      = useState(false);
  const [promoCode, setPromoCode]           = useState('');
  const [promoResult, setPromoResult]       = useState(null);
  const [promoLoading, setPromoLoading]     = useState(false);
  const [promoError, setPromoError]         = useState('');

  const searchParams = useSearchParams();
  
  // table context
  const tableId = table?.id || searchParams.get('table') || null;

  // multiple orders management
  const { activeOrders, saveOrder, updateOrderStatus } = useOrderHistory(slug, tableId);
  const activeOrderIdsKey = activeOrders
    .map((order) => order.id)
    .filter(Boolean)
    .sort()
    .join(',');

  const itemDetailsRef = useRef(null);
  const { scrollY } = useScroll();
  const heroParallax = useTransform(scrollY, [0, 800], [0, -120]);
  const heroOpacity  = useTransform(scrollY, [0, 500], [1, 0.3]);

  const { items: cartItems, total, count, addItem, updateQuantity, clearCart } = useCart(restaurant?.id || null, tableId);

  useEffect(() => { loadData(); }, [slug]);
  
  useEffect(() => {
    if (activeOrders.length > 0 && !trackingOrderId) {
      setTrackingOrderId(activeOrders[0].id);
      setIsOrderActive(true);
    } else if (activeOrders.length === 0) {
      setIsOrderActive(false);
      setTrackingOrderId(null);
    }
  }, [activeOrders, trackingOrderId]);

  useEffect(() => {
    const activeOrderIds = activeOrderIdsKey ? activeOrderIdsKey.split(',') : [];
    if (!activeOrderIds.length) return;

    let cancelled = false;

    const syncStatuses = async () => {
      try {
        const results = await Promise.all(
          activeOrderIds.map(async (orderId) => {
            try {
              const order = activeOrders.find((item) => item.id === orderId);
              const response = await api.trackOrder(orderId, order?.trackingToken);
              return { id: orderId, status: response?.order?.status || null };
            } catch (error) {
              return { id: orderId, status: null };
            }
          })
        );

        if (cancelled) return;

        results.forEach((result) => {
          if (result?.status) {
            updateOrderStatus(result.id, result.status);
          }
        });
      } catch (error) {
        console.warn('[ORDER SYNC] Failed to refresh active orders:', error);
      }
    };

    syncStatuses();
    const intervalId = setInterval(syncStatuses, 10000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [activeOrderIdsKey, updateOrderStatus]);

  useEffect(() => {
    const fn = () => setNavSolid(window.scrollY > 100);
    window.addEventListener('scroll', fn);
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const scrollToCat = (id) => {
    setActiveCategory(id);
    const el = document.getElementById(`cat-${id}`);
    if (el) {
      window.scrollTo({ 
        top: el.offsetTop - (window.innerWidth < 1024 ? 180 : 100), 
        behavior: 'smooth' 
      });
    }
  };

  const loadData = async () => {
    try {
      const [r, m] = await Promise.all([
        api.getRestaurant(slug).catch(e => {
          if (e.status === 404) return { notFound: true };
          throw e;
        }),
        api.getPublicMenu(slug, qrToken).catch(e => {
          // If restaurant not found, menu will also fail
          if (e.status === 404) return { categories: [], uncategorized: [] };
          throw e;
        })
      ]);
      if (r.notFound) {
        setRestaurant('NOT_FOUND');
        return;
      }

      setRestaurant(r.restaurant);
      setCategories(m.categories || []);
      setUncategorized(m.uncategorized || []);
    } catch (e) {
      console.error('Restaurant load error:', e);
      setError(e.message || 'Unable to load restaurant');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (loading || !restaurant || !categories.length) return;
    const itemId = searchParams.get('item');
    if (itemId) {
      const allItems = [...uncategorized];
      categories.forEach(c => allItems.push(...(c.menuItems || [])));
      const item = allItems.find(i => i.id === itemId);
      if (item) {
        setViewingItem(item);
        setItemQty(1);
        setSelectedMods({});
        setSelectedVariant(item.variants?.length > 0 ? item.variants[0] : null);
        setModQtys({});
        setItemNotes('');
        setExpandedSections(createInitialExpandedSections(item));
        
        // Find category to scroll
        const cat = categories.find(c => c.menuItems?.some(i => i.id === itemId));
        if (cat) setTimeout(() => scrollToCat(cat.id), 500);
        else if (uncategorized.some(i => i.id === itemId)) setTimeout(() => scrollToCat('_other'), 500);
      }
    }
  }, [loading, restaurant, categories, uncategorized, searchParams]);

  useTheme(restaurant?.theme);

  const openItemModal = useCallback((item) => {
    setViewingItem(item);
    setItemQty(1);
    setSelectedMods({});
    setSelectedVariant(item.variants?.length > 0 ? item.variants[0] : null);
    setModQtys({});
    setItemNotes('');
    setExpandedSections(createInitialExpandedSections(item));
  }, []);

  const closeItemModal = useCallback(() => {
    setViewingItem(null);
    setItemQty(1);
    setSelectedMods({});
    setSelectedVariant(null);
    setModQtys({});
    setItemNotes('');
    setExpandedSections({});
  }, []);

  const toggleModalSection = useCallback((sectionKey) => {
    setExpandedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  }, []);

  const openFoodDetails = useCallback(() => {
    setExpandedSections((prev) => ({ ...prev, details: true }));
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        itemDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, []);

  const isModalValid = useMemo(() => {
    if (viewingItem?.variants?.length > 0 && !selectedVariant) return false;
    if (!viewingItem?.modifierGroups) return true;
    return viewingItem.modifierGroups.every(g => !g.isRequired || (selectedMods[g.name]?.length > 0));
  }, [viewingItem, selectedMods, selectedVariant]);

  const modalPrice = useMemo(() => {
    if (!viewingItem) return 0;
    
    let base = 0;
    if (viewingItem.variants?.length > 0) {
      base = parseFloat(selectedVariant?.price || 0);
    } else {
      base = parseFloat(viewingItem.basePrice || viewingItem.price || 0);
    }
    if (base < 0) base = 0;
    
    // Add modifier prices × their quantities
    viewingItem.modifierGroups?.forEach(g => {
      (selectedMods[g.name] || []).forEach(n => {
        const o = g.modifiers?.find(o => o.name === n);
        if (o) {
          const modQty = modQtys[`${g.name}_${n}`] || 1;
          const modPrice = parseFloat(o.price || 0);
          // ✅ CRITICAL: Multiply modifier price × modifier quantity
          base += modPrice * modQty;
        }
      });
    });
    
    // ✅ CRITICAL: Multiply total by item quantity
    const result = base * itemQty;
    return result < 0 ? 0 : result;
  }, [viewingItem, selectedMods, modQtys, itemQty, selectedVariant]);

  const selectedModifierLines = useMemo(() => {
    if (!viewingItem?.modifierGroups?.length) return [];

    return viewingItem.modifierGroups.flatMap((group) =>
      (selectedMods[group.name] || []).map((optionName) => {
        const option = group.modifiers?.find((entry) => entry.name === optionName);
        if (!option) return null;
        const quantity = modQtys[`${group.name}_${optionName}`] || 1;
        return {
          key: `${group.name}_${optionName}`,
          groupName: group.name,
          optionName,
          quantity,
          totalPrice: parseFloat(option.price || 0) * quantity * itemQty,
        };
      }).filter(Boolean)
    );
  }, [viewingItem, selectedMods, modQtys, itemQty]);

  const startingAtPrice = useMemo(() => {
    if (!viewingItem) return 0;
    if (viewingItem.variants?.length > 0) {
      return Math.min(...viewingItem.variants.map((variant) => parseFloat(variant.price || 0)));
    }
    return parseFloat(viewingItem.basePrice || viewingItem.price || 0);
  }, [viewingItem]);

  const currentBaseChoicePrice = useMemo(() => {
    if (!viewingItem) return 0;
    return selectedVariant
      ? parseFloat(selectedVariant.price || 0)
      : parseFloat(viewingItem.basePrice || viewingItem.price || 0);
  }, [viewingItem, selectedVariant]);

  const handleAddCustomizedItem = useCallback(() => {
    if (!viewingItem) return;

    const mods = [];
    if (Array.isArray(viewingItem.modifierGroups)) {
      viewingItem.modifierGroups.forEach((group) => {
        if (!group || !Array.isArray(group.modifiers)) return;
        const selectedForGroup = selectedMods[group.name] || [];
        selectedForGroup.forEach((name) => {
          const option = group.modifiers.find((entry) => entry && entry.name === name);
          if (!option) return;
          const quantity = modQtys[`${group.name}_${name}`] || 1;
          mods.push({
            group: group.name,
            option: option.name,
            price: parseFloat(option.price || 0),
            quantity,
          });
        });
      });
    }

    addItem(viewingItem, itemQty, mods, selectedVariant, itemNotes.trim());
    closeItemModal();
    toast.success('Added to Bag');
  }, [addItem, closeItemModal, itemNotes, itemQty, modQtys, selectedMods, selectedVariant, viewingItem]);

  const validateForm = () => {
    const newErrors = {};
    if (!name.trim()) newErrors.name = 'Full Name is required';
    
    const phoneRegex = /^(\+92|03)[0-9]{9,11}$/;
    const cleanPhone = phone.trim().replace(/[-\s]/g, '');
    
    if (!cleanPhone) {
      newErrors.phone = 'Phone number is required';
    } else if (!phoneRegex.test(cleanPhone)) {
      newErrors.phone = 'Valid phone required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /**
   * ✅ PRODUCTION-GRADE ORDER PLACEMENT
   * - Strict data normalization before sending
   * - Comprehensive validation and error handling
   * - Debug logging for troubleshooting
   * - User-friendly error messages
   */
  const normalizeOrderItem = (item) => {
    // Ensure every field follows strict contract
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid item format');
    }
    if (!item.menuItemId || typeof item.menuItemId !== 'string') {
      throw new Error('Item ID is required');
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error('Quantity must be a positive integer');
    }

    return {
      menuItemId: String(item.menuItemId).trim(),
      variantId: item.variantId ? String(item.variantId) : null,
      quantity: Math.floor(item.quantity),
      modifiers: Array.isArray(item.modifiers) ? item.modifiers.map(m => ({
        group: String(m.group || '').trim(),
        option: String(m.option || '').trim(),
        price: typeof m.price === 'number' ? m.price : 0,
        quantity: Number.isInteger(m.quantity) && m.quantity > 0 ? m.quantity : 1
      })) : [],
      notes: item.notes ? String(item.notes).trim().substring(0, 500) : null
    };
  };

  const handleOrder = async () => {
    setTouched(true);
    if (!validateForm()) {
      toast.error('Please fix the errors in the form');
      return;
    }
    if (!cartItems.length) {
      toast.error('Your bag is empty');
      return;
    }
    setPlacing(true);
    try {
      // ✅ Step 1: Normalize cart items to strict contract
      let normalizedItems;
      try {
        normalizedItems = cartItems.map(normalizeOrderItem);
      } catch (validationError) {
        throw new Error(`Cart validation error: ${validationError.message}`);
      }

      // ✅ Step 2: Build order payload with strict types
      const orderData = {
        restaurantId: String(restaurant.id).trim(),
        tableId: tableId ? String(tableId).trim() : null,
        qrToken,
        customerName: name ? String(name).trim().substring(0, 100) : null,
        customerPhone: phone ? String(phone).trim().substring(0, 20) : null,
        items: normalizedItems,
        notes: notes ? String(notes).trim().substring(0, 1000) : null
      };

      // ✅ Step 3: Validate payload shape before sending
      if (!Array.isArray(orderData.items) || orderData.items.length === 0) {
        throw new Error('Order must contain at least one item');
      }
      if (typeof orderData.restaurantId !== 'string' || !orderData.restaurantId) {
        throw new Error('Restaurant ID is missing');
      }

      // Persist the exact submission and its stable identifiers before the
      // network attempt. A timeout/retry reuses the same idempotency key.
      const pending = await getOrCreatePendingQrSubmission({
        restaurantId: restaurant.id,
        tableId,
        qrToken,
        payload: orderData,
      });
      await markQrSubmissionAttempt(pending.operationId);

      // ✅ Step 4: Send to API. The UI confirms only after server acceptance.
      let res;
      try {
        res = await api.placeOrder(pending.payload);
      } catch (requestError) {
        await markQrSubmissionAttempt(pending.operationId, requestError.message);
        if (requestError.code === 'NETWORK_UNAVAILABLE') {
          throw new Error('Order not yet placed. Your submission is safely stored on this device; tap Place order again when connected.');
        }
        throw requestError;
      }

      // ✅ Step 5: Validate API response
      if (!res) {
        throw new Error('No response from server');
      }
      if (!res.order || !res.order.id) {
        throw new Error('Invalid response format from server');
      }
      await acknowledgeQrSubmission(pending.operationId, res);

      // ✅ Step 6: Update UI state
      saveOrder(res.order.id, res.order.status, res.trackingToken);
      setTrackingOrderId(res.order.id);
      clearCart();
      setShowCart(false);
      setOrderPlaced(true);
      setShowTracker(true);
      setIsOrderActive(true);

      toast.success('Order Placed Successfully! You will be notified when it\'s ready.');
    } catch (e) {
      console.error('❌ Order placement failed:', {
        message: e.message,
        stack: e.stack,
        timestamp: new Date().toISOString()
      });

      // User-friendly error message
      const errorMessage = e.message
        .replace(/^Error: /, '')
        .replace(/options is not iterable/, 'Invalid item options format')
        .replace(/Cannot read property.*of undefined/, 'Missing required field')
        .substring(0, 150); // Limit length

      toast.error(errorMessage || 'Failed to place order. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  const allCats = useMemo(() => {
    const c = [...categories.filter(x => x.menuItems?.length > 0)];
    if (uncategorized.length) c.push({ id: '_other', name: 'Specialties', icon: '✨', menuItems: uncategorized });
    return c;
  }, [categories, uncategorized]);

  const filtered = useMemo(() => {
    let q = search.toLowerCase();
    return allCats.map(cat => ({
      ...cat,
      menuItems: (cat.menuItems || []).filter(i => i.name.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q)),
    })).filter(cat => cat.menuItems.length > 0);
  }, [allCats, search]);
  if (loading) return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-8 text-center">
       <div className="relative">
          <div className="absolute inset-0 bg-white/20 blur-3xl rounded-full animate-pulse" />
          <div className="w-16 h-16 border-4 border-white/10 border-t-white rounded-full animate-spin relative z-10" />
       </div>
    </div>
  );

  // Safety Measure: Invalid Table
  if (!tableId && restaurant !== 'NOT_FOUND') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-8 text-center">
        <div className="w-24 h-24 mb-6 glass rounded-full flex items-center justify-center">
           <span className="text-3xl">⚠️</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white mb-4">Invalid Table QR</h1>
        <p className="text-white/40 max-w-sm mx-auto mb-8">Please scan a valid table QR code to place an order. We need to know where to serve you!</p>
        <button onClick={() => window.location.reload()} className="px-8 py-3 glass rounded-xl text-xs font-black uppercase tracking-widest text-white">Retry Scan</button>
      </div>
    );
  }

  if (restaurant === 'NOT_FOUND') return notFound();

  if (error) return (
    <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center text-center p-10">
       <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6 border border-red-500/20">
          <span className="text-3xl">⚠️</span>
       </div>
       <h1 className="text-4xl font-extrabold text-white mb-4">Store Unavailable</h1>
       <p className="text-white/40 max-w-sm mx-auto mb-8">{error || "This store is currently unavailable or doesn't exist."}</p>
       <button onClick={() => window.location.reload()} className="px-8 py-3 glass rounded-xl text-xs font-black uppercase tracking-widest">Retry Connection</button>
    </div>
  );

  const theme = restaurant.theme || {};
  const primaryColor = theme.primaryColor || '#FF6B35';
  const contrastText = getContrastColor(primaryColor);
  const currencySymbol = getSymbol(restaurant);

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-white/20 font-sans antialiased">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@200;400;600;800&display=swap');
        body { font-family: 'Plus Jakarta Sans', sans-serif; background: #050505; color: white !important; }
        .glass { background: rgba(255, 255, 255, 0.12); backdrop-filter: blur(50px) saturate(210%); border: 2px solid rgba(255, 255, 255, 0.4); }
        .glass-dark { background: rgba(18, 18, 18, 0.9); backdrop-filter: blur(70px) saturate(180%); border: 2px solid rgba(255, 255, 255, 0.2); }
        .glow-card:hover { border-color: rgba(255, 255, 255, 0.6); box-shadow: 0 0 120px -30px ${primaryColor}55; }
        ::-webkit-scrollbar { width: 0px; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        .line-clamp-1 { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; }
        .line-clamp-2 { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        @media (max-width: 640px) {
          .hero-compact { min-height: 280px !important; height: 40vh !important; }
          .hero-title { font-size: 1.75rem !important; }
          .modal-mobile { border-radius: 24px !important; max-height: 92vh !important; margin: 16px !important; }
          .modal-img-mobile { aspect-ratio: 16/9 !important; max-height: 180px !important; }
          .modal-body-mobile { padding: 20px !important; max-height: 40vh; overflow-y: auto; }
          .modal-footer-mobile { padding: 14px 16px !important; }
          .cart-mobile { max-width: 100% !important; }
          .nav-cats { padding-top: 2px; padding-bottom: 2px; }
        }
      `}</style>

      {/* ── IMMERSIVE HERO ── */}
      <header className="relative h-[55vh] min-h-[400px] hero-compact overflow-hidden">
        <motion.div style={{ y: heroParallax, opacity: heroOpacity }} className="absolute inset-0 w-full h-[115%] -top-[7.5%]">
          <img src={restaurant.bannerUrl || '/default-hero.jpg'} className="w-full h-full object-cover" alt="" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/40 to-[#050505] z-10" />
          <div className="absolute inset-0 bg-gradient-to-tr from-black/60 to-transparent z-10" />
        </motion.div>

        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-center px-4 sm:px-6">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="p-2 sm:p-2.5 glass rounded-[24px] sm:rounded-[28px] mb-4 sm:mb-5 shadow-2xl relative">
             <div className="absolute inset-0 bg-white/5 rounded-[24px] sm:rounded-[28px] animate-pulse" />
             <img src={restaurant.logoUrl || '/default-logo.png'} className="w-16 h-16 sm:w-20 sm:h-20 rounded-[16px] sm:rounded-[20px] object-cover relative z-10 border border-white/10" alt="" />
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="hero-title text-3xl sm:text-4xl md:text-7xl font-extrabold tracking-tighter mb-3 sm:mb-4 leading-none text-white uppercase px-2">
            {restaurant.name}
          </motion.h1>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
             {table && <span className="glass px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-[9px] sm:text-[10px] font-black tracking-[0.2em] uppercase text-white/90">TABLE {table.tableNumber}</span>}
             <div className="flex items-center gap-2 glass px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-[9px] sm:text-[10px] font-black tracking-widest uppercase text-white/60">
                <span className={`w-2 h-2 rounded-full ${restaurant.isOpen !== false ? 'bg-emerald-500 animate-ping' : 'bg-red-500'}`} />
                {restaurant.isOpen !== false ? 'Open Now' : 'Closed'}
             </div>
          </motion.div>
        </div>
        <div className="absolute bottom-6 sm:bottom-8 left-1/2 -translate-x-1/2 z-20 text-2xl sm:text-3xl opacity-20">↓</div>

        {/* ── ACTIVE ORDER DETECTION PILL ── */}
        <AnimatePresence>
          {activeOrders.length > 0 && !showTracker && !showCart && (
            <motion.div 
              initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }}
              className="absolute top-8 inset-x-0 z-50 flex justify-center px-6"
            >
               <button 
                type="button"
                onClick={() => activeOrders.length > 1 ? setShowLookup(true) : setShowTracker(true)}
                className="bg-[#050505]/80 backdrop-blur-xl px-6 py-3 rounded-full flex items-center gap-3 border border-white/[0.08] shadow-[0_20px_50px_rgba(0,0,0,0.5)] active:scale-95 transition-all group pointer-events-auto"
               >
                  <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-ping" />
                  <span className="text-[10px] font-black tracking-widest text-white uppercase">
                    {activeOrders.length} ACTIVE {activeOrders.length === 1 ? 'ORDER' : 'ORDERS'}
                  </span>
                  <span className="text-white/20 text-xs group-hover:text-emerald-400 transition-colors">→</span>
               </button>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* ── STICKY NAV ── */}
      <nav className={`fixed top-0 inset-x-0 z-[100] transition-all duration-500 ${navSolid ? 'bg-[#050505]/95 backdrop-blur-xl border-b border-white/5 py-2' : 'bg-transparent py-4'}`}>
        <div className="max-w-7xl mx-auto px-4 flex flex-col lg:flex-row lg:items-center gap-y-3 lg:gap-x-8">
          <div className="flex items-center justify-between lg:justify-start gap-4">
             <div className="flex items-center gap-3">
                <img src={restaurant.logoUrl || '/default-logo.png'} className="w-9 h-9 rounded-lg object-cover border border-white/10" alt="" />
                <span className="text-sm font-black tracking-tight text-white uppercase truncate max-w-[120px] md:max-w-none">{restaurant.name}</span>
             </div>
             <div className="flex items-center gap-2 lg:hidden">
                <button type="button" aria-label="Search" onClick={() => setShowSearch(!showSearch)} className="w-11 h-11 glass rounded-xl flex items-center justify-center text-lg hover:bg-white/10 transition-colors">🔍</button>
                <button type="button" aria-label="Cart" onClick={() => setShowCart(true)} className="w-11 h-11 glass rounded-xl flex items-center justify-center text-lg relative hover:bg-white/10 transition-colors">
                   🛒 {count > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-white text-black text-[10px] font-black rounded-full flex items-center justify-center border-2 border-black">{count}</span>}
                </button>
             </div>
          </div>

          <div className="flex-1 overflow-x-auto scrollbar-hide py-1 -mx-4 px-4 lg:mx-0 lg:px-0">
             <div className="flex items-center gap-2 lg:gap-3 min-w-max">
                {allCats.map(cat => (
                   <button
                    type="button"
                    key={cat.id}
                    onClick={() => scrollToCat(cat.id)}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-[9px] sm:text-[10px] font-black tracking-widest uppercase transition-all whitespace-nowrap border border-transparent hover:border-white/20 flex items-center gap-1.5 sm:gap-2 shrink-0"
                    style={{ 
                      backgroundColor: activeCategory === cat.id ? primaryColor : 'rgba(255,255,255,0.05)',
                      color: activeCategory === cat.id ? contrastText : 'rgba(255,255,255,0.6)'
                    }}
                  >
                    {cat.name}
                    <span className={`px-1.5 py-0.5 rounded-md text-[8px] ${activeCategory === cat.id ? 'bg-black/20 text-white' : 'bg-white/10 text-white/40'}`}>
                       {cat.menuItems?.length || 0}
                    </span>
                  </button>
                ))}
             </div>
          </div>

          <div className="flex items-center gap-3">
             <button 
              type="button"
              onClick={() => {
                if (activeOrders.length === 0) setShowLookup(true);
                else if (activeOrders.length === 1) { setTrackingOrderId(activeOrders[0].id); setShowTracker(true); setIsOrderActive(true); }
                else setShowLookup(true);
              }} 
              className="w-full lg:w-auto h-12 lg:h-11 px-6 bg-white/5 hover:bg-white/10 border border-white/[0.08] rounded-xl text-[10px] font-black tracking-widest uppercase text-white/60 hover:text-white transition-all shadow-xl lg:shadow-none"
             >
                 {activeOrders.length > 0 ? 'TRACK STATUS' : 'TRACK ORDER'}
             </button>

             <div className="hidden lg:flex items-center gap-2">
                <button type="button" aria-label="Search" onClick={() => setShowSearch(!showSearch)} className="w-11 h-11 glass rounded-xl flex items-center justify-center text-lg hover:bg-white/10 transition-colors">🔍</button>
                <motion.button 
                  type="button"
                  whileTap={{ scale: 0.95 }} 
                  onClick={() => setShowCart(true)} 
                  className="h-11 glass rounded-xl px-5 flex items-center gap-3 hover:bg-white/10 transition-all"
                >
                   <span className="text-xl">🛒</span>
                   <span className="text-[10px] font-black tracking-widest uppercase text-white">Full Bag</span>
                   {count > 0 && <span className="bg-white text-black px-2 py-0.5 rounded-md text-[10px] font-black border border-black/10">{count}</span>}
                </motion.button>
             </div>
          </div>
        </div>

        <AnimatePresence>
          {showSearch && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-4 px-4 relative flex items-center">
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search dishes..." className="w-full glass rounded-xl px-5 py-4 text-sm focus:outline-none focus:border-white/20 placeholder-white/20 pr-12" />
              <button 
                type="button" 
                onClick={() => { setSearch(''); setShowSearch(false); }} 
                className="absolute right-8 w-8 h-8 flex items-center justify-center text-white/40 hover:text-white transition-colors z-[110]"
                aria-label="Close search"
              >
                ✕
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-12 sm:py-16 pb-36 sm:pb-40">
        <AnimatePresence mode="popLayout">
          {filtered.map(cat => (
            <motion.section key={cat.id} id={`cat-${cat.id}`} className="mb-10 sm:mb-14" initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
              <div className="flex flex-col mb-5 sm:mb-7 border-l-2 border-white/10 pl-4 sm:pl-5">
                 <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tighter text-white uppercase">{cat.name}</h2>
                 <span className="text-[8px] font-black text-white/20 uppercase tracking-[0.4em] mt-1">{cat.menuItems.length} ITEMS</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-2.5 sm:gap-3 md:gap-5">
                {cat.menuItems.map(item => (
                  <motion.article key={item.id} className="group glass-dark rounded-[18px] sm:rounded-[24px] overflow-hidden flex flex-col border border-white/5 relative shadow-xl cursor-pointer" onClick={() => openItemModal(item)}>
                    <div className="relative aspect-square overflow-hidden bg-white/5">
                       {item.imageUrl ? <img src={item.imageUrl} className="w-full h-full object-cover transition-transform group-hover:scale-105" alt="" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-3xl sm:text-4xl grayscale opacity-10">{getEmoji(item.name)}</div>}
                       {item.modelUrl && (
                         <button 
                           type="button"
                           onClick={(e) => { e.stopPropagation(); setViewing3D(item); }}
                           className="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-2 py-1 rounded-md text-[8px] font-black uppercase text-emerald-400 border border-emerald-500/20 hover:scale-110 transition-transform flex items-center gap-1"
                         >
                            <span>📦</span> 3D
                         </button>
                       )}
                    </div>
                    <div className="p-2.5 sm:p-3 md:p-4 flex-1 flex flex-col min-w-0">
                       <h3 className="text-xs sm:text-sm md:text-base font-bold text-white capitalize line-clamp-2 mb-1 leading-tight">{item.name.toLowerCase()}</h3>
                       {item.description && <p className="text-[9px] sm:text-[10px] text-white/30 line-clamp-1 mb-1.5 hidden sm:block">{item.description}</p>}
                       <span className="text-sm sm:text-base font-black text-white mb-2 sm:mb-3">
                         {item.variants?.length > 0 
                           ? `From ${fmt(Math.min(...item.variants.map(v => parseFloat(v.price))), restaurant)}`
                           : fmt(item.basePrice || item.price, restaurant)
                         }
                       </span>
                       <div className="mt-auto">
                          <button type="button" onClick={(e) => { e.stopPropagation(); openItemModal(item); }} className="w-full py-1.5 sm:py-2 rounded-lg text-[8px] sm:text-[9px] font-black uppercase transition-all bg-white/5 border border-white/10 hover:bg-white hover:text-black">
                             Customize
                          </button>
                       </div>
                    </div>
                  </motion.article>
                ))}
              </div>
            </motion.section>
          ))}
        </AnimatePresence>
      </main>

      {/* ── MODALS ── */}
      <AnimatePresence>
        {viewingItem && (
          <div className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center p-0 sm:p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/88 backdrop-blur-2xl" onClick={closeItemModal} />
             <motion.div
               initial={{ opacity: 0, y: 56, scale: 0.98 }}
               animate={{ opacity: 1, y: 0, scale: 1 }}
               exit={{ opacity: 0, y: 56, scale: 0.98 }}
               className="relative w-full h-[94dvh] sm:h-auto sm:max-h-[92vh] sm:max-w-2xl bg-[#080808] border border-white/10 shadow-[0_35px_120px_rgba(0,0,0,0.65)] rounded-t-[32px] sm:rounded-[32px] overflow-hidden flex flex-col"
             >
                <div className="flex justify-center pt-3 sm:pt-0">
                  <div className="h-1.5 w-12 rounded-full bg-white/20 sm:hidden" />
                </div>

                <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-3 sm:pt-4 pb-3 border-b border-white/8 shrink-0">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.26em] text-white/35">Customize Item</p>
                    <p className="text-sm sm:text-base text-white/70 truncate">Review options before adding to your bag</p>
                  </div>
                  <button type="button" onClick={closeItemModal} className="w-10 h-10 rounded-2xl bg-white/6 border border-white/10 text-white flex items-center justify-center hover:bg-white/12 transition-colors shrink-0">✕</button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 sm:px-5 pb-32 sm:pb-28 space-y-4 sm:space-y-5">
                  <section className="mt-4 rounded-[26px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.10),rgba(255,255,255,0.02)_48%,rgba(0,0,0,0.18))] overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                    <div className="relative aspect-[16/10] max-h-[220px] bg-[#111111]">
                      {viewingItem.imageUrl ? (
                        <img src={viewingItem.imageUrl} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-6xl opacity-20">{getEmoji(viewingItem.name)}</div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/35 to-transparent" />
                      <div className="absolute inset-x-0 top-0 p-4 flex items-start justify-between gap-3">
                        <div className="flex flex-wrap gap-2">
                          <span className="px-2.5 py-1 rounded-full bg-black/45 backdrop-blur text-[9px] font-black uppercase tracking-[0.22em] text-white/80 border border-white/10">Chef Pick</span>
                          {viewingItem.variants?.length > 0 && (
                            <span className="px-2.5 py-1 rounded-full bg-white/10 backdrop-blur text-[9px] font-black uppercase tracking-[0.22em] text-white/70 border border-white/10">
                              {viewingItem.variants.length} size{viewingItem.variants.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        {viewingItem.modelUrl && (
                          <button
                            type="button"
                            onClick={() => setViewing3D(viewingItem)}
                            className="h-9 px-3 rounded-2xl bg-emerald-500/18 backdrop-blur text-emerald-100 border border-emerald-400/20 text-[10px] font-black tracking-[0.18em] uppercase flex items-center gap-2 shadow-xl active:scale-95 transition-all"
                          >
                            <span>📦</span> 3D View
                          </button>
                        )}
                      </div>
                      <div className="absolute inset-x-0 bottom-0 p-4">
                        <h2 className="text-[1.65rem] sm:text-[2rem] font-black tracking-tight text-white leading-[0.98]">{viewingItem.name}</h2>
                        <p className="mt-2 text-sm sm:text-[15px] text-white/72 leading-relaxed line-clamp-2">
                          {viewingItem.description || 'Made fresh to order with premium ingredients.'}
                        </p>
                      </div>
                    </div>

                    <div className="p-4 space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/38">Starting from</p>
                          <p className="mt-1 text-xl font-black text-white">{fmt(startingAtPrice, restaurant)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/38">Current choice</p>
                          <p className="mt-1 text-sm font-bold text-white">{selectedVariant?.name || 'Standard'}</p>
                          <p className="text-xs text-white/45">{selectedModifierLines.length} selected add-on{selectedModifierLines.length === 1 ? '' : 's'}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => viewingItem.modelUrl && setViewing3D(viewingItem)}
                          disabled={!viewingItem.modelUrl}
                          className="h-11 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-[10px] font-black uppercase tracking-[0.18em] text-white flex items-center justify-center gap-2 disabled:opacity-35 disabled:cursor-not-allowed hover:bg-white/[0.08] transition-colors"
                        >
                          <span>📦</span> 3D View
                        </button>
                        <button
                          type="button"
                          onClick={openFoodDetails}
                          className="h-11 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-[10px] font-black uppercase tracking-[0.18em] text-white flex items-center justify-center gap-2 hover:bg-white/[0.08] transition-colors"
                        >
                          <span>ℹ️</span> Food Details
                        </button>
                      </div>
                    </div>
                  </section>

                  {viewingItem.variants?.length > 0 && (
                    <section className="rounded-[24px] border border-white/10 bg-white/[0.03] backdrop-blur-sm overflow-hidden">
                      <button type="button" onClick={() => toggleModalSection('size')} className="w-full px-4 py-4 flex items-center justify-between gap-3 text-left">
                        <div>
                          <p className="text-sm font-bold text-white">Choose Size</p>
                          <p className="text-[11px] text-white/45">{viewingItem.variants.length} options available</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="px-2.5 py-1 rounded-full bg-white/6 border border-white/10 text-[10px] font-black uppercase tracking-[0.18em] text-white/65">{selectedVariant?.name || 'Required'}</span>
                          <span className={`text-sm text-white/45 transition-transform ${expandedSections.size ? 'rotate-180' : ''}`}>⌄</span>
                        </div>
                      </button>
                      <AnimatePresence initial={false}>
                        {expandedSections.size && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <div className="px-4 pb-4 grid gap-2.5">
                              {viewingItem.variants.map((variant) => {
                                const selected = selectedVariant?.id === variant.id;
                                return (
                                  <button
                                    type="button"
                                    key={variant.id}
                                    onClick={() => setSelectedVariant(variant)}
                                    className={`w-full rounded-[20px] border px-3.5 py-3 text-left transition-all ${selected ? 'shadow-[0_16px_40px_rgba(0,0,0,0.28)]' : 'hover:bg-white/[0.04]'}`}
                                    style={selected ? { borderColor: `${primaryColor}55`, background: `${primaryColor}1c` } : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${selected ? 'border-white' : 'border-white/25'}`}>
                                        {selected && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="font-bold text-white truncate">{variant.name}</p>
                                        <p className="text-[11px] text-white/45">Sized for your appetite</p>
                                      </div>
                                      <span className="text-sm font-black text-white shrink-0">{fmt(variant.price, restaurant)}</span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </section>
                  )}

                  {(viewingItem.modifierGroups || []).map((group) => {
                    const layout = getModifierGroupLayout(group.name);
                    const limit = group.maxSelection || group.maxSelectable || null;
                    const selectedForGroup = selectedMods[group.name] || [];
                    const isOpen = expandedSections[group.name] ?? false;

                    return (
                      <section key={group.name} className="rounded-[24px] border border-white/10 bg-white/[0.03] backdrop-blur-sm overflow-hidden">
                        <button type="button" onClick={() => toggleModalSection(group.name)} className="w-full px-4 py-4 flex items-center justify-between gap-3 text-left">
                          <div>
                            <p className="text-sm font-bold text-white">
                              {group.name}
                              {group.isRequired && <span className="text-orange-400"> *</span>}
                            </p>
                            <p className="text-[11px] text-white/45">{getModifierGroupRule(group)}</p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="px-2.5 py-1 rounded-full bg-white/6 border border-white/10 text-[10px] font-black uppercase tracking-[0.18em] text-white/65">
                              {selectedForGroup.length ? `${selectedForGroup.length} selected` : 'Open'}
                            </span>
                            <span className={`text-sm text-white/45 transition-transform ${isOpen ? 'rotate-180' : ''}`}>⌄</span>
                          </div>
                        </button>

                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className={`px-4 pb-4 ${layout === 'card' ? 'grid grid-cols-2 gap-2.5' : layout === 'chip' ? 'flex flex-wrap gap-2.5' : 'grid gap-2.5'}`}>
                                {group.modifiers.map((option) => {
                                  const selected = selectedForGroup.includes(option.name);
                                  const qtyKey = `${group.name}_${option.name}`;
                                  const quantity = modQtys[qtyKey] || 1;
                                  const isSingleSelect = limit === 1;

                                  const handleToggle = () => {
                                    const current = selectedMods[group.name] || [];
                                    const nextSelections = (() => {
                                      if (isSingleSelect) {
                                        if (selected && !group.isRequired) return [];
                                        return [option.name];
                                      }
                                      if (selected) {
                                        return current.filter((name) => name !== option.name);
                                      }
                                      if (limit && current.length >= limit) {
                                        return current;
                                      }
                                      return [...current, option.name];
                                    })();

                                    setSelectedMods((prev) => ({ ...prev, [group.name]: nextSelections }));
                                    if (selected && nextSelections.length !== current.length) {
                                      setModQtys((prev) => {
                                        const next = { ...prev };
                                        delete next[qtyKey];
                                        return next;
                                      });
                                    }
                                  };

                                  const cardStyle = selected
                                    ? { borderColor: `${primaryColor}55`, background: `${primaryColor}18` }
                                    : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' };

                                  if (layout === 'chip') {
                                    return (
                                      <button
                                        type="button"
                                        key={option.name}
                                        onClick={handleToggle}
                                        className={`rounded-[18px] border px-3.5 py-2.5 text-left transition-all ${selected ? 'shadow-[0_12px_30px_rgba(0,0,0,0.24)]' : 'hover:bg-white/[0.04]'}`}
                                        style={cardStyle}
                                      >
                                        <span className="block text-sm font-bold text-white">{option.name}</span>
                                        <span className="block text-[11px] text-white/52 mt-1">{fmtModifier(option.price, currencySymbol)}</span>
                                      </button>
                                    );
                                  }

                                  return (
                                    <div
                                      key={option.name}
                                      className={`rounded-[20px] border px-3.5 py-3 transition-all ${selected ? 'shadow-[0_16px_36px_rgba(0,0,0,0.28)]' : 'hover:bg-white/[0.04]'}`}
                                      style={cardStyle}
                                    >
                                      <div className={`flex items-start gap-3 ${layout === 'card' ? 'flex-col h-full' : 'items-center'}`}>
                                        <button type="button" onClick={handleToggle} className={`flex ${layout === 'card' ? 'flex-col items-start gap-3 h-full' : 'items-center gap-3'} flex-1 min-w-0 text-left`}>
                                          <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${selected ? 'border-white' : 'border-white/25'}`}>
                                            {selected && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
                                          </div>
                                          <div className="min-w-0 flex-1">
                                            <p className="font-bold text-white truncate">{option.name}</p>
                                            <p className="text-[11px] text-white/52 mt-1">{fmtModifier(option.price, currencySymbol)}</p>
                                          </div>
                                        </button>

                                        {selected && layout !== 'chip' && !isSingleSelect && (
                                          <div className="flex items-center gap-1 rounded-2xl bg-black/25 border border-white/10 p-1 shrink-0">
                                            <button type="button" onClick={() => setModQtys((prev) => ({ ...prev, [qtyKey]: Math.max(1, quantity - 1) }))} className="w-7 h-7 rounded-xl text-sm font-black text-white/80 hover:bg-white/10">−</button>
                                            <span className="w-6 text-center text-sm font-black text-white">{quantity}</span>
                                            <button type="button" onClick={() => setModQtys((prev) => ({ ...prev, [qtyKey]: Math.min(99, quantity + 1) }))} className="w-7 h-7 rounded-xl text-sm font-black text-white/80 hover:bg-white/10">+</button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </section>
                    );
                  })}

                  <section ref={itemDetailsRef} className="rounded-[24px] border border-white/10 bg-white/[0.03] backdrop-blur-sm overflow-hidden">
                    <button type="button" onClick={() => toggleModalSection('details')} className="w-full px-4 py-4 flex items-center justify-between gap-3 text-left">
                      <div>
                        <p className="text-sm font-bold text-white">Food Details</p>
                        <p className="text-[11px] text-white/45">Description, allergens, and selection overview</p>
                      </div>
                      <span className={`text-sm text-white/45 transition-transform ${expandedSections.details ? 'rotate-180' : ''}`}>⌄</span>
                    </button>
                    <AnimatePresence initial={false}>
                      {expandedSections.details && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="px-4 pb-4 space-y-3">
                            <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/38 mb-2">About This Dish</p>
                              <p className="text-sm leading-relaxed text-white/72">{viewingItem.description || 'Freshly prepared and served to order.'}</p>
                            </div>

                            {Array.isArray(viewingItem.allergens) && viewingItem.allergens.length > 0 && (
                              <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/38 mb-2">Allergens</p>
                                <div className="flex flex-wrap gap-2">
                                  {viewingItem.allergens.map((allergen) => (
                                    <span key={allergen} className="px-2.5 py-1 rounded-full bg-white/6 border border-white/10 text-[11px] text-white/70">
                                      {allergen}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                              <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/38 mb-2">Price</p>
                                <p className="text-base font-black text-white">{fmt(currentBaseChoicePrice, restaurant)}</p>
                              </div>
                              <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/38 mb-2">Customization</p>
                                <p className="text-base font-black text-white">{viewingItem.modifierGroups?.length || 0} section{(viewingItem.modifierGroups?.length || 0) === 1 ? '' : 's'}</p>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </section>

                  <section className="rounded-[24px] border border-white/10 bg-white/[0.03] backdrop-blur-sm p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-white">Special Instructions</p>
                        <p className="text-[11px] text-white/45">Keep it concise so the kitchen can follow it easily.</p>
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35 shrink-0">{itemNotes.length}/140</span>
                    </div>
                    <textarea
                      value={itemNotes}
                      onChange={(e) => setItemNotes(e.target.value.slice(0, 140))}
                      placeholder="No onions, extra crispy, sauce on the side"
                      className="w-full min-h-[88px] rounded-[18px] border border-white/10 bg-black/25 px-3.5 py-3 text-sm text-white placeholder:text-white/28 resize-none focus:outline-none focus:border-white/20"
                    />
                  </section>

                  {selectedModifierLines.length > 0 && (
                    <section className="rounded-[24px] border border-white/10 bg-black/20 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-bold text-white">Selected Extras</p>
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">{selectedModifierLines.length} chosen</span>
                      </div>
                      <div className="space-y-2">
                        {selectedModifierLines.map((line) => (
                          <div key={line.key} className="flex items-center justify-between gap-3 rounded-[18px] bg-white/[0.03] border border-white/8 px-3 py-2.5">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white truncate">{line.quantity > 1 ? `${line.quantity}× ` : ''}{line.optionName}</p>
                              <p className="text-[11px] text-white/42 truncate">{line.groupName}</p>
                            </div>
                            <span className="text-sm font-black text-white shrink-0">{fmt(line.totalPrice, restaurant)}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>

                <div className="absolute inset-x-0 bottom-0 shrink-0 border-t border-white/8 bg-[#080808]/92 backdrop-blur-2xl px-4 sm:px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                  <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-2.5 items-center">
                    <div className="flex items-center gap-1 rounded-[20px] border border-white/10 bg-black/25 p-1">
                      <button type="button" onClick={() => setItemQty(Math.max(1, itemQty - 1))} className="w-10 h-10 rounded-2xl text-lg font-black text-white/80 hover:bg-white/10 transition-colors">−</button>
                      <span className="w-7 text-center text-sm font-black text-white">{itemQty}</span>
                      <button type="button" onClick={() => setItemQty(Math.min(99, itemQty + 1))} disabled={itemQty >= 99} className="w-10 h-10 rounded-2xl text-lg font-black text-white/80 hover:bg-white/10 transition-colors disabled:opacity-40">+</button>
                    </div>

                    <div className="min-w-[96px] rounded-[20px] border border-white/10 bg-black/25 px-3 py-2.5">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/38">Total</p>
                      <p className="text-base font-black text-white mt-0.5">{fmt(modalPrice, restaurant)}</p>
                    </div>

                    <button
                      type="button"
                      disabled={!isModalValid}
                      onClick={handleAddCustomizedItem}
                      className={`min-w-0 h-[60px] rounded-[20px] font-black text-[11px] sm:text-xs tracking-[0.2em] uppercase transition-all ${!isModalValid ? 'opacity-35 cursor-not-allowed' : 'active:scale-[0.99] shadow-[0_18px_40px_rgba(0,0,0,0.28)]'}`}
                      style={{ background: primaryColor, color: contrastText }}
                    >
                      {isModalValid ? 'Add To Bag' : 'Choose Required Options'}
                    </button>
                  </div>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── BAG SIDEBAR ── */}
      <AnimatePresence>
        {showCart && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 backdrop-blur-xl z-[600]" onClick={() => setShowCart(false)} />
            <motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} className="cart-mobile fixed right-0 top-0 h-full w-full max-w-lg bg-[#050505] z-[601] flex flex-col border-l border-white/5">
                <div className="p-5 sm:p-8 border-b border-white/5 flex items-center justify-between shrink-0 bg-white/2">
                   <div className="flex items-center gap-3 sm:gap-5">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 glass rounded-2xl flex items-center justify-center text-lg sm:text-xl">🛍️</div>
                      <div>
                        <h2 className="text-xl sm:text-2xl font-black text-white uppercase tracking-tighter leading-none">Your Bag</h2>
                        <p className="text-[9px] sm:text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mt-1 sm:mt-2">{count} ITEMS SELECTED</p>
                      </div>
                   </div>
                   <button type="button" onClick={() => setShowCart(false)} className="w-10 h-10 sm:w-12 sm:h-12 glass rounded-2xl flex items-center justify-center hover:bg-white/10 transition-colors z-[700]">✕</button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2 sm:space-y-3">
                   {cartItems.map(ci => (
                     <div key={ci.cartId} className="glass-dark p-2.5 sm:p-3 rounded-xl sm:rounded-2xl border border-white/5">
                        <div className="flex items-center gap-3 sm:gap-4">
                           <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg sm:rounded-xl bg-white/5 flex items-center justify-center overflow-hidden shrink-0">
                              {ci.imageUrl ? <img src={ci.imageUrl} className="w-full h-full object-cover" alt="" /> : <span className="text-xl sm:text-2xl">{getEmoji(ci.name)}</span>}
                           </div>
                           <div className="flex-1 min-w-0">
                              <p className="font-bold text-xs sm:text-sm text-white truncate">{ci.name}</p>
                              {ci.variantName && (
                                <p className="text-[9px] sm:text-[10px] text-amber-400/70 font-bold mt-0.5">{ci.variantName}</p>
                              )}
                              {ci.modifiers && ci.modifiers.length > 0 && (
                                <p className="text-[9px] sm:text-[10px] text-white/40 mt-0.5 truncate">
                                  {ci.modifiers.map(m => m.quantity && m.quantity > 1 ? `${m.quantity}× ${m.option}` : m.option).join(' • ')}
                                </p>
                              )}
                              {ci.notes && (
                                <p className="text-[9px] sm:text-[10px] text-white/55 mt-1 line-clamp-2">
                                  Note: {ci.notes}
                                </p>
                              )}
                              <p className="text-amber-400 font-black text-xs sm:text-sm mt-1">{fmt(ci.price * ci.quantity, restaurant)}</p>
                           </div>
                           <div className="flex items-center gap-1.5 sm:gap-2 glass p-1 rounded-lg sm:rounded-xl shrink-0">
                              <button type="button" onClick={() => updateQuantity(ci.cartId, ci.quantity-1)} className="w-6 h-6 sm:w-7 sm:h-7 text-sm">−</button>
                              <span className="w-4 text-center font-bold text-[10px] sm:text-xs">{ci.quantity}</span>
                              <button type="button" onClick={() => updateQuantity(ci.cartId, ci.quantity+1)} className="w-6 h-6 sm:w-7 sm:h-7 text-sm">+</button>
                           </div>
                        </div>
                     </div>
                   ))}
                </div>
                {cartItems.length > 0 && (
                  <div className="p-4 sm:p-6 border-t border-white/5 space-y-4 sm:space-y-5 shrink-0 overflow-y-auto max-h-[60vh]">
                     <div className="space-y-2 sm:space-y-3">
                        <div className="grid grid-cols-2 gap-2 sm:gap-3 items-start">
                           <div className="space-y-1">
                              <input value={name} onChange={e => { setName(e.target.value); if (errors.name) setErrors({...errors, name: ''}); }} placeholder="Full Name" className={`w-full h-10 sm:h-11 bg-white/5 border ${errors.name ? 'border-red-500/50' : 'border-white/10'} rounded-lg sm:rounded-xl px-3 sm:px-4 text-xs sm:text-sm`} />
                              {errors.name && <p className="text-[9px] sm:text-[10px] text-red-500 px-1 font-bold">{errors.name}</p>}
                           </div>
                           <div className="space-y-1">
                              <input value={phone} onChange={e => { setPhone(e.target.value); if (errors.phone) setErrors({...errors, phone: ''}); }} placeholder="Phone" className={`w-full h-10 sm:h-11 bg-white/5 border ${errors.phone ? 'border-red-500/50' : 'border-white/10'} rounded-lg sm:rounded-xl px-3 sm:px-4 text-xs sm:text-sm`} />
                              {errors.phone && <p className="text-[9px] sm:text-[10px] text-red-500 px-1 font-bold">{errors.phone}</p>}
                           </div>
                        </div>
                     </div>

                     {/* ── PROMO CODE ── */}
                     <div className="flex gap-2">
                        <input value={promoCode} onChange={e => { setPromoCode(e.target.value.toUpperCase()); setPromoError(''); }} placeholder="PROMO CODE" className="flex-1 h-10 sm:h-11 bg-white/5 border border-white/10 rounded-lg sm:rounded-xl px-3 sm:px-4 text-[10px] sm:text-xs font-bold tracking-widest uppercase" />
                        <button type="button" disabled={promoLoading || !promoCode.trim()} onClick={async () => {
                          setPromoLoading(true); setPromoError('');
                          try {
                            const res = await api.validatePromo(restaurant.id, promoCode, total, tableId, qrToken);
                            if (res.valid) { setPromoResult(res.promo); toast.success(`Promo applied: ${res.promo.description}`); }
                          } catch (e) { setPromoError(e.message || 'Invalid promo'); setPromoResult(null); }
                          finally { setPromoLoading(false); }
                        }} className="h-10 sm:h-11 px-3 sm:px-5 bg-white/10 border border-white/10 rounded-lg sm:rounded-xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-all disabled:opacity-30">
                          {promoLoading ? '...' : 'Apply'}
                        </button>
                     </div>
                     {promoError && <p className="text-[9px] sm:text-[10px] text-red-400 font-bold px-1">❌ {promoError}</p>}
                     {promoResult && (
                       <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 rounded-lg sm:rounded-xl px-3 sm:px-4 py-2">
                         <span className="text-[9px] sm:text-[10px] font-black text-emerald-400 uppercase tracking-widest truncate">🎟️ {promoResult.code} — {promoResult.description}</span>
                         <button type="button" onClick={() => { setPromoResult(null); setPromoCode(''); }} className="text-white/40 hover:text-white text-xs ml-2 shrink-0">✕</button>
                       </div>
                     )}

                     {/* ── BILLING BREAKDOWN ── */}
                     <div className="space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
                       <div className="flex justify-between text-white/50">
                         <span>Subtotal</span>
                         <span className="text-white/80 font-bold">{fmt(total, restaurant)}</span>
                       </div>
                       {parseFloat(restaurant?.taxPercent || 0) > 0 && (
                         <div className="flex justify-between text-white/40">
                           <span>Tax ({parseFloat(restaurant.taxPercent)}%)</span>
                           <span>{fmt(Math.round(total * parseFloat(restaurant.taxPercent) / 100 * 100) / 100, restaurant)}</span>
                         </div>
                       )}
                       {parseFloat(restaurant?.serviceChargePercent || 0) > 0 && (
                         <div className="flex justify-between text-white/40">
                           <span>Service ({parseFloat(restaurant.serviceChargePercent)}%)</span>
                           <span>{fmt(Math.round(total * parseFloat(restaurant.serviceChargePercent) / 100 * 100) / 100, restaurant)}</span>
                         </div>
                       )}
                       {parseFloat(restaurant?.serviceFeeFixed || 0) > 0 && (
                         <div className="flex justify-between text-white/40">
                           <span>Service Fee</span>
                           <span>{fmt(parseFloat(restaurant.serviceFeeFixed), restaurant)}</span>
                         </div>
                       )}
                       {promoResult && (
                         <div className="flex justify-between text-emerald-400">
                           <span>Discount</span>
                           <span>-{fmt(promoResult.discount, restaurant)}</span>
                         </div>
                       )}
                       <div className="border-t border-white/10 pt-2 sm:pt-3 flex justify-between items-center">
                         <span className="text-[9px] sm:text-[10px] font-black text-white/50 uppercase tracking-widest">Grand Total</span>
                         <span className="text-white text-xl sm:text-2xl tracking-tighter font-black">{fmt(
                           Math.max(0,
                             total
                             + Math.round(total * parseFloat(restaurant?.taxPercent || 0) / 100 * 100) / 100
                             + Math.round(total * parseFloat(restaurant?.serviceChargePercent || 0) / 100 * 100) / 100
                             + parseFloat(restaurant?.serviceFeeFixed || 0)
                             - (promoResult?.discount || 0)
                           ), restaurant
                         )}</span>
                       </div>
                     </div>

                     <button type="button" disabled={placing} onClick={handleOrder} className="w-full h-12 sm:h-14 rounded-xl sm:rounded-2xl font-black uppercase text-xs sm:text-sm tracking-widest shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all" style={{ background: primaryColor, color: contrastText }}>
                        {placing ? <span className="animate-spin">⚙️</span> : 'Place Order'}
                     </button>
                  </div>
                )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(showTracker || showLookup) && (
          <div className="fixed inset-0 z-[800] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/95 backdrop-blur-3xl" onClick={() => { setShowTracker(false); setShowLookup(false); }} />
             {showLookup ? (
               <motion.div initial={{ scale: 0.9, opacity: 0, y: 40 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 40 }} className="relative bg-[#050505] rounded-[40px] w-full max-w-md p-8 text-center shadow-2xl border border-white/[0.08]">
                  {activeOrders.length > 0 && lookupId === '' ? (
                    <div className="space-y-6 text-center">
                       <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-4">Active Orders</h2>
                       <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                          {activeOrders.map(o => (
                            <button key={o.id} onClick={() => { setTrackingOrderId(o.id); setShowLookup(false); setShowTracker(true); setIsOrderActive(true); }} className="w-full bg-white/[0.03] p-4 rounded-xl flex items-center justify-between group hover:bg-white/[0.08] transition-all border border-white/[0.08]">
                               <div className="text-left">
                                  <p className="text-[10px] text-white/30 mb-1">#{o.id.slice(-4).toUpperCase()}</p>
                                  <p className="font-bold uppercase text-[11px] tracking-widest text-white/60 group-hover:text-white">{o.status}</p>
                               </div>
                               <span className="text-[#22c55e] group-hover:translate-x-1 transition-transform">➔</span>
                            </button>
                          ))}
                       </div>
                       <button type="button" onClick={() => setLookupId('NEW')} className="text-[9px] font-black tracking-widest text-white/40 hover:text-white uppercase transition-colors">Track another ID?</button>
                    </div>
                  ) : (
                    <>
                       <h2 className="text-3xl font-black uppercase mb-4 tracking-tighter text-white">Track Order</h2>
                       <input autoFocus value={lookupId==='NEW'?'':lookupId} onChange={e => setLookupId(e.target.value.toUpperCase())} placeholder="ORDER ID" className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-6 py-4 text-lg font-black text-center mb-6 text-white focus:outline-none focus:border-[#22c55e]/50 transition-colors" />
                       <button type="button" onClick={() => { if(lookupId.length<4) return; setTrackingOrderId(lookupId); setShowLookup(false); setShowTracker(true); }} className="w-full py-5 rounded-2xl font-black text-lg shadow-xl bg-white text-black hover:bg-white/90 active:scale-[0.98] transition-all">SEARCH</button>
                       {activeOrders.length > 0 && <button type="button" onClick={() => setLookupId('')} className="mt-4 text-[10px] uppercase text-white/30 hover:text-white transition-colors underline underline-offset-4">Back to active</button>}
                    </>
                  )}
                  <button type="button" onClick={() => setShowLookup(false)} className="mt-8 text-[10px] font-black uppercase text-white/20 hover:text-white transition-colors">Close</button>
               </motion.div>
             ) : (
                <OrderTrackerView
                  orderId={trackingOrderId}
                  initialTrackingToken={activeOrders.find((order) => order.id === trackingOrderId)?.trackingToken}
                  primaryColor={primaryColor}
                  contrastText={contrastText}
                  onStatusChange={updateOrderStatus}
                  onDone={() => { setShowTracker(false); setShowLookup(false); }}
                />
             )}
          </div>
        )}
      </AnimatePresence>

      {/* ── 3D VIEWER MODAL ── */}
      <AnimatePresence>
        {viewing3D && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/98 backdrop-blur-3xl" onClick={() => setViewing3D(null)} />
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-4xl h-[80vh] bg-[#050505] rounded-[40px] overflow-hidden border border-white/[0.08] shadow-2xl flex flex-col">
                <div className="p-6 border-b border-white/[0.08] flex items-center justify-between shrink-0">
                   <div>
                      <h3 className="text-xl font-black uppercase text-white tracking-tighter">3D Explorer</h3>
                      <p className="text-[10px] text-white/40 uppercase font-black tracking-widest mt-1">{viewing3D.name}</p>
                   </div>
                   <button type="button" onClick={() => setViewing3D(null)} className="w-12 h-12 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white rounded-2xl flex items-center justify-center transition-all">✕</button>
                </div>
                <div className="flex-1 bg-white/[0.02] relative">
                   <model-viewer
                     src={viewing3D.modelUrl}
                     poster={viewing3D.modelPoster || viewing3D.imageUrl}
                     alt={viewing3D.name}
                     auto-rotate
                     camera-controls
                     shadow-intensity="1"
                     environment-image="neutral"
                     exposure="1.2"
                     ar
                     ar-modes="webxr scene-viewer quick-look"
                     style={{ width: '100%', height: '100%', '--poster-color': 'transparent' }}
                   >
                      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 px-6 py-3 bg-white/5 backdrop-blur-md rounded-full border border-white/10 flex items-center gap-3">
                         <span className="text-[10px] font-black uppercase tracking-widest text-white/60">Interact to explore</span>
                      </div>
                   </model-viewer>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ModelViewerScript />
    </div>
  );
}

function OrderTrackerView({ orderId, initialTrackingToken, primaryColor, contrastText, onDone, onStatusChange }) {
  const [order, setOrder] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const [trackingToken, setTrackingToken] = useState(initialTrackingToken || null);
  const { on, off } = useSocket({ orderId: trackingToken ? orderId : null, trackingToken });

  const load = useCallback(async () => { 
    if (!orderId) return;
    try { 
      if (!trackingToken) return;
      const r = await api.trackOrder(orderId, trackingToken); 
      if (r?.order) {
        setOrder(r.order);
        onStatusChange?.(r.order.id, r.order.status);
      }
      if (r?.trackingToken) {
        setTrackingToken(r.trackingToken);
      }
    } catch (e) { console.error("Tracking Error:", e); } 
  }, [orderId, trackingToken, onStatusChange]);

  useEffect(() => {
    load();
    const handleUpdate = (u) => { 
      setOrder(u); 
      onStatusChange?.(u.id, u.status);
      toast.info(`Order Status: ${normalizeOrderStatus(u.status)}`, { icon: '🔔' }); 
    };
    on('order-status-changed', handleUpdate);
    const t = setInterval(load, 10000);
    return () => { off('order-status-changed', handleUpdate); clearInterval(t); };
  }, [orderId, on, off, load, onStatusChange]);

  // Timer logic
  useEffect(() => {
    if (!order?.estimatedDelivery) {
      setTimeLeft(null);
      return;
    }
    const updateTimer = () => {
      const diff = Math.max(0, Math.floor((new Date(order.estimatedDelivery) - new Date()) / 1000));
      setTimeLeft(diff);
    };
    updateTimer();
    const t = setInterval(updateTimer, 1000);
    return () => clearInterval(t);
  }, [order?.estimatedDelivery]);

  const formatTimeLeft = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const STEPS = [
    { key: 'PENDING',   label: 'Placed',    desc: 'Waiting for confirmation' },
    { key: 'CONFIRMED', label: 'Accepted',  desc: 'Confirmed by restaurant' },
    { key: 'PREPARING', label: 'Cooking',   desc: 'Being prepared now' },
    { key: 'READY',     label: 'Ready',     desc: 'Hot and ready to serve' },
    { key: 'COMPLETED', label: 'Served',    desc: 'Completed and on your table' }
  ];

  const normalizedStatus = CUSTOMER_TRACKER_STATUS_MAP[normalizeOrderStatus(order?.status)] || 'PENDING';
  const currentIdx = order ? STEPS.findIndex(s => s.key === normalizedStatus) : 0;
  const isCancelled = normalizedStatus === 'CANCELLED';
  const isDelivered = normalizedStatus === 'COMPLETED';

  if (!order) return (
    <div className="bg-white/[0.03] p-20 rounded-[40px] text-white/20 font-black uppercase tracking-widest text-center animate-pulse border border-white/[0.08]">
      Synchronizing...
    </div>
  );

  return (
    <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative bg-[#050505] rounded-[40px] w-full max-w-lg overflow-hidden flex flex-col border border-white/[0.08] shadow-2xl">
      {/* Header */}
      <div className="p-8 border-b border-white/[0.08] flex justify-between items-center bg-white/[0.02]">
         <div>
           <h3 className="text-2xl font-black uppercase tracking-tighter text-white">Live Order</h3>
           <p className="text-[10px] text-white/40 uppercase font-black tracking-widest mt-1">Order #{order.id.slice(-6).toUpperCase()}</p>
         </div>
         <button 
          type="button" 
          onClick={onDone} 
          className="w-12 h-12 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white rounded-2xl flex items-center justify-center transition-all"
         >✕</button>
      </div>

      {/* Body: Stepper & ETA */}
      <div className="p-8 flex-1 overflow-y-auto space-y-8 scrollbar-hide">
         {/* ETA Section */}
         {!isCancelled && !isDelivered && order.estimatedDelivery && (
            <div className="bg-white/[0.03] rounded-3xl p-6 border border-white/[0.08] text-center">
               <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 mb-2">Estimated Ready In</div>
               <div className="text-4xl font-black tracking-tighter tabular-nums text-white">
                  {timeLeft !== null ? formatTimeLeft(timeLeft) : '--:--'}
               </div>
               {timeLeft === 0 && <div className="text-[10px] mt-2 text-[#facc15] font-bold uppercase">Preparation Complete</div>}
            </div>
         )}

         {isCancelled ? (
            <div className="bg-red-500/5 p-8 rounded-3xl border border-red-500/10 text-center">
               <div className="text-4xl mb-4">🚫</div>
               <div className="text-red-500 font-black text-xl uppercase tracking-widest">Order Cancelled</div>
               <p className="text-red-500/40 text-xs mt-2 font-medium">Please contact staff for assistance.</p>
            </div>
         ) : (
            <div className="relative space-y-12 px-2">
               <div className="absolute left-[19px] top-4 bottom-4 w-[1px] bg-white/[0.08]" />
               {STEPS.map((step, i) => {
                 const done = i < currentIdx;
                 const active = i === currentIdx;
                 const upcoming = i > currentIdx;
                 
                 let dotBg = 'bg-transparent';
                 let dotBorder = 'border-white/20';
                 let dotText = 'text-white/40';
                 let icon = i + 1;

                 if (done || (isDelivered && i < STEPS.length)) {
                   dotBg = 'bg-[#22c55e]';
                   dotBorder = 'border-transparent';
                   dotText = 'text-white';
                   icon = '✓';
                 } else if (active && !isDelivered) {
                   dotBg = 'bg-white';
                   dotBorder = 'border-transparent';
                   dotText = 'text-black';
                 }

                 return (
                   <div key={step.key} className="flex gap-8 relative">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center z-10 transition-all duration-500 border ${dotBg} ${dotBorder} ${dotText} font-bold ${active ? 'scale-110 shadow-lg' : ''}`}>
                        {icon}
                      </div>
                      <div className={`pt-1.5 transition-all duration-300 ${upcoming ? 'opacity-40' : 'opacity-100'}`}>
                         <h4 className={`font-black uppercase tracking-widest text-sm ${active ? 'text-white' : 'text-white/60'}`}>{step.label}</h4>
                         <p className="text-[10px] text-white/30 font-medium italic mt-0.5">{step.desc}</p>
                      </div>
                   </div>
                 )
               })}
            </div>
         )}

         {/* Order Items Summary */}
         <div className="pt-6 border-t border-white/[0.08]">
            <h5 className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-4">Your Selection</h5>
            <div className="space-y-3">
               {order.items?.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center text-xs font-bold">
                     <span className="text-white/60"><span className="text-white">{item.quantity}×</span> {item.name}</span>
                     <span className="text-white">{getSymbol(order.restaurant)}{parseFloat(item.itemTotal || item.itemSubtotal || 0).toFixed(2)}</span>
                  </div>
               ))}
            </div>
         </div>
      </div>

      {/* Footer */}
      <div className="p-8 border-t border-white/[0.08] flex flex-col md:flex-row justify-between items-center bg-white/[0.02] gap-4">
         <div className="flex items-center gap-4">
            <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Total Amount</span>
            <span className="text-2xl font-black tracking-tighter text-white">{getSymbol(order.restaurant)}{parseFloat(order.grandTotal || order.total || 0).toFixed(2)}</span>
         </div>
         <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/20">
            Developed by <a href="https://asjadyousaf.online" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 transition-colors">Asjad Yousaf Khan</a>
         </p>
      </div>
    </motion.div>
  );
}

function ModelViewerScript() {
  useEffect(() => {
    if (typeof window !== 'undefined' && !customElements.get('model-viewer')) {
      const s = document.createElement('script');
      s.type = 'module';
      s.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';
      document.head.appendChild(s);
    }
  }, []);
  return null;
}
