'use client';

import { memo, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useInputDialog } from '@/components/ui/InputDialog';
import { useOffline } from '@/components/offline/OfflineProvider';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';
import { hasTenantPermission } from '@/lib/tenantAccess';
import { clearPosDraft, createGlobalId, getLocalActiveOrders, loadPosDraft, savePosDraft } from '@/lib/offline/database';
import ReceiptPrint from '@/components/ReceiptPrint';
import '@/styles/receipt-print.css';
import RestaurantMark from '@/components/RestaurantMark';

const ORDER_TYPES = [
  { value: 'COUNTER', label: 'Counter', icon: 'terminal' },
  { value: 'DINE_IN', label: 'Dine-In', icon: 'table' },
  { value: 'TAKEAWAY', label: 'Takeaway', icon: 'bag' },
  { value: 'DELIVERY', label: 'Delivery', icon: 'truck' },
];

const UNIFIED_CHANNEL_TABS = [
  { value: 'ALL', label: 'All' },
  { value: 'DINE_IN', label: 'Dine-In' },
  { value: 'TAKEAWAY', label: 'Takeaway' },
  { value: 'DELIVERY', label: 'Delivery' },
];

const TABLE_ORDER_TYPES = new Set(['DINE_IN', 'ONLINE_QR']);
const TERMINAL_ORDER_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED']);
const INCOMING_ALERT_DURATION_MS = 20000;
const KITCHEN_STATUS_ALERT_DURATION_MS = 30000;
const POS_TICKET_PANEL_STORAGE_KEY = 'dine3d:pos:ticket-panel-width';
const POS_MENU_DENSITY_STORAGE_KEY = 'dine3d:pos:menu-density';
const POS_TICKET_PANEL_DEFAULT_WIDTH = 420;
const POS_TICKET_PANEL_MIN_WIDTH = 340;
const POS_TICKET_PANEL_MAX_WIDTH = 640;
const POS_MENU_DENSITIES = {
  compact: { label: 'Compact', cardMinWidth: 140 },
  balanced: { label: 'Balanced', cardMinWidth: 172 },
  spacious: { label: 'Spacious', cardMinWidth: 214 },
};

function clampTicketPanelWidth(value, containerWidth) {
  const availableMaximum = Number.isFinite(containerWidth)
    ? Math.max(POS_TICKET_PANEL_MIN_WIDTH, containerWidth - 560)
    : POS_TICKET_PANEL_MAX_WIDTH;
  const maximum = Math.min(POS_TICKET_PANEL_MAX_WIDTH, availableMaximum);
  return Math.round(Math.min(Math.max(Number(value) || POS_TICKET_PANEL_DEFAULT_WIDTH, POS_TICKET_PANEL_MIN_WIDTH), maximum));
}

const KITCHEN_STATUS_NOTIFICATION_META = {
  PREPARING: {
    label: 'Preparing',
    title: (orderNumber) => `${orderNumber} is being prepared`,
    message: (contextLabel) => `Kitchen started preparing ${contextLabel}.`,
    iconClass: 'from-violet-500 to-indigo-600',
    badgeClass: 'bg-violet-100 text-violet-700 ring-violet-200',
  },
  READY: {
    label: 'Ready',
    title: (orderNumber) => `${orderNumber} is ready`,
    message: (contextLabel) => `Kitchen marked ${contextLabel} as ready to serve.`,
    iconClass: 'from-emerald-500 to-teal-600',
    badgeClass: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  },
};

/**
 * Two sounds, because they ask the cashier for two different things.
 *
 * A new order is a rising pair — it leans forward, something has arrived and
 * needs attention. Ready is a settled three-note fall onto a held note: it is
 * an announcement, not a demand, and it must be distinguishable from the other
 * across a noisy room without anyone looking up at a screen to check which one
 * just played.
 */
const INCOMING_ORDER_CHIME = [
  { frequency: 880, offset: 0, duration: 0.15 },
  { frequency: 1174, offset: 0.16, duration: 0.15 },
];

const ORDER_READY_CHIME = [
  { frequency: 1046, offset: 0, duration: 0.14 },
  { frequency: 1318, offset: 0.13, duration: 0.14 },
  { frequency: 1568, offset: 0.26, duration: 0.34 },
];

const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: 'EUR ',
  GBP: 'GBP ',
  PKR: 'Rs. ',
  AED: 'AED ',
  SAR: 'SAR ',
  INR: 'INR ',
};

const ORDER_STATUS_STYLES = {
  CREATED: 'bg-slate-100 text-slate-700 ring-slate-200',
  PENDING: 'bg-amber-100 text-amber-800 ring-amber-200',
  CONFIRMED: 'bg-sky-100 text-sky-800 ring-sky-200',
  PREPARING: 'bg-violet-100 text-violet-800 ring-violet-200',
  READY: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  COMPLETED: 'bg-slate-100 text-slate-700 ring-slate-200',
  CANCELLED: 'bg-rose-100 text-rose-800 ring-rose-200',
  DEFAULT: 'bg-slate-100 text-slate-700 ring-slate-200',
};

const SOURCE_STYLES = {
  POS: 'bg-orange-100 text-orange-800 ring-orange-200',
  QR: 'bg-sky-100 text-sky-800 ring-sky-200',
  DELIVERY: 'bg-orange-100 text-orange-800 ring-orange-200',
  DEFAULT: 'bg-slate-100 text-slate-700 ring-slate-200',
};

const MENU_IMAGE_RULES = [
  { pattern: /biryani/i, image: '/images/menu/chicken-biryani.jpg' },
  { pattern: /(karahi|handi|nihari|curry)/i, image: '/images/menu/chicken-curry.jpg' },
  { pattern: /(seekh|kebab)/i, image: '/images/menu/seekh-kebab.jpg' },
  { pattern: /zinger/i, image: '/images/menu/zinger-burger.jpg' },
  { pattern: /wrap/i, image: '/images/menu/chicken-wrap.jpg' },
  { pattern: /wings?/i, image: '/images/menu/chicken-wings.jpg' },
  { pattern: /pizza/i, image: '/images/menu/pizza.jpg' },
  { pattern: /(smash|classic beef|beef burger|burger)/i, image: '/images/menu/beef-burger.jpg' },
  { pattern: /fries?/i, image: '/images/menu/french-fries.jpg' },
  { pattern: /(onion rings|garlic bread|coleslaw|sides?)/i, image: '/images/menu/sides-platter.jpg' },
  { pattern: /(gulab jamun|dessert|sweet)/i, image: '/images/menu/gulab-jamun.jpg' },
  { pattern: /(coca-cola|pepsi|lemonade|lassi|chai|tea|juice|water)/i, image: '/images/menu/beverages.jpg' },
];

const CATEGORY_IMAGE_FALLBACKS = {
  'pakistani cuisine': '/images/menu/chicken-curry.jpg',
  'fast food': '/images/menu/zinger-burger.jpg',
  pizza: '/images/menu/pizza.jpg',
  burgers: '/images/menu/beef-burger.jpg',
  'sides & appetizers': '/images/menu/sides-platter.jpg',
  desserts: '/images/menu/gulab-jamun.jpg',
  beverages: '/images/menu/beverages.jpg',
};

function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

function parseAmount(value) {
  const amount = parseFloat(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function getInitials(name = '') {
  return String(name)
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'IT';
}

function getMenuItemImage(item) {
  const explicitImage = String(item?.imageUrl || '').trim();
  if (explicitImage) return explicitImage;

  const itemName = String(item?.name || '');
  const matchedRule = MENU_IMAGE_RULES.find((rule) => rule.pattern.test(itemName));
  if (matchedRule) return matchedRule.image;

  const categoryName = String(item?.category?.name || '').trim().toLowerCase();
  return CATEGORY_IMAGE_FALLBACKS[categoryName] || null;
}

function formatTimestamp(value) {
  if (!value) return '--';
  try {
    return new Date(value).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '--';
  }
}

function formatTimeOnly(value) {
  if (!value) return '--';
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '--';
  }
}

function getNextStatus(status) {
  if (status === 'CREATED' || status === 'PENDING') return 'CONFIRMED';
  if (status === 'CONFIRMED') return 'PREPARING';
  if (status === 'PREPARING') return 'READY';
  if (status === 'READY') return 'COMPLETED';
  return null;
}

function getOrderContextLabel(order) {
  if (order?.table?.tableNumber) return `Table ${order.table.tableNumber}`;
  if (order?.orderType === 'DINE_IN') return 'Dine-In';
  if (order?.orderType === 'TAKEAWAY') return 'Takeaway';
  if (order?.orderType === 'DELIVERY') return 'Delivery';
  if (order?.orderType === 'ONLINE_QR') return 'QR Order';
  return 'Counter';
}

function getOrderHeadline(order) {
  const firstItem = order?.items?.[0];
  if (firstItem?.name) {
    return `${parseInt(firstItem.quantity || 1, 10) > 1 ? `${firstItem.quantity}x ` : ''}${firstItem.name}`;
  }
  return order?.customerName || order?.orderNumber || 'Order';
}

function isRemoteIncomingOrder(order) {
  const source = String(order?.source || '').trim().toUpperCase();
  const orderType = String(order?.orderType || '').trim().toUpperCase();

  if (source === 'POS') return false;

  return Boolean(order?.table?.tableNumber)
    || source === 'QR'
    || source === 'DELIVERY'
    || orderType === 'ONLINE_QR'
    || orderType === 'DELIVERY';
}

function getOrderItemCount(order) {
  return (order?.items || []).reduce(
    (total, item) => total + Math.max(1, parseInt(item?.quantity || 1, 10)),
    0
  );
}

function notificationOrderSnapshot(order) {
  if (!order) return null;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    orderType: order.orderType,
    source: order.source,
    status: order.status,
    paymentStatus: order.paymentStatus,
    customerName: order.customerName,
    grandTotal: order.grandTotal,
    createdAt: order.createdAt,
    table: order.table || null,
    items: Array.isArray(order.items) ? order.items : [],
  };
}

function Icon({ name, className = 'h-4 w-4' }) {
  const baseProps = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  switch (name) {
    case 'search':
      return (
        <svg {...baseProps}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case 'terminal':
      return (
        <svg {...baseProps}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m7 10 2.5 2.5L7 15" />
          <path d="M12 15h5" />
        </svg>
      );
    case 'table':
      return (
        <svg {...baseProps}>
          <path d="M4 9h16" />
          <path d="M6 9v8" />
          <path d="M18 9v8" />
          <path d="M10 9V5h4v4" />
          <path d="M8 17h8" />
        </svg>
      );
    case 'bag':
      return (
        <svg {...baseProps}>
          <path d="M6 8h12l-1 11H7L6 8Z" />
          <path d="M9 8a3 3 0 0 1 6 0" />
        </svg>
      );
    case 'truck':
      return (
        <svg {...baseProps}>
          <path d="M3 7h11v8H3z" />
          <path d="M14 10h3l3 3v2h-6z" />
          <circle cx="7.5" cy="17.5" r="1.5" />
          <circle cx="17.5" cy="17.5" r="1.5" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...baseProps}>
          <path d="M20 11a8 8 0 1 0 2.1 5.4" />
          <path d="M20 4v7h-7" />
        </svg>
      );
    case 'wallet':
      return (
        <svg {...baseProps}>
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19v14H6.5A2.5 2.5 0 0 1 4 16.5Z" />
          <path d="M19 9h-4a2 2 0 0 0 0 4h4" />
          <circle cx="15" cy="11" r=".5" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'card':
      return (
        <svg {...baseProps}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M3 10h18" />
          <path d="M7 14h3" />
        </svg>
      );
    case 'phone':
      return (
        <svg {...baseProps}>
          <path d="M7.5 3.5 10 7 8.5 9.2a15 15 0 0 0 6.3 6.3L17 14l3.5 2.5-1.2 3a2 2 0 0 1-2.1 1.2C9.8 19.5 4.5 14.2 3.3 6.8A2 2 0 0 1 4.5 4.7l3-1.2Z" />
        </svg>
      );
    case 'split':
      return (
        <svg {...baseProps}>
          <path d="M7 4v5a3 3 0 0 0 3 3h7" />
          <path d="M17 4v5a3 3 0 0 1-3 3H7" />
          <path d="m15 6 2-2 2 2" />
          <path d="m9 18-2 2-2-2" />
          <path d="M7 15v5" />
        </svg>
      );
    case 'hold':
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 9v6" />
          <path d="M14 9v6" />
        </svg>
      );
    case 'receipt':
      return (
        <svg {...baseProps}>
          <path d="M7 4h10v16l-2-1.5L13 20l-2-1.5L9 20l-2-1.5L5 20V6a2 2 0 0 1 2-2Z" />
          <path d="M9 9h6" />
          <path d="M9 13h6" />
        </svg>
      );
    case 'user':
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 19a7 7 0 0 1 14 0" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...baseProps}>
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          <path d="M12 14v2" />
        </svg>
      );
    case 'location':
      return (
        <svg {...baseProps}>
          <path d="M12 21s6-5.3 6-11a6 6 0 0 0-12 0c0 5.7 6 11 6 11Z" />
          <circle cx="12" cy="10" r="2" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...baseProps}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case 'minus':
      return (
        <svg {...baseProps}>
          <path d="M5 12h14" />
        </svg>
      );
    case 'trash':
      return (
        <svg {...baseProps}>
          <path d="M4 7h16" />
          <path d="M10 11v5" />
          <path d="M14 11v5" />
          <path d="M6 7l1 12h10l1-12" />
          <path d="M9 7V5h6v2" />
        </svg>
      );
    case 'close':
      return (
        <svg {...baseProps}>
          <path d="m6 6 12 12" />
          <path d="m18 6-12 12" />
        </svg>
      );
    case 'check':
      return (
        <svg {...baseProps}>
          <path d="m5 13 4 4L19 7" />
        </svg>
      );
    case 'cart':
      return (
        <svg {...baseProps}>
          <circle cx="9" cy="19" r="1.5" />
          <circle cx="17" cy="19" r="1.5" />
          <path d="M3 5h2l2.2 9.5h10.6L20 8H7.4" />
        </svg>
      );
    case 'chevronDown':
      return (
        <svg {...baseProps}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case 'arrowRight':
      return (
        <svg {...baseProps}>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...baseProps}>
          <path d="m12 3 1.3 4.7L18 9l-4.7 1.3L12 15l-1.3-4.7L6 9l4.7-1.3Z" />
        </svg>
      );
    case 'bell':
      return (
        <svg {...baseProps}>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
      );
    default:
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}

function StatusBadge({ status }) {
  const normalized = String(status || 'DEFAULT').toUpperCase();
  const style = ORDER_STATUS_STYLES[normalized] || ORDER_STATUS_STYLES.DEFAULT;
  return (
    <span className={cx('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1', style)}>
      {normalized.replaceAll('_', ' ')}
    </span>
  );
}

function SourceBadge({ source, compact = false }) {
  const normalized = String(source || 'DEFAULT').toUpperCase();
  const style = SOURCE_STYLES[normalized] || SOURCE_STYLES.DEFAULT;
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full font-semibold ring-1',
        compact ? 'px-1.5 py-0.5 text-[8px] leading-none' : 'px-2.5 py-1 text-[11px]',
        style
      )}
    >
      {normalized}
    </span>
  );
}

function EmptyPane({ icon, title, message, actionLabel, onAction, compact = false, className = '' }) {
  return (
    <div className={cx(
      'flex h-full flex-col items-center justify-center border border-dashed border-slate-300 bg-white text-center shadow-sm',
      compact ? 'min-h-[180px] rounded-2xl px-5 py-6' : 'min-h-[260px] rounded-[28px] px-6 py-10',
      className
    )}>
      <div className={cx(
        'flex items-center justify-center rounded-2xl bg-slate-100 text-slate-600',
        compact ? 'mb-3 h-11 w-11' : 'mb-4 h-14 w-14'
      )}>
        <Icon name={icon} className={compact ? 'h-5 w-5' : 'h-6 w-6'} />
      </div>
      <h3 className={cx('font-bold text-slate-900', compact ? 'text-base' : 'text-lg')}>{title}</h3>
      <p className={cx('max-w-sm text-slate-500', compact ? 'mt-1 text-[13px]' : 'mt-2 text-sm')}>{message}</p>
      {actionLabel && onAction ? (
        <button
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          <Icon name="arrowRight" className="h-4 w-4" />
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

const MenuProductCard = memo(function MenuProductCard({ item, canCreateOrder, currencySymbol, onAdd }) {
  const variantPrices = (item.variants || []).map((variant) => parseAmount(variant.price));
  const displayPrice = variantPrices.length > 0
    ? Math.min(...variantPrices)
    : parseAmount(item.basePrice || item.price);
  const hasCustomizations = (item.variants?.length || 0) > 0 || (item.modifierGroups?.length || 0) > 0;
  const imageSrc = getMenuItemImage(item);
  return (
    <button
      onClick={() => onAdd(item)}
      disabled={!canCreateOrder}
      data-pos-product="true"
      aria-label={`Add ${item.name} to ticket`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md disabled:cursor-default disabled:opacity-80"
    >
      {/*
        A fixed ratio that cannot shrink.
 
        This was `h-[56%]` of a card whose own height was set by an aspect ratio
        and then stretched by the grid. A dish with a name long enough to wrap
        needed a second line, the body took that line out of the picture — the
        default is to shrink — and the photograph ended up 17px shorter than the
        one beside it. On a row of four, the one short name had a visibly lower
        picture, which is exactly how it looked on the till.

        5/3 rather than a squarer ratio because this is a till: a taller picture
        is prettier and costs rows on screen. At the default density it lands on
        the same card height the old rule produced, so nothing got smaller.
      */}
      <div className="relative aspect-[5/3] w-full shrink-0 overflow-hidden bg-slate-100">
        {imageSrc ? (
          <img src={imageSrc} alt={item.name} className="h-full w-full object-cover object-center transition duration-300 group-hover:scale-105" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-100 text-2xl font-black tracking-tight text-slate-400">{getInitials(item.name)}</div>
        )}
        {hasCustomizations ? (
          <span className="absolute right-1.5 top-1.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-slate-900/88 text-white shadow-sm">
            <Icon name="spark" className="h-2.5 w-2.5" />
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 items-end justify-between gap-2 p-3">
        <div className="min-w-0">
          {/* Two lines are reserved whether the name needs them or not, so the
              price sits on the same line across the whole row. */}
          <h3 className="line-clamp-2 min-h-[34px] text-[13px] font-bold leading-[17px] text-slate-900">{item.name}</h3>
          <span className="mt-1 block text-sm font-extrabold tracking-tight text-[var(--color-primary)]">{formatMoneyValue(displayPrice, currencySymbol)}</span>
        </div>
        {canCreateOrder ? (
          <span className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition group-hover:bg-[var(--color-primary)] group-hover:text-white">
            <Icon name="plus" className="h-3 w-3" />
          </span>
        ) : null}
      </div>
    </button>
  );
});

function KitchenStatusNotification({ alert, onDismiss, onReview }) {
  const { order, status, previousStatus, receivedAt } = alert;
  const meta = KITCHEN_STATUS_NOTIFICATION_META[status];
  if (!meta) return null;

  const orderNumber = order.orderNumber || `#${String(order.id || '').slice(-6).toUpperCase()}`;
  const previousLabel = String(previousStatus || '').replaceAll('_', ' ');

  const openOrder = () => onReview(alert);

  return (
    <article
      role="alert"
      tabIndex={0}
      onClick={openOrder}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openOrder();
        }
      }}
      className="pos-mac-notification group pointer-events-auto relative cursor-pointer overflow-hidden rounded-[20px] border border-white/80 bg-white/85 p-3.5 text-slate-950 shadow-[0_18px_55px_rgba(15,23,42,0.25),0_2px_10px_rgba(15,23,42,0.12)] ring-1 ring-slate-900/5 backdrop-blur-2xl transition duration-200 hover:-translate-y-0.5 hover:bg-white/95 focus:outline-none focus:ring-2 focus:ring-sky-400"
      aria-label={`${meta.title(orderNumber)}. Click to view order.`}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss(alert.id);
        }}
        className="absolute right-2.5 top-2.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/10 text-slate-600 transition hover:bg-slate-900/20 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-sky-400"
        aria-label={`Dismiss ${orderNumber} status notification`}
      >
        <Icon name="close" className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-start gap-3 pr-7">
        <div className={cx(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br text-white shadow-sm',
          meta.iconClass
        )}>
          <Icon name={status === 'READY' ? 'check' : 'bell'} className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] leading-none text-slate-500">
            <span className="font-bold text-slate-800">Dine3D POS</span>
            <span aria-hidden="true">·</span>
            <span>{formatTimeOnly(receivedAt)}</span>
          </div>
          <h2 className="mt-1.5 truncate text-[15px] font-bold leading-tight tracking-[-0.01em]">
            {meta.title(orderNumber)}
          </h2>
          <p className="mt-1 text-[13px] leading-[1.35] text-slate-600">
            {meta.message(getOrderContextLabel(order))}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {previousLabel ? (
              <>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {previousLabel}
                </span>
                <Icon name="arrowRight" className="h-3 w-3 text-slate-400" />
              </>
            ) : null}
            <span className={cx(
              'inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1',
              meta.badgeClass
            )}>
              {meta.label}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}


/**
 * Build a print document from the on-screen receipt.
 *
 * The API returns a document with every order; this is the fallback for a
 * receipt that arrived without one, so printing never silently produces a
 * blank page.
 */
function documentFromReceipt(receipt) {
  if (!receipt) return null;
  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    jobType: 'CUSTOMER_RECEIPT',
    reprint: true,
    openDrawer: false,
    restaurant: {
      name: receipt.restaurantBaseName || receipt.restaurantName,
      branch: receipt.branchName || null,
      address: receipt.restaurantAddress || null,
      phone: receipt.restaurantPhone || null,
      taxId: receipt.taxRegistrationNumber || null,
    },
    order: {
      number: receipt.orderNumber,
      type: receipt.orderTypeRaw || receipt.orderType,
      table: receipt.tableLabel || receipt.tableNumber || null,
      cashier: receipt.cashierName || null,
      createdAt: receipt.createdAt,
      customerName: receipt.customerName || null,
      customerPhone: receipt.customerPhone || null,
      notes: receipt.notes || null,
    },
    items: (receipt.items || []).map((item) => ({
      quantity: item.quantity,
      name: item.name,
      variant: item.variant || item.variantName || null,
      total: number(item.total ?? item.itemTotal),
      modifiers: (item.modifiers || []).map((modifier) => ({
        name: modifier.name || modifier.option,
        price: number(modifier.price),
        quantity: modifier.quantity || 1,
      })),
      notes: item.notes || null,
    })),
    totals: {
      subtotal: number(receipt.subtotal),
      discount: number(receipt.discount),
      discountLabel: receipt.promoCode ? `Discount (${receipt.promoCode})` : 'Discount',
      serviceCharge: number(receipt.serviceCharge?.amount),
      serviceChargeLabel: receipt.serviceCharge?.label || 'Service charge',
      tax: number(receipt.tax?.amount),
      taxLabel: receipt.tax?.label || 'Tax',
      tip: number(receipt.tip),
      grandTotal: number(receipt.grandTotal),
    },
    payment: {
      method: receipt.paymentMethod || null,
      status: receipt.paymentStatus || null,
      payments: (receipt.payments || []).map((entry) => ({
        method: entry.method,
        amount: number(entry.amount),
        reference: entry.reference || null,
      })),
    },
    currency: receipt.currency || 'PKR',
    footer: receipt.footer || null,
  };
}


/**
 * Print the receipt on this computer.
 *
 * The desktop till prints silently to its configured printer. A browser has no
 * such bridge, so it opens the print dialog and the receipt stylesheet makes
 * that produce a proper receipt rather than a screenshot of the point of sale.
 */
async function printReceiptHere() {
  const bridge = typeof window !== 'undefined' ? window.dine3d : null;
  if (bridge?.isDesktop && typeof bridge.printReceipt === 'function') {
    try {
      const result = await bridge.printReceipt();
      return result?.ok
        ? { ok: true }
        : { ok: false, reason: result?.reason || 'The printer did not accept the receipt.' };
    } catch {
      return { ok: false, reason: 'The receipt could not be sent to the printer.' };
    }
  }
  window.print();
  return { ok: true };
}

export default function POSTerminal() {
  const offline = useOffline();
  const { can: accountCan } = useAdminAccess();
  const offlineRef = useRef(offline);
  useEffect(() => { offlineRef.current = offline; }, [offline]);
  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [cart, setCart] = useState([]);
  const [orderType, setOrderType] = useState('COUNTER');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [receipt, setReceipt] = useState(null);
  // The printer-agnostic document: rendered to HTML for window.print() and
  // sent verbatim to the Edge queue for a thermal printer.
  const [printDocument, setPrintDocument] = useState(null);
  const [lastOrder, setLastOrder] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paymentReference, setPaymentReference] = useState('');
  const [directOrderAttempt, setDirectOrderAttempt] = useState(null);
  const [amountTendered, setAmountTendered] = useState('');
  const [activeOrders, setActiveOrders] = useState([]);
  const [showOrders, setShowOrders] = useState(false);
  const [heldTabs, setHeldTabs] = useState([]);
  const [showHeldTabs, setShowHeldTabs] = useState(false);
  const [orderViewFilter, setOrderViewFilter] = useState('ALL');
  const [activeChannelTab, setActiveChannelTab] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMergeOrders, setSelectedMergeOrders] = useState([]);
  const [quickPin, setQuickPin] = useState('');
  const [activeStaff, setActiveStaff] = useState(null);
  const [activeShift, setActiveShift] = useState(null);
  const [operatorReady, setOperatorReady] = useState(false);
  const [terminalLocked, setTerminalLocked] = useState(false);
  const [quickLoginLoading, setQuickLoginLoading] = useState(false);
  const [quickLoginError, setQuickLoginError] = useState('');
  const [openingFloat, setOpeningFloat] = useState('');
  const [splitCount, setSplitCount] = useState(2);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [selectedModifiers, setSelectedModifiers] = useState([]);
  const [cartPreview, setCartPreview] = useState(null);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  /**
   * The rider who will carry a delivery order. Loaded only when the till
   * actually switches to DELIVERY — most orders at most restaurants are not
   * deliveries, and this should cost nothing on those.
   */
  const [riders, setRiders] = useState([]);
  const [riderId, setRiderId] = useState('');
  const [ridersLoaded, setRidersLoaded] = useState(false);
  const [tableId, setTableId] = useState('');
  const [tables, setTables] = useState([]);
  const [restaurant, setRestaurant] = useState(null);
  const [restaurantSessionKey, setRestaurantSessionKey] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedQueueOrder, setSelectedQueueOrder] = useState(null);
  const [showCashierPanel, setShowCashierPanel] = useState(false);
  const [incomingOrderAlerts, setIncomingOrderAlerts] = useState([]);
  const [kitchenStatusAlerts, setKitchenStatusAlerts] = useState([]);
  const [notificationPermission, setNotificationPermission] = useState('checking');
  const [notifications, setNotifications] = useState([]);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [ticketPanelWidth, setTicketPanelWidth] = useState(POS_TICKET_PANEL_DEFAULT_WIDTH);
  const [menuDensity, setMenuDensity] = useState('balanced');
  const [ticketPanelResizing, setTicketPanelResizing] = useState(false);
  // window.prompt() throws outright inside the Electron till, so every control
  // that asked the operator a question was dead on the one device that matters.
  const [inputDialog, askForInput] = useInputDialog();

  const operatorCan = (action) => activeStaff
    ? hasTenantPermission({
        permissions: activeStaff.permissions || [],
        deniedPermissions: activeStaff.deniedPermissions || [],
        sessionType: 'normal',
      }, action)
    : accountCan(action);
  const canCreateOrder = operatorCan('pos.orders.create');
  const canPay = operatorCan('pos.pay');
  const canUpdateOrderStatus = operatorCan('orders.status');
  const canVoidOrder = operatorCan('orders.void');
  const canWriteOrders = operatorCan('pos.orders.write');
  const canHoldTabs = operatorCan('pos.tabs.hold');
  const canReadTabs = operatorCan('pos.tabs.read');
  const canResumeTabs = operatorCan('pos.tabs.resume');
  const canQuickLogin = true;
  const canOpenShift = operatorCan('shift.open');
  const canWriteShift = operatorCan('shift.write');
  const canCloseShift = operatorCan('shift.close');

  const searchRef = useRef(null);
  const posWorkspaceRef = useRef(null);
  const ticketPanelRef = useRef(null);
  const notifiedOrderIdsRef = useRef(new Set());
  const notifiedKitchenStatusChangesRef = useRef(new Set());
  const knownActiveOrderIdsRef = useRef(new Set());
  const knownOrderStatusesRef = useRef(new Map());
  // Transitions this till raised itself, so it does not announce its own
  // work back to the cashier who just did it. Everything the POS does is
  // written local-first and synced, so it arrives over the socket looking
  // exactly like news from the kitchen — this is the only place that knows
  // the difference.
  const selfTransitionsRef = useRef(new Set());
  const receiptPrintJobsRef = useRef(new Map());
  const activeOrdersHydratedRef = useRef(false);
  const incomingAlertTimersRef = useRef(new Map());
  const kitchenStatusAlertTimersRef = useRef(new Map());
  const audioContextRef = useRef(null);
  const draftHydratedRef = useRef(false);
  const notificationStoreHydratedRef = useRef(null);
  const { socket } = useSocket({
    restaurantId: operatorReady && !terminalLocked ? restaurant?.id || null : null,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedWidth = Number(localStorage.getItem(POS_TICKET_PANEL_STORAGE_KEY));
    const storedDensity = localStorage.getItem(POS_MENU_DENSITY_STORAGE_KEY);
    const workspaceWidth = posWorkspaceRef.current?.getBoundingClientRect().width;
    if (Number.isFinite(storedWidth) && storedWidth > 0) {
      setTicketPanelWidth(clampTicketPanelWidth(storedWidth, workspaceWidth));
    }
    if (storedDensity && POS_MENU_DENSITIES[storedDensity]) setMenuDensity(storedDensity);
  }, []);

  useEffect(() => {
    const keepLayoutWithinViewport = () => {
      if (window.innerWidth < 1280) return;
      const workspaceWidth = posWorkspaceRef.current?.getBoundingClientRect().width;
      setTicketPanelWidth((current) => clampTicketPanelWidth(current, workspaceWidth));
    };
    window.addEventListener('resize', keepLayoutWithinViewport);
    return () => window.removeEventListener('resize', keepLayoutWithinViewport);
  }, []);

  const persistTicketPanelWidth = useCallback((width) => {
    if (typeof window !== 'undefined') localStorage.setItem(POS_TICKET_PANEL_STORAGE_KEY, String(width));
  }, []);

  const resizeTicketPanelByKeyboard = useCallback((event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    const workspaceWidth = posWorkspaceRef.current?.getBoundingClientRect().width;
    const next = event.key === 'Home'
      ? clampTicketPanelWidth(POS_TICKET_PANEL_DEFAULT_WIDTH, workspaceWidth)
      : clampTicketPanelWidth(ticketPanelWidth + (event.key === 'ArrowLeft' ? 24 : -24), workspaceWidth);
    setTicketPanelWidth(next);
    persistTicketPanelWidth(next);
  }, [persistTicketPanelWidth, ticketPanelWidth]);

  const startTicketPanelResize = useCallback((event) => {
    if (window.innerWidth < 1280 || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = ticketPanelWidth;
    const workspaceWidth = posWorkspaceRef.current?.getBoundingClientRect().width;
    let finalWidth = startWidth;
    setTicketPanelResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent) => {
      finalWidth = clampTicketPanelWidth(startWidth + startX - moveEvent.clientX, workspaceWidth);
      ticketPanelRef.current?.style.setProperty('--pos-ticket-panel-width', `${finalWidth}px`);
    };
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setTicketPanelResizing(false);
      setTicketPanelWidth(finalWidth);
      persistTicketPanelWidth(finalWidth);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd, { once: true });
    window.addEventListener('pointercancel', onEnd, { once: true });
  }, [persistTicketPanelWidth, ticketPanelWidth]);

  const selectMenuDensity = useCallback((value) => {
    if (!POS_MENU_DENSITIES[value]) return;
    setMenuDensity(value);
    if (typeof window !== 'undefined') localStorage.setItem(POS_MENU_DENSITY_STORAGE_KEY, value);
  }, []);

  const readStoredRestaurant = useCallback(() => {
    if (typeof window === 'undefined') return null;
    try {
      return JSON.parse(localStorage.getItem('dine3d_restaurant') || 'null');
    } catch {
      return null;
    }
  }, []);

  const getRestaurantSessionKey = useCallback(() => {
    const stored = readStoredRestaurant();
    if (!stored) return null;
    return `${stored.id || ''}:${stored.slug || ''}`;
  }, [readStoredRestaurant]);

  useEffect(() => {
    if (!restaurant?.id || typeof window === 'undefined') return;
    const key = `dine3d_pos_notifications:${restaurant.id}`;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      setNotifications(Array.isArray(saved) ? saved.slice(0, 50) : []);
    } catch {
      setNotifications([]);
    }
    notificationStoreHydratedRef.current = restaurant.id;
  }, [restaurant?.id]);

  useEffect(() => {
    if (!restaurant?.id || notificationStoreHydratedRef.current !== restaurant.id || typeof window === 'undefined') return;
    localStorage.setItem(`dine3d_pos_notifications:${restaurant.id}`, JSON.stringify(notifications.slice(0, 50)));
  }, [notifications, restaurant?.id]);

  const resetStateForTenantContext = useCallback(() => {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setDeliveryAddress('');
    setTableId('');
    setShowPayment(false);
    setShowReceipt(false);
    setReceipt(null);
    setPrintDocument(null);
    setLastOrder(null);
    setActiveOrders([]);
    setHeldTabs([]);
    setSelectedMergeOrders([]);
    setIncomingOrderAlerts([]);
    setKitchenStatusAlerts([]);
    notifiedOrderIdsRef.current.clear();
    notifiedKitchenStatusChangesRef.current.clear();
    knownActiveOrderIdsRef.current.clear();
    knownOrderStatusesRef.current.clear();
    selfTransitionsRef.current.clear();
    activeOrdersHydratedRef.current = false;
    incomingAlertTimersRef.current.forEach((timer) => clearTimeout(timer));
    incomingAlertTimersRef.current.clear();
    kitchenStatusAlertTimersRef.current.forEach((timer) => clearTimeout(timer));
    kitchenStatusAlertTimersRef.current.clear();
  }, []);

  const loadActiveOrders = useCallback(async (channel = activeChannelTab) => {
    try {
      const res = await api.getActivePOSOrders(channel);
      const serverOrders = res.orders || [];
      await offlineRef.current.cacheOrders(serverOrders).catch(() => {});
      const stored = readStoredRestaurant();
      const localOrders = stored?.id ? await getLocalActiveOrders(stored.id).catch(() => []) : [];
      const serverIds = new Set(serverOrders.map((order) => order.id));
      const orders = [...localOrders.filter((order) => !serverIds.has(order.id)), ...serverOrders];

      if (!activeOrdersHydratedRef.current) {
        orders.forEach((order) => {
          if (order?.id) knownActiveOrderIdsRef.current.add(order.id);
        });
        activeOrdersHydratedRef.current = true;
      }

      orders.forEach((order) => {
        if (order?.id && order?.status) {
          knownOrderStatusesRef.current.set(order.id, String(order.status).toUpperCase());
        }
      });

      setActiveOrders(orders);
    } catch (err) {
      console.error('Failed to load active orders:', err);
      const stored = readStoredRestaurant();
      if (stored?.id) {
        setActiveOrders(await getLocalActiveOrders(stored.id).catch(() => []));
      }
    }
  }, [activeChannelTab, readStoredRestaurant]);

  const loadHeldTabs = useCallback(async () => {
    if (!canReadTabs) return;
    try {
      const res = await api.getHeldPOSTabs();
      setHeldTabs(res.tabs || []);
    } catch (err) {
      console.error('Failed to load held tabs:', err);
    }
  }, [canReadTabs]);

  const loadMenu = useCallback(async () => {
    try {
      setLoading(true);
      const [menuRes, catRes, tableRes] = await Promise.all([
        api.get('/menu'),
        api.get('/categories'),
        api.get('/tables').catch(() => ({ tables: [] })),
      ]);

      setMenuItems(menuRes.items || []);
      setCategories(catRes.categories || []);
      setTables(tableRes.tables || []);
    } catch (err) {
      console.error('Failed to load menu:', err);
      const cached = await offlineRef.current.getCachedBootstrap().catch(() => null);
      if (cached) {
        setMenuItems(cached.menuItems || []);
        setCategories(cached.categories || []);
        setTables(cached.tables || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const dismissIncomingOrderAlert = useCallback((orderId) => {
    setIncomingOrderAlerts((previous) => previous.filter((order) => order.id !== orderId));
    const timer = incomingAlertTimersRef.current.get(orderId);
    if (timer) {
      clearTimeout(timer);
      incomingAlertTimersRef.current.delete(orderId);
    }
  }, []);

  const dismissKitchenStatusAlert = useCallback((alertId) => {
    setKitchenStatusAlerts((previous) => previous.filter((alert) => alert.id !== alertId));
    const timer = kitchenStatusAlertTimersRef.current.get(alertId);
    if (timer) {
      clearTimeout(timer);
      kitchenStatusAlertTimersRef.current.delete(alertId);
    }
  }, []);

  const recordNotification = useCallback((notification) => {
    if (!notification?.id) return;
    setNotifications((previous) => [
      { ...notification, read: false, createdAt: notification.createdAt || new Date().toISOString() },
      ...previous.filter((entry) => entry.id !== notification.id),
    ].slice(0, 50));
  }, []);

  const markNotificationRead = useCallback((notificationId) => {
    setNotifications((previous) => previous.map((entry) => (
      entry.id === notificationId ? { ...entry, read: true } : entry
    )));
  }, []);

  const reviewStoredNotification = useCallback((notification) => {
    if (!notification) return;
    markNotificationRead(notification.id);
    setNotificationCenterOpen(false);
    if (notification.order) setSelectedQueueOrder(notification.order);
  }, [markNotificationRead]);

  const reviewIncomingOrder = useCallback((order) => {
    if (!order) return;
    dismissIncomingOrderAlert(order.id);
    setSelectedQueueOrder(order);
  }, [dismissIncomingOrderAlert]);

  const reviewKitchenStatusAlert = useCallback((alert) => {
    if (!alert?.order) return;
    dismissKitchenStatusAlert(alert.id);
    setSelectedQueueOrder(alert.order);
  }, [dismissKitchenStatusAlert]);

  const playChime = useCallback((notes) => {
    if (typeof window === 'undefined') return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      const audioContext = audioContextRef.current || new AudioContextClass();
      audioContextRef.current = audioContext;

      const playTone = () => {
        const startAt = audioContext.currentTime;
        notes.forEach(({ frequency, offset, duration = 0.15 }) => {
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          const toneStart = startAt + offset;

          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(frequency, toneStart);
          gain.gain.setValueAtTime(0.0001, toneStart);
          gain.gain.exponentialRampToValueAtTime(0.18, toneStart + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + duration - 0.01);

          oscillator.connect(gain);
          gain.connect(audioContext.destination);
          oscillator.start(toneStart);
          oscillator.stop(toneStart + duration);
        });
      };

      // A browser suspends audio until someone has interacted with the page.
      // A till has always been clicked by the time an order exists, but resume
      // costs nothing and a silent pass is the failure that matters here.
      if (audioContext.state === 'suspended') {
        audioContext.resume().then(playTone).catch(() => {});
      } else {
        playTone();
      }
    } catch {
      // In-app and native notifications still work when audio is unavailable.
    }
  }, []);

  const playIncomingOrderTone = useCallback(() => playChime(INCOMING_ORDER_CHIME), [playChime]);
  const playOrderReadyTone = useCallback(() => playChime(ORDER_READY_CHIME), [playChime]);

  const showNativeIncomingOrderNotification = useCallback((order) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (window.Notification.permission !== 'granted') return;

    const orderNumber = order.orderNumber || `#${String(order.id || '').slice(-6).toUpperCase()}`;
    const contextLabel = getOrderContextLabel(order);
    const itemCount = getOrderItemCount(order);
    const currency = CURRENCY_SYMBOLS[restaurant?.currency] || 'Rs. ';
    const total = formatMoneyValue(order.grandTotal, currency);

    try {
      const notification = new window.Notification(`New order · ${contextLabel}`, {
        body: `${orderNumber} · ${itemCount} item${itemCount === 1 ? '' : 's'} · ${total}`,
        icon: '/default-logo.png',
        badge: '/default-logo.png',
        tag: `dine3d-order-${order.id}`,
        requireInteraction: true,
      });

      notification.onclick = () => {
        window.focus();
        reviewIncomingOrder(order);
        notification.close();
      };
    } catch {
      // Some browsers expose Notification but restrict construction.
    }
  }, [restaurant?.currency, reviewIncomingOrder]);

  const showNativeKitchenStatusNotification = useCallback((alert) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (window.Notification.permission !== 'granted') return;

    const { order, status } = alert;
    const meta = KITCHEN_STATUS_NOTIFICATION_META[status];
    if (!meta) return;

    const orderNumber = order.orderNumber || `#${String(order.id || '').slice(-6).toUpperCase()}`;

    try {
      const notification = new window.Notification(meta.title(orderNumber), {
        body: meta.message(getOrderContextLabel(order)),
        icon: '/default-logo.png',
        badge: '/default-logo.png',
        tag: `dine3d-kitchen-status-${order.id}-${status}`,
        requireInteraction: true,
      });

      notification.onclick = () => {
        window.focus();
        reviewKitchenStatusAlert(alert);
        notification.close();
      };
    } catch {
      // The in-app macOS-style notification remains available.
    }
  }, [reviewKitchenStatusAlert]);

  const pushIncomingOrderAlert = useCallback((order) => {
    if (!order?.id || !isRemoteIncomingOrder(order)) return;
    if (notifiedOrderIdsRef.current.has(order.id)) return;

    notifiedOrderIdsRef.current.add(order.id);
    setIncomingOrderAlerts((previous) => [order, ...previous.filter((entry) => entry.id !== order.id)].slice(0, 3));
    recordNotification({
      id: `new-order:${order.id}`,
      type: 'new_order',
      title: `New ${getOrderContextLabel(order)}`,
      message: `${order.orderNumber || 'New order'} · ${getOrderItemCount(order)} item${getOrderItemCount(order) === 1 ? '' : 's'}`,
      order: notificationOrderSnapshot(order),
    });
    playIncomingOrderTone();
    showNativeIncomingOrderNotification(order);

    const timer = setTimeout(() => {
      setIncomingOrderAlerts((previous) => previous.filter((entry) => entry.id !== order.id));
      incomingAlertTimersRef.current.delete(order.id);
    }, INCOMING_ALERT_DURATION_MS);

    incomingAlertTimersRef.current.set(order.id, timer);
  }, [playIncomingOrderTone, recordNotification, showNativeIncomingOrderNotification]);

  const pushKitchenStatusAlert = useCallback((order, previousStatus) => {
    const status = String(order?.status || '').toUpperCase();
    if (!order?.id || !KITCHEN_STATUS_NOTIFICATION_META[status]) return;

    const transitionVersion = order.stateVersion
      || order.statusChange?.toStatus
      || status;
    const alertId = `${order.id}:${status}:${transitionVersion}`;
    if (notifiedKitchenStatusChangesRef.current.has(alertId)) return;

    notifiedKitchenStatusChangesRef.current.add(alertId);

    const alert = {
      id: alertId,
      order,
      status,
      previousStatus: previousStatus || order.statusChange?.fromStatus || null,
      receivedAt: new Date(),
    };

    setKitchenStatusAlerts((previous) => [
      alert,
      ...previous.filter((entry) => entry.id !== alertId),
    ].slice(0, 4));
    const meta = KITCHEN_STATUS_NOTIFICATION_META[status];
    const orderNumber = order.orderNumber || `#${String(order.id).slice(-6).toUpperCase()}`;
    recordNotification({
      id: `kitchen:${alertId}`,
      type: status === 'READY' ? 'order_ready' : 'kitchen_update',
      title: meta.title(orderNumber),
      message: meta.message(getOrderContextLabel(order)),
      order: notificationOrderSnapshot(order),
    });
    if (status === 'READY') playOrderReadyTone();
    else playIncomingOrderTone();
    showNativeKitchenStatusNotification(alert);

    const timer = setTimeout(() => {
      setKitchenStatusAlerts((previous) => previous.filter((entry) => entry.id !== alertId));
      kitchenStatusAlertTimersRef.current.delete(alertId);
    }, KITCHEN_STATUS_ALERT_DURATION_MS);

    kitchenStatusAlertTimersRef.current.set(alertId, timer);
  }, [playIncomingOrderTone, playOrderReadyTone, recordNotification, showNativeKitchenStatusNotification]);

  const enableDesktopAlerts = useCallback(async () => {
    playIncomingOrderTone();

    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported');
      return;
    }

    try {
      const permission = window.Notification.permission === 'default'
        ? await window.Notification.requestPermission()
        : window.Notification.permission;

      setNotificationPermission(permission);
    } catch {
      setNotificationPermission('unsupported');
    }
  }, [playIncomingOrderTone]);

  const calculateOfflinePreview = useCallback((items, type) => {
    const config = offlineRef.current.bootstrap?.restaurant || restaurant || {};
    const taxesEnabled = offlineRef.current.bootstrap?.entitlements?.features?.taxes_service_charges?.allowed === true;
    const round = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    const subtotal = round(items.reduce((sum, item) => {
      const modifierTotal = (item.modifiers || []).reduce(
        (modifierSum, modifier) => modifierSum + Number(modifier.price || 0) * Number(modifier.quantity || 1),
        0
      );
      return sum + (Number(item.price || 0) + modifierTotal) * Number(item.quantity || 0);
    }, 0));
    const taxPercent = taxesEnabled ? Number(config.taxPercent || 0) : 0;
    const servicePercent = taxesEnabled ? Number(config.serviceChargePercent || 0) : 0;
    const fixedFee = taxesEnabled ? Number(config.serviceFeeFixed || 0) : 0;
    const inclusive = String(config.taxMode || 'EXCLUSIVE').toUpperCase() === 'INCLUSIVE';
    const tax = round(inclusive ? subtotal * taxPercent / (100 + taxPercent) : subtotal * taxPercent / 100);
    const taxableBase = inclusive ? subtotal - tax : subtotal;
    const servicePercentage = round(taxableBase * servicePercent / 100);
    const deliveryFee = type === 'DELIVERY' ? 5 : 0;
    const serviceCharge = round(servicePercentage + fixedFee + deliveryFee);
    const grandTotal = round(subtotal + (inclusive ? 0 : tax) + serviceCharge);
    return {
      grandTotal,
      estimated: true,
      breakdown: { subtotal, tax, serviceCharge, deliveryFee, discount: 0, total: grandTotal },
    };
  }, [restaurant]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported');
      return;
    }
    setNotificationPermission(window.Notification.permission);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;

    const handleNewOrder = (order) => {
      if (!order?.id) return;

      if (order.status) {
        knownOrderStatusesRef.current.set(order.id, String(order.status).toUpperCase());
      }

      setActiveOrders((previous) => {
        const existingIndex = previous.findIndex((entry) => entry.id === order.id);
        if (existingIndex === -1) return [order, ...previous];
        return previous.map((entry) => entry.id === order.id ? { ...entry, ...order } : entry);
      });
      pushIncomingOrderAlert(order);
    };

    const handleOrderUpdate = (order) => {
      if (!order?.id) return;
      const status = String(order.status || '').toUpperCase();
      const previousKnownStatus = knownOrderStatusesRef.current.get(order.id);
      const transition = order.statusChange || null;
      const previousStatus = String(transition?.fromStatus || previousKnownStatus || '').toUpperCase();
      const serverReportsChange = transition
        ? transition.changed !== false && String(transition.fromStatus || '').toUpperCase() !== status
        : false;
      const clientObservedChange = Boolean(previousKnownStatus && previousKnownStatus !== status);
      // A till hears its own synced transitions back. Consume the mark rather
      // than just reading it: the same order can legitimately reach the same
      // status again later, and that time it IS news.
      const selfKey = `${order.id}:${status}`;
      const isOwnEcho = selfTransitionsRef.current.delete(selfKey);
      const isKitchenFlow = transition?.source !== 'POS_TRANSITION' && !isOwnEcho;

      knownOrderStatusesRef.current.set(order.id, status);

      if (isKitchenFlow && (serverReportsChange || clientObservedChange)) {
        pushKitchenStatusAlert(order, previousStatus);
      }

      setActiveOrders((previous) => {
        if (TERMINAL_ORDER_STATUSES.has(status)) {
          return previous.filter((entry) => entry.id !== order.id);
        }

        const exists = previous.some((entry) => entry.id === order.id);
        if (!exists) return [order, ...previous];
        return previous.map((entry) => entry.id === order.id ? { ...entry, ...order } : entry);
      });

      setSelectedQueueOrder((selected) => (
        selected?.id === order.id ? { ...selected, ...order } : selected
      ));
    };

    socket.on('new-order', handleNewOrder);
    socket.on('order-updated', handleOrderUpdate);

    return () => {
      socket.off('new-order', handleNewOrder);
      socket.off('order-updated', handleOrderUpdate);
    };
  }, [socket, pushIncomingOrderAlert, pushKitchenStatusAlert]);

  useEffect(() => {
    const handleLocalOrderProjection = (event) => {
      const projected = Array.isArray(event.detail?.orders) ? event.detail.orders : [];
      if (!projected.length) return;

      for (const order of projected) {
        if (!order?.id) continue;
        const status = String(order.status || '').toUpperCase();
        const previousStatus = knownOrderStatusesRef.current.get(order.id);
        if (previousStatus && previousStatus !== status) {
          pushKitchenStatusAlert(order, previousStatus);
        }
        knownOrderStatusesRef.current.set(order.id, status);
      }

      setActiveOrders((previous) => {
        const byId = new Map(previous.map((order) => [order.id, order]));
        projected.forEach((order) => {
          const status = String(order.status || '').toUpperCase();
          if (TERMINAL_ORDER_STATUSES.has(status)) byId.delete(order.id);
          else byId.set(order.id, { ...(byId.get(order.id) || {}), ...order });
        });
        return [...byId.values()];
      });
      setSelectedQueueOrder((selected) => {
        if (!selected?.id) return selected;
        const update = projected.find((order) => order.id === selected.id);
        if (!update) return selected;
        return TERMINAL_ORDER_STATUSES.has(String(update.status || '').toUpperCase())
          ? null
          : { ...selected, ...update };
      });
    };

    window.addEventListener('dine3d-edge-orders', handleLocalOrderProjection);
    return () => window.removeEventListener('dine3d-edge-orders', handleLocalOrderProjection);
  }, [pushKitchenStatusAlert]);

  useEffect(() => {
    if (!activeOrdersHydratedRef.current) return;

    activeOrders.forEach((order) => {
      if (!order?.id) return;
      if (!knownActiveOrderIdsRef.current.has(order.id)) {
        pushIncomingOrderAlert(order);
        knownActiveOrderIdsRef.current.add(order.id);
      }
    });
  }, [activeOrders, pushIncomingOrderAlert]);

  useEffect(() => {
    if (!restaurant?.id || notificationStoreHydratedRef.current !== restaurant.id) return;
    const remoteOrders = activeOrders.filter((order) => order?.id && isRemoteIncomingOrder(order));
    if (remoteOrders.length === 0) return;
    setNotifications((previous) => {
      const knownIds = new Set(previous.map((entry) => entry.id));
      const missed = remoteOrders
        .filter((order) => !knownIds.has(`new-order:${order.id}`))
        .map((order) => ({
          id: `new-order:${order.id}`,
          type: 'new_order',
          title: `New ${getOrderContextLabel(order)}`,
          message: `${order.orderNumber || 'New order'} · ${getOrderItemCount(order)} item${getOrderItemCount(order) === 1 ? '' : 's'}`,
          order: notificationOrderSnapshot(order),
          createdAt: order.createdAt || new Date().toISOString(),
          read: false,
        }));
      return missed.length > 0 ? [...missed, ...previous].slice(0, 50) : previous;
    });
  }, [activeOrders, restaurant?.id]);

  useEffect(() => () => {
    incomingAlertTimersRef.current.forEach((timer) => clearTimeout(timer));
    incomingAlertTimersRef.current.clear();
    kitchenStatusAlertTimersRef.current.forEach((timer) => clearTimeout(timer));
    kitchenStatusAlertTimersRef.current.clear();
    audioContextRef.current?.close?.().catch?.(() => {});
  }, []);

  useEffect(() => {
    setRestaurant(readStoredRestaurant());
  }, [readStoredRestaurant]);

  useEffect(() => {
    if (!operatorReady || terminalLocked) return undefined;
    loadMenu();
    loadActiveOrders();
    if (canReadTabs) loadHeldTabs();

    const handleKey = (event) => {
      if (event.key === 'F2') {
        event.preventDefault();
        searchRef.current?.focus();
      }

      if (event.key === 'Escape') {
        setShowCashierPanel(false);
        setShowPayment(false);
        setShowReceipt(false);
        setSelectedProduct(null);
        setSelectedQueueOrder(null);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [canReadTabs, loadActiveOrders, loadHeldTabs, loadMenu, operatorReady, terminalLocked]);

  useEffect(() => {
    if (!offline.ready || !restaurant?.id || draftHydratedRef.current) return;
    loadPosDraft(restaurant.id).then((draft) => {
      if (draft) {
        setCart(Array.isArray(draft.cart) ? draft.cart : []);
        setOrderType(draft.orderType || 'COUNTER');
        setCustomerName(draft.customerName || '');
        setCustomerPhone(draft.customerPhone || '');
        setDeliveryAddress(draft.deliveryAddress || '');
        setTableId(draft.tableId || '');
        setPaymentReference(draft.paymentReference || '');
        setDirectOrderAttempt(draft.directOrderAttempt || null);
      }
      draftHydratedRef.current = true;
    }).catch(() => { draftHydratedRef.current = true; });
  }, [offline.ready, restaurant?.id]);

  useEffect(() => {
    if (!draftHydratedRef.current || !offline.context || !restaurant?.id) return undefined;
    const timer = setTimeout(() => {
      savePosDraft(offline.context, { cart, orderType, customerName, customerPhone, deliveryAddress, tableId, paymentReference, directOrderAttempt }).catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [cart, orderType, customerName, customerPhone, deliveryAddress, tableId, paymentReference, directOrderAttempt, offline.context, restaurant?.id]);

  useEffect(() => {
    const refreshSession = () => {
      const nextKey = getRestaurantSessionKey();
      const storedRestaurant = readStoredRestaurant();

      if (restaurantSessionKey === null) {
        setRestaurantSessionKey(nextKey);
        setRestaurant(storedRestaurant);
        return;
      }

      if (nextKey !== restaurantSessionKey) {
        setRestaurantSessionKey(nextKey);
        setRestaurant(storedRestaurant);
        resetStateForTenantContext();
        loadMenu();
        loadActiveOrders('ALL');
        loadHeldTabs();
      } else {
        setRestaurant(storedRestaurant);
      }
    };

    refreshSession();
    window.addEventListener('focus', refreshSession);
    window.addEventListener('storage', refreshSession);

    return () => {
      window.removeEventListener('focus', refreshSession);
      window.removeEventListener('storage', refreshSession);
    };
  }, [
    getRestaurantSessionKey,
    loadActiveOrders,
    loadHeldTabs,
    loadMenu,
    readStoredRestaurant,
    resetStateForTenantContext,
    restaurantSessionKey,
  ]);

  useEffect(() => {
    if (!operatorReady || terminalLocked) return undefined;
    const channel = showOrders ? activeChannelTab : 'ALL';
    const intervalMs = showOrders ? 10000 : 30000;

    if (showOrders) {
      loadActiveOrders(channel);
    }
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadActiveOrders(channel);
      }
    }, intervalMs);

    return () => clearInterval(intervalId);
  }, [showOrders, activeChannelTab, loadActiveOrders, operatorReady, terminalLocked]);

  useEffect(() => {
    if (!operatorReady || terminalLocked || !showHeldTabs) return;
    loadHeldTabs();
  }, [showHeldTabs, loadHeldTabs, operatorReady, terminalLocked]);

  useEffect(() => {
    let cancelled = false;
    api.getPOSOperator()
      .then((result) => {
        if (cancelled) return;
        setTerminalLocked(Boolean(result.terminalLocked));
        setActiveStaff(result.operator || null);
        setActiveShift(result.activeShift || null);
      })
      .catch((error) => {
        if (cancelled) return;
        const hasLockHint = typeof window !== 'undefined'
          && new URLSearchParams(window.location.search).get('locked') === '1';
        if (error?.code === 'POS_TERMINAL_LOCKED' || hasLockHint) setTerminalLocked(true);
        else console.warn('[POS_OPERATOR_RESTORE]', error?.message);
      })
      .finally(() => {
        if (!cancelled) setOperatorReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  /**
   * A plan limit reached mid-service.
   *
   * The only limit that can stop a sale is the monthly order cap, and it stops
   * it with a customer standing at the counter. A restaurant busy enough to
   * cross it is a restaurant doing well, so the answer is the price of the
   * plan that fits and a button — not a refusal and a support number.
   *
   * Returns true when it handled the error, so the caller does not also show
   * its generic message.
   */
  const offerUpgradeOnLimit = async (error) => {
    const upgrade = error?.details?.upgrade;
    if (error?.code !== 'USAGE_LIMIT_REACHED' || !upgrade) return false;

    const { current, limit } = error.details;
    const answer = await askForInput({
      title: 'Your plan is full for this month',
      description:
        `You have taken ${current} of ${limit} orders. Move to ${upgrade.name} — `
        + `${upgrade.currency} ${Number(upgrade.price).toLocaleString()} a month, no order limit — `
        + 'and this sale goes through straight away. Type UPGRADE to confirm.',
      confirmLabel: `Move to ${upgrade.name}`,
      fields: [{ name: 'confirm', label: 'Type UPGRADE to confirm', required: true }],
    });
    if (!answer || answer.confirm.trim().toUpperCase() !== 'UPGRADE') return true;

    try {
      await api.changePlan(upgrade.key);
      toast.success(`Moved to ${upgrade.name}. Take the order again.`);
      // The new allowance is on the session, not this page's copy of it.
      window.dispatchEvent(new Event('dine3d:permissions-changed'));
    } catch (changeError) {
      toast.error(changeError.message || `Could not move to ${upgrade.name}. Call us and we will do it.`);
    }
    return true;
  };

  const handleQuickLogin = async () => {
    if (!/^\d{4}$/.test(quickPin) || quickLoginLoading) return;

    try {
      setQuickLoginLoading(true);
      setQuickLoginError('');
      let res;
      try {
        res = await api.posQuickLogin(quickPin);
      } catch (cloudError) {
        if (!offline.state.edgeOnline) throw cloudError;
        res = await offline.offlinePinLogin(quickPin);
      }
      const operator = res.staff || res.operator || null;
      setActiveStaff(operator);

      // Putting a PIN in is how someone says they have started work. Making
      // them find a second button to say it again is a step that gets skipped
      // in a rush, and a terminal reading SHIFT CLOSED while a cashier rings
      // up sales leaves the night's cash with nothing to reconcile against.
      let shift = res.activeShift || null;
      if (!shift && operator) shift = await openShiftForOperator(operator);
      setActiveShift(shift);

      if (res.offline) setTerminalLocked(false);
      setQuickPin('');
      setShowCashierPanel(false);
      if (terminalLocked && !res.offline) {
        window.location.replace('/admin/pos');
        return;
      }
      // The server has already narrowed this session to the new operator. Tell
      // the admin shell to re-read it, or the cashier keeps looking at — and
      // can still walk into — every page the manager had open a moment ago.
      window.dispatchEvent(new Event('dine3d:permissions-changed'));
    } catch (err) {
      const message = err.message || 'PIN login failed';
      setQuickLoginError(message);
      if (!terminalLocked) alert(message);
    } finally {
      setQuickLoginLoading(false);
    }
  };

  const handleQuickLogout = async () => {
    try {
      let result;
      try {
        result = await api.posQuickLogout();
      } catch (cloudError) {
        if (!offline.state.edgeOnline) throw cloudError;
        result = await offline.offlinePinLogout();
      }
      setActiveStaff(null);
      setActiveShift(null);
      setQuickPin('');
      setQuickLoginError('');
      setShowCashierPanel(false);
      setTerminalLocked(result.terminalLocked !== false);
      window.history.replaceState(null, '', '/admin/pos?locked=1');
      window.dispatchEvent(new Event('dine3d:permissions-changed'));
    } catch (err) {
      alert(err.message || 'Unable to switch POS user');
    }
  };

  /**
   * Print a receipt.
   *
   * A branch with a network thermal printer gets the job on the durable Edge
   * queue, which survives a reload and retries on its own. Everywhere else —
   * no Edge, no printer configured, or the route rejected — falls back to the
   * browser, which prints the same document through whatever printer Windows
   * already has. The fallback is a real receipt, not a screenshot of the POS:
   * receipt-print.css hides the application and reveals only ReceiptPrint.
   */
  const handlePrintReceipt = async () => {
    if (!receipt) return;

    // Never call window.print() without a document: receipt-print.css reveals
    // only the receipt element, so printing with nothing mounted would produce
    // a blank page. Fall back to the on-screen receipt if the API did not
    // return a document (an older cached response, for instance).
    const document = printDocument || documentFromReceipt(receipt);
    if (!document) {
      alert('This receipt cannot be printed yet. Reopen it from Order History and try again.');
      return;
    }
    // Inside the desktop till the receipt goes straight to the printer chosen
    // during setup — no dialog, no printer picker, no margins to get wrong.
    // In a browser window.dine3d is absent and the print dialog is used, so one
    // codebase serves both.
    if (!offline.state.edgeOnline) {
      const printed = await printReceiptHere();
      if (!printed.ok) alert(printed.reason);
      return;
    }

    const receiptKey = receipt.orderId || receipt.id || receipt.orderNumber;
    let printJobId = receiptPrintJobsRef.current.get(receiptKey);
    if (!printJobId) {
      printJobId = crypto.randomUUID();
      receiptPrintJobsRef.current.set(receiptKey, printJobId);
    }

    try {
      // The whole document goes to the printer, so the thermal receipt carries
      // the same tax breakdown, payment and change as the screen and the
      // browser fallback.
      await offline.queuePrint('CUSTOMER_RECEIPT', document, {
        printJobId,
        orderId: receipt.orderId || receipt.id || lastOrder?.id || null,
      });
      alert('Receipt added to the durable Edge print queue.');
    } catch (error) {
      if (['PRINTER_ROUTE_MISSING', 'PRINTER_NOT_CONFIGURED', 'EDGE_PRINT_UNAVAILABLE'].includes(error.code)) {
        const printed = await printReceiptHere();
        if (!printed.ok) alert(printed.reason);
        return;
      }
      alert('Printing was not confirmed. The same print job ID has been retained—retry from this receipt or check the Edge print queue to avoid duplicates.');
    }
  };

  /**
   * Start the shift that signing in implies.
   *
   * This goes through the ordinary shift route rather than opening one as a
   * side effect of the PIN check, so it is the operator's own `shift.open`
   * permission that decides. Someone who may take orders but not open a
   * drawer still signs in fine, and simply has no shift.
   */
  const openShiftForOperator = async (operator) => {
    if (!operator?.id) return null;
    try {
      const res = await api.openPOSShift({
        staffId: operator.id,
        openingFloat: parseFloat(openingFloat || 0),
        notes: 'Opened on PIN sign-in',
      });
      return res.shift || null;
    } catch (err) {
      // No permission, or a shift already running on another terminal. Neither
      // is a reason to fail the sign-in — the panel still offers the button.
      console.warn('[POS_SHIFT] Not opened automatically:', err?.message || err);
      return null;
    }
  };

  const handleOpenShift = async () => {
    if (!activeStaff) {
      alert('Quick-login staff first to open a shift.');
      return;
    }

    try {
      const res = await api.openPOSShift({
        staffId: activeStaff.id,
        openingFloat: parseFloat(openingFloat || 0),
        notes: 'Opened from POS terminal',
      });

      setActiveShift(res.shift || null);
      setOpeningFloat('');
    } catch (err) {
      alert(err.message || 'Failed to open shift');
    }
  };

  const handleDrawerMovement = async (type) => {
    if (!activeShift) {
      alert('No active shift found.');
      return;
    }

    const isCashIn = type === 'CASH_IN';
    const answer = await askForInput({
      title: isCashIn ? 'Cash into drawer' : 'Cash out of drawer',
      description: isCashIn
        ? 'Money added to the drawer outside of a sale — a float top-up, or change brought from the safe.'
        : 'Money taken out of the drawer — a bank drop, or a supplier paid in cash.',
      confirmLabel: isCashIn ? 'Record cash in' : 'Record cash out',
      fields: [
        { name: 'amount', label: 'Amount', type: 'number', prefix: currencySymbol, required: true, min: 0.01 },
        { name: 'reason', label: 'Reason', placeholder: 'What it was for' },
      ],
    });
    if (!answer) return;

    const amount = parseFloat(answer.amount);
    const reason = answer.reason || undefined;

    try {
      const res = await api.addPOSDrawerMovement(activeShift.id, {
        type,
        amount,
        reason,
        staffId: activeStaff?.id,
      });

      if (res.shift) setActiveShift(res.shift);
    } catch (err) {
      alert(err.message || 'Drawer movement failed');
    }
  };

  const handleCloseShift = async () => {
    if (!activeShift) return;

    const answer = await askForInput({
      title: 'Close this shift',
      description: 'Count the drawer and enter what is actually in it. The variance against expected cash is recorded on the shift report.',
      confirmLabel: 'Count and close',
      fields: [
        {
          name: 'actualCash',
          label: 'Cash counted in drawer',
          type: 'number',
          prefix: currencySymbol,
          required: true,
          min: 0,
          hint: 'Count notes and coins, not card takings.',
        },
        { name: 'notes', label: 'Closing notes', placeholder: 'Anything worth recording' },
      ],
    });
    if (!answer) return;

    const actualCash = parseFloat(answer.actualCash);
    const notes = answer.notes || undefined;

    try {
      const res = await api.closePOSShift(activeShift.id, {
        actualCash,
        notes,
        staffId: activeStaff?.id,
      });

      setActiveShift(null);
      if (res.report) {
        alert(`Shift closed. Variance: ${formatMoneyValue(parseAmount(res.report.cashVariance || 0), currencySymbol)}`);
      }
    } catch (err) {
      alert(err.message || 'Failed to close shift');
    }
  };

  const handleHoldCurrentTab = async () => {
    if (cart.length === 0) {
      alert('Cart is empty. Add items before holding a tab.');
      return;
    }

    const answer = await askForInput({
      title: 'Hold this ticket',
      description: 'Park the cart under a name so it can be picked up again from Held.',
      confirmLabel: 'Hold ticket',
      fields: [{
        name: 'tabName',
        label: 'Tab name',
        required: true,
        defaultValue: customerName || `Tab-${Date.now().toString().slice(-4)}`,
      }],
    });
    if (!answer) return;
    const tabName = answer.tabName;

    try {
      await api.holdPOSTab({
        tabName,
        orderType,
        tableId: orderType === 'DINE_IN' ? (tableId || null) : null,
        customerName: customerName || null,
        customerPhone: customerPhone.trim() || null,
        holdReason: 'Held from POS terminal',
        payload: {
          cart,
          orderType,
          customerName,
          customerPhone,
          deliveryAddress,
          tableId,
        },
      });

      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setDeliveryAddress('');
      setTableId('');
      setShowPayment(false);
      setShowHeldTabs(true);
      setShowOrders(false);
      loadHeldTabs();
    } catch (err) {
      alert(err.message || 'Failed to hold tab');
    }
  };

  const handleResumeTab = async (tabId) => {
    try {
      const res = await api.resumePOSTab(tabId);
      const payload = res.payload || {};

      setCart(Array.isArray(payload.cart) ? payload.cart : []);
      setOrderType(payload.orderType || 'COUNTER');
      setCustomerName(payload.customerName || '');
      setCustomerPhone(payload.customerPhone || '');
      setDeliveryAddress(payload.deliveryAddress || '');
      setTableId(payload.tableId || '');

      setShowHeldTabs(false);
      loadHeldTabs();
    } catch (err) {
      alert(err.message || 'Failed to resume tab');
    }
  };

  const handleTransitionOrder = async (order, toStatus) => {
    let reason;

    if (['CANCELLED', 'FAILED', 'REFUNDED'].includes(toStatus)) {
      const answer = await askForInput({
        title: `Mark this order ${toStatus.toLowerCase()}`,
        description: 'The reason is kept on the order and shows in reports, so write what actually happened.',
        confirmLabel: `Mark ${toStatus.toLowerCase()}`,
        destructive: true,
        fields: [{ name: 'reason', label: 'Reason', required: true, placeholder: 'e.g. customer left' }],
      });
      if (!answer) return;
      reason = answer.reason;
    }

    try {
      // Critical POS mutations are always committed to IndexedDB and the
      // transactional outbox first. The sync engine may deliver immediately
      // while online, but a tab crash or lost acknowledgement cannot discard
      // the transition.
      selfTransitionsRef.current.add(`${order.id}:${String(toStatus).toUpperCase()}`);
      await offlineRef.current.transitionOrder(order.id, toStatus, { reason });
      loadActiveOrders(activeChannelTab);
    } catch (err) {
      alert(err.message || 'Order transition failed');
    }
  };

  const handleVoidOrder = async (orderId) => {
    const answer = await askForInput({
      title: 'Void this order',
      description: 'Voiding cancels the order and returns its stock. The reason is recorded against the operator signed in now.',
      confirmLabel: 'Void order',
      destructive: true,
      fields: [{ name: 'reason', label: 'Void reason', required: true, placeholder: 'e.g. rung up twice' }],
    });
    if (!answer) return;
    const reason = answer.reason;

    try {
      selfTransitionsRef.current.add(`${orderId}:CANCELLED`);
      await offlineRef.current.transitionOrder(orderId, 'CANCELLED', { reason });
      loadActiveOrders(activeChannelTab);
    } catch (err) {
      alert(err.message || 'Failed to void order');
    }
  };

  const handleRepeatOrder = async (orderId) => {
    try {
      await api.repeatPOSOrder(orderId);
      loadActiveOrders(activeChannelTab);
      alert('Order repeated successfully.');
    } catch (err) {
      alert(err.message || 'Failed to repeat order');
    }
  };

  const handleTransferTable = async (orderId) => {
    const answer = await askForInput({
      title: 'Move to another table',
      confirmLabel: 'Move order',
      fields: [{
        name: 'tableInput',
        label: 'Target table number',
        required: true,
        hint: tables.length ? `Active tables: ${tables.map((t) => t.tableNumber).join(', ')}` : undefined,
      }],
    });
    if (!answer) return;
    const tableInput = answer.tableInput;

    const targetTable = tables.find((table) => String(table.tableNumber) === String(tableInput).trim());
    if (!targetTable) {
      alert('Table not found. Use a valid active table number.');
      return;
    }

    try {
      await api.transferPOSTable(orderId, targetTable.id);
      loadActiveOrders(activeChannelTab);
    } catch (err) {
      alert(err.message || 'Failed to transfer table');
    }
  };

  const handleMergeSelection = async () => {
    if (selectedMergeOrders.length < 2) {
      alert('Select at least 2 orders to merge.');
      return;
    }

    const answer = await askForInput({
      title: `Merge ${selectedMergeOrders.length} orders`,
      description: 'The orders become one ticket. Name a table to seat it, or leave it blank to keep it where it is.',
      confirmLabel: 'Merge orders',
      fields: [{
        name: 'tableInput',
        label: 'Target table number',
        hint: tables.length ? `Active tables: ${tables.map((t) => t.tableNumber).join(', ')}` : undefined,
      }],
    });
    if (!answer) return;
    const tableInput = answer.tableInput;
    const targetTable = tableInput
      ? tables.find((table) => String(table.tableNumber) === String(tableInput).trim())
      : null;

    try {
      await api.mergePOSOrders({
        orderIds: selectedMergeOrders,
        targetTableId: targetTable?.id,
        notes: 'Merged from POS terminal',
      });
      setSelectedMergeOrders([]);
      loadActiveOrders(activeChannelTab);
    } catch (err) {
      alert(err.message || 'Failed to merge selected orders');
    }
  };

  const handleSplitExistingOrder = async (orderId) => {
    const parts = Math.max(2, parseInt(splitCount, 10) || 2);

    try {
      const planRes = await api.getPOSSplitPlan(orderId, 'EQUAL', { parts });
      const allocations = planRes.plan?.allocations || [];

      if (allocations.length < 2) {
        alert('Split plan did not return enough allocations.');
        return;
      }

      const splits = allocations.map((allocation, index) => ({
        method: 'CASH',
        amount: parseFloat(allocation.amount),
        amountTendered: parseFloat(allocation.amount),
        reference: `SPLIT-${index + 1}`,
      }));

      await api.processSplitPayment(orderId, splits);
      loadActiveOrders(activeChannelTab);
      alert(`Split payment completed (${parts} parts).`);
    } catch (err) {
      alert(err.message || 'Split payment failed');
    }
  };

  const addToCartRaw = useCallback((item, variant = null, modifiers = []) => {
    const modKey = modifiers
      .map((modifier) => `${modifier.group}:${modifier.option}x${modifier.quantity}`)
      .sort()
      .join('|');

    const cartKey = `${item.id}_${variant?.id || 'base'}_${modKey}`;

    setCart((previous) => {
      const existing = previous.find((cartItem) => cartItem.cartKey === cartKey);
      if (existing) {
        return previous.map((cartItem) =>
          cartItem.cartKey === cartKey
            ? { ...cartItem, quantity: cartItem.quantity + 1 }
            : cartItem
        );
      }

      return [
        ...previous,
        {
          cartKey,
          menuItemId: item.id,
          variantId: variant?.id || null,
          name: item.name,
          imageUrl: getMenuItemImage(item),
          variantName: variant?.name || null,
          price: variant ? parseFloat(variant.price) : parseFloat(item.basePrice),
          quantity: 1,
          modifiers,
        },
      ];
    });

    setSelectedProduct(null);
    setSelectedVariant(null);
    setSelectedModifiers([]);
  }, []);

  const initiateAddToCart = useCallback((item) => {
    if (!canCreateOrder) return;
    if ((item.variants?.length > 0) || (item.modifierGroups?.length > 0)) {
      setSelectedProduct(item);
      setSelectedVariant(item.variants?.[0] || null);
      setSelectedModifiers([]);
      return;
    }

    addToCartRaw(item);
  }, [addToCartRaw, canCreateOrder]);

  const updateCartQty = (cartKey, delta) => {
    setCart((previous) =>
      previous
        .map((item) => {
          if (item.cartKey !== cartKey) return item;
          const nextQuantity = item.quantity + delta;
          return nextQuantity <= 0 ? null : { ...item, quantity: nextQuantity };
        })
        .filter(Boolean)
    );
  };

  const removeFromCart = (cartKey) => {
    setCart((previous) => previous.filter((item) => item.cartKey !== cartKey));
  };

  const clearCart = () => {
    if (cart.length === 0) return;
    if (!confirm('Clear current order?')) return;
    setCart([]);
  };

  useEffect(() => {
    if (orderType !== 'DELIVERY' || ridersLoaded) return undefined;
    let cancelled = false;

    /**
     * Server first, this device's cache second.
     *
     * A till that has lost the internet still has to name who is taking the
     * food — that is precisely when knowing who has it matters. The cached list
     * comes from the last bootstrap, so it may be a shift out of date; that is
     * a far better answer than an empty selector.
     */
    const loadRiders = async () => {
      try {
        const response = await api.getRiders('?available=true');
        if (!cancelled) setRiders(response.riders || []);
      } catch {
        const cached = await offline.getCachedRiders?.(offline.context?.locationId || null).catch(() => []);
        if (!cancelled) setRiders(cached || []);
      } finally {
        if (!cancelled) setRidersLoaded(true);
      }
    };

    loadRiders();
    return () => { cancelled = true; };
  }, [orderType, ridersLoaded, offline]);

  const getOrderValidationMessage = useCallback(() => {
    const phoneDigits = String(customerPhone || '').replace(/\D/g, '');
    if (customerPhone.trim() && (phoneDigits.length < 10 || phoneDigits.length > 15)) {
      return 'Enter a valid mobile number with 10 to 15 digits, or leave it blank.';
    }
    if (orderType === 'DELIVERY' && !String(deliveryAddress || '').trim()) {
      return 'Add delivery address before placing this delivery order.';
    }
    // A rider is required whenever one is on shift. When none is, the order
    // still goes through and is assigned later — refusing the sale because
    // every bike is out would be the wrong trade at a counter with a queue.
    if (orderType === 'DELIVERY' && riders.length > 0 && !riderId) {
      return 'Choose the rider who will take this delivery.';
    }

    if (orderType === 'DINE_IN' && !tableId) {
      return 'Select a table before placing a dine-in order.';
    }

    return '';
  }, [customerPhone, deliveryAddress, orderType, tableId]);

  useEffect(() => {
    const fetchPreview = async () => {
      if (!operatorReady || terminalLocked) return;
      if (cart.length === 0) {
        setCartPreview(null);
        return;
      }

      setPreviewLoading(true);
      try {
        const payload = {
          items: cart.map((item) => ({
            menuItemId: item.menuItemId,
            variantId: item.variantId,
            quantity: item.quantity,
            modifiers: item.modifiers,
          })),
          deliveryFee: orderType === 'DELIVERY' ? 5 : 0,
        };

        const res = await api.post('/pos/orders/preview', payload);
        setCartPreview(res);
      } catch (err) {
        setCartPreview(calculateOfflinePreview(cart, orderType));
      } finally {
        setPreviewLoading(false);
      }
    };

    const timer = setTimeout(fetchPreview, 400);
    return () => clearTimeout(timer);
  }, [cart, orderType, calculateOfflinePreview, operatorReady, terminalLocked]);

  const handlePlaceOrder = async (payNow = false) => {
    if (cart.length === 0) return;

    const validationMessage = getOrderValidationMessage();
    if (validationMessage) {
      alert(validationMessage);
      return;
    }

    setProcessing(true);
    try {
      const usingSplitFlow = payNow && paymentMethod === 'split';
      const electronicPayment = payNow && !usingSplitFlow && paymentMethod !== 'CASH';
      if ((usingSplitFlow || electronicPayment) && !offlineRef.current.isMeaningfullyOnline) {
        throw new Error('Electronic and split payments require an online connection. Select cash or save the order without payment.');
      }
      if (electronicPayment && paymentReference.trim().length < 4) {
        throw new Error('Enter the terminal/provider authorization reference before confirming an electronic payment.');
      }
      const orderData = {
        orderType,
        customerName: customerName || null,
        customerPhone: customerPhone.trim() || null,
        customerAddress: orderType === 'DELIVERY' ? deliveryAddress : null,
        ...(orderType === 'DELIVERY' && riderId ? { riderId } : {}),
        tableId: orderType === 'DINE_IN' ? tableId : null,
        items: cart.map((item) => ({
          menuItemId: item.menuItemId,
          variantId: item.variantId,
          quantity: item.quantity,
          modifiers: item.modifiers,
        })),
        payImmediately: payNow && !usingSplitFlow,
        paymentMethod: payNow && !usingSplitFlow ? paymentMethod : undefined,
        amountTendered: payNow && paymentMethod === 'CASH'
          ? parseFloat(amountTendered || cartTotal)
          : undefined,
        paymentReference: electronicPayment ? paymentReference.trim() : undefined,
      };

      let result;
      if (usingSplitFlow || electronicPayment) {
        const fingerprint = JSON.stringify(orderData);
        const attempt = directOrderAttempt?.fingerprint === fingerprint
          ? directOrderAttempt
          : { operationId: createGlobalId(), clientOrderId: createGlobalId(), fingerprint };
        setDirectOrderAttempt(attempt);
        // Persist identifiers before the request so a refresh after a lost
        // acknowledgement retries the same server mutation.
        await savePosDraft(offlineRef.current.context, {
          cart, orderType, customerName, customerPhone, deliveryAddress, tableId, paymentReference,
          directOrderAttempt: attempt,
        });
        result = await api.createPOSOrder({ ...orderData, ...attempt, fingerprint: undefined, source: 'POS' });
      } else {
        const localCreatedAt = new Date().toISOString();
        const localPreview = cartPreview || calculateOfflinePreview(cart, orderType);
        const subtotal = Number(localPreview.breakdown?.subtotal || 0);
        const taxAmount = Number(cartPreview?.breakdown?.tax || 0);
        const serviceChargeAmount = Number(cartPreview?.breakdown?.serviceCharge || 0);
        const discountAmount = Number(cartPreview?.breakdown?.discount || 0);
        const grandTotal = Number(localPreview.grandTotal ?? subtotal);
        result = await offlineRef.current.saveOrder({
          id: createGlobalId(),
          restaurantId: restaurant.id,
          locationId: selectedTable?.locationId || offlineRef.current.context?.locationId || null,
          branchId: selectedTable?.locationId || offlineRef.current.context?.locationId || null,
          tableId: orderType === 'DINE_IN' ? tableId : null,
          table: selectedTable ? { tableNumber: selectedTable.tableNumber, label: selectedTable.label } : null,
          orderType,
          customerName: customerName || null,
          customerPhone: customerPhone.trim() || null,
          customerAddress: orderType === 'DELIVERY' ? deliveryAddress : null,
          currency: restaurant.currency || 'PKR',
          localCreatedAt,
          fulfilmentStatus: 'CONFIRMED',
          paymentState: payNow ? 'PAID' : 'UNPAID',
          subtotal,
          taxAmount,
          taxPercent: Number(offlineRef.current.bootstrap?.restaurant?.taxPercent || 0),
          serviceChargeAmount,
          serviceChargePercent: Number(offlineRef.current.bootstrap?.restaurant?.serviceChargePercent || 0),
          discountAmount,
          grandTotal,
          breakdown: localPreview.breakdown || null,
          items: cart.map((item) => ({
            id: createGlobalId(),
            menuItemId: item.menuItemId,
            variantId: item.variantId,
            quantity: item.quantity,
            modifiers: item.modifiers,
            notes: item.notes || null,
            name: item.name,
            basePrice: item.price,
            variantName: item.variantName,
            variantPrice: item.price,
            modifierTotal: (item.modifiers || []).reduce((sum, modifier) => sum + Number(modifier.price || 0) * Number(modifier.quantity || 1), 0),
            itemSubtotal: Number(item.price || 0) + (item.modifiers || []).reduce((sum, modifier) => sum + Number(modifier.price || 0) * Number(modifier.quantity || 1), 0),
            itemTotal: (Number(item.price || 0) + (item.modifiers || []).reduce((sum, modifier) => sum + Number(modifier.price || 0) * Number(modifier.quantity || 1), 0)) * Number(item.quantity || 0),
          })),
          cashPayment: payNow ? {
            id: createGlobalId(),
            amount: grandTotal,
            currency: restaurant.currency || 'PKR',
            amountTendered: Number(amountTendered || grandTotal),
            changeGiven: Math.max(0, Number(amountTendered || grandTotal) - grandTotal),
            cashierId: activeStaff?.id || offlineRef.current.context?.userId,
            localCreatedAt,
          } : null,
        });

        /**
         * The rider goes in the outbox behind the order.
         *
         * Queued rather than sent, and deliberately after the order is saved:
         * an assignment replayed before the order exists on the server would be
         * refused, and would look like a permanent failure instead of a matter
         * of ordering. A rider who has gone off shift by the time this syncs is
         * refused on arrival, which is right — better a delivery with no name
         * against it than one recorded as out with somebody who went home.
         */
        if (orderType === 'DELIVERY' && riderId && result?.order?.id) {
          await offlineRef.current.assignDeliveryRider({
            orderId: result.order.id,
            riderId,
            deliveryFee: 0,
            branchId: selectedTable?.locationId || offlineRef.current.context?.locationId || null,
          }).catch((assignError) => {
            // The sale stands either way; the till says the rider still needs naming.
            toast.error(assignError.message || 'Saved the order, but the rider could not be recorded.');
          });
        }
      }

      setLastOrder(result);

      if (usingSplitFlow) {
        const parts = Math.max(2, parseInt(splitCount, 10) || 2);
        const planRes = await api.getPOSSplitPlan(result.order.id, 'EQUAL', { parts });
        const allocations = planRes.plan?.allocations || [];

        const splits = allocations.map((allocation, index) => ({
          method: 'CASH',
          amount: parseFloat(allocation.amount),
          amountTendered: parseFloat(allocation.amount),
          reference: `POS-SPLIT-${index + 1}`,
        }));

        if (splits.length < 2) {
          throw new Error('Split plan did not return enough allocations');
        }

        await api.processSplitPayment(result.order.id, splits);
      }

      if (payNow && result.payment && !usingSplitFlow && !electronicPayment) {
        const localOrder = result.order;
        setReceipt({
          restaurantName: restaurant.name,
          restaurantPhone: restaurant.phone,
          restaurantAddress: restaurant.address,
          orderNumber: localOrder.orderNumber,
          createdAt: localOrder.localCreatedAt,
          orderType: localOrder.orderType,
          tableNumber: selectedTable?.tableNumber,
          customerName: localOrder.customerName,
          items: localOrder.items,
          subtotal: localOrder.subtotal,
          tax: { label: 'Tax', amount: localOrder.taxAmount },
          serviceCharge: { label: 'Service charge', amount: localOrder.serviceChargeAmount },
          discount: localOrder.discountAmount,
          tip: 0,
          grandTotal: localOrder.grandTotal,
          payments: [{ method: 'CASH', amount: result.payment.amount, change: result.payment.changeGiven }],
          footer: restaurant.receiptFooter || 'Saved on this device',
        });
        setPrintDocument({
          jobType: 'CUSTOMER_RECEIPT',
          reprint: false,
          openDrawer: true,
          restaurant: {
            name: restaurant.name,
            address: restaurant.address || null,
            phone: restaurant.phone || null,
            taxId: restaurant.taxRegistrationNumber || null,
          },
          order: {
            number: localOrder.orderNumber,
            type: localOrder.orderType,
            table: selectedTable?.tableNumber || null,
            cashier: activeStaff?.name || null,
            createdAt: localOrder.localCreatedAt,
            customerName: localOrder.customerName || null,
          },
          items: (localOrder.items || []).map((item) => ({
            quantity: item.quantity,
            name: item.name,
            variant: item.variantName || null,
            total: Number(item.itemTotal ?? item.total ?? 0),
            modifiers: Array.isArray(item.modifiers)
              ? item.modifiers.map((modifier) => ({
                name: modifier.name || modifier.option,
                price: Number(modifier.price || 0),
                quantity: modifier.quantity || 1,
              }))
              : [],
            notes: item.notes || null,
          })),
          totals: {
            subtotal: Number(localOrder.subtotal || 0),
            discount: Number(localOrder.discountAmount || 0),
            serviceCharge: Number(localOrder.serviceChargeAmount || 0),
            tax: Number(localOrder.taxAmount || 0),
            tip: 0,
            grandTotal: Number(localOrder.grandTotal || 0),
          },
          payment: {
            method: 'CASH',
            status: 'completed',
            tendered: Number(result.payment.amount || 0),
            change: Number(result.payment.changeGiven || 0),
            payments: [{ method: 'CASH', amount: Number(result.payment.amount || 0) }],
          },
          currency: restaurant.currency || 'PKR',
          footer: restaurant.receiptFooter || 'Saved on this device',
        });
        setShowReceipt(true);
      } else if (payNow && result.payment) {
        try {
          const receiptRes = await api.getReceipt(result.order.id);
          setReceipt(receiptRes.receipt);
          setPrintDocument(receiptRes.printDocument || null);
          setShowReceipt(true);
        } catch (err) {
          console.error('Receipt lookup failed:', err);
        }
      } else if (usingSplitFlow) {
        try {
          const receiptRes = await api.getReceipt(result.order.id);
          setReceipt(receiptRes.receipt);
          setPrintDocument(receiptRes.printDocument || null);
          setShowReceipt(true);
        } catch (err) {
          console.error('Receipt lookup failed:', err);
        }
      }

      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setDeliveryAddress('');
      setTableId('');
      setAmountTendered('');
      setPaymentReference('');
      setDirectOrderAttempt(null);
      setShowPayment(false);
      clearPosDraft(restaurant.id).catch(() => {});
      loadActiveOrders(activeChannelTab);
      loadHeldTabs();
    } catch (err) {
      if (!(await offerUpgradeOnLimit(err))) alert(err.message || 'Failed to place order');
    } finally {
      setProcessing(false);
    }
  };

  const handlePayOrder = async (orderId) => {
    try {
      setProcessing(true);
      const order = activeOrders.find((entry) => entry.id === orderId);
      if (!order) return;

      await offlineRef.current.recordCashPayment(orderId, {
        id: createGlobalId(),
        amount: parseFloat(order.grandTotal),
        currency: restaurant.currency || 'PKR',
        amountTendered: parseFloat(order.grandTotal),
        changeGiven: 0,
        localCreatedAt: new Date().toISOString(),
      });
      loadActiveOrders(activeChannelTab);
    } catch (err) {
      if (!(await offerUpgradeOnLimit(err))) alert(err.message || 'Payment failed');
    } finally {
      setProcessing(false);
    }
  };

  const currencySymbol = CURRENCY_SYMBOLS[restaurant?.currency] || 'Rs. ';
  const formatMoney = (value) => formatMoneyValue(value, currencySymbol);
  const cartTotal = useMemo(() => cartPreview
    ? parseAmount(cartPreview.grandTotal)
    : cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart, cartPreview]);

  const filteredItems = useMemo(() => menuItems.filter((item) => {
    const matchesCategory = activeCategory === 'ALL' || !activeCategory || item.categoryId === activeCategory;
    const matchesSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch && item.isAvailable;
  }), [activeCategory, menuItems, searchQuery]);

  const visibleActiveOrders = useMemo(() => activeOrders.filter((order) => {
    const isTableOrder = TABLE_ORDER_TYPES.has(order.orderType) || !!order.table?.tableNumber;
    if (orderViewFilter === 'TABLE') return isTableOrder;
    if (orderViewFilter === 'NON_TABLE') return !isTableOrder;
    return true;
  }), [activeOrders, orderViewFilter]);

  const changeAmount = paymentMethod === 'CASH' && amountTendered
    ? Math.max(0, parseAmount(amountTendered) - cartTotal)
    : 0;

  const activeCategoryName = activeCategory === 'ALL'
    ? 'All Items'
    : categories.find((category) => category.id === activeCategory)?.name || 'All Items';

  const cartLineCount = useMemo(
    () => cart.reduce((sum, item) => sum + parseInt(item.quantity || 0, 10), 0),
    [cart]
  );
  const currentOrderTypeMeta = ORDER_TYPES.find((type) => type.value === orderType) || ORDER_TYPES[0];
  const selectedTable = tables.find((table) => String(table.id) === String(tableId));
  const orderValidationMessage = getOrderValidationMessage();
  const canOpenCheckout = canCreateOrder && cart.length > 0 && !processing;
  const canSubmitOrder = canCreateOrder && cart.length > 0 && !processing && !orderValidationMessage;
  const previewSubtotal = cartPreview
    ? parseAmount(cartPreview.breakdown?.subtotal)
    : cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const previewTax = parseAmount(cartPreview?.breakdown?.tax);
  const previewChargeBundle = parseAmount(cartPreview?.breakdown?.serviceCharge);
  const previewDeliveryFee = parseAmount(cartPreview?.breakdown?.deliveryFee);
  const previewOtherCharges = Math.max(0, previewChargeBundle - previewDeliveryFee);
  const onlineOrders = useMemo(() => activeOrders.filter((order) => {
    const source = String(order.source || '').toUpperCase();
    return source === 'QR' || source === 'DELIVERY' || order.orderType === 'DELIVERY' || order.orderType === 'ONLINE_QR';
  }), [activeOrders]);
  const unreadNotificationCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications]
  );
  const queueOrders = onlineOrders.length > 0 ? onlineOrders : activeOrders.slice(0, 4);
  const selectedProductBasePrice = selectedVariant
    ? parseAmount(selectedVariant.price)
    : parseAmount(selectedProduct?.basePrice || selectedProduct?.price);
  const selectedProductModifiersTotal = selectedModifiers.reduce(
    (sum, modifier) => sum + parseAmount(modifier.price) * parseAmount(modifier.quantity || 1),
    0
  );
  const selectedProductTotal = selectedProductBasePrice + selectedProductModifiersTotal;
  const selectedProductImage = getMenuItemImage(selectedProduct);
  const selectedProductHasMissingRequiredGroups = selectedProduct
    ? (selectedProduct.modifierGroups || []).some(
        (group) => group.isRequired && !selectedModifiers.some((modifier) => modifier.group === group.name)
      )
    : false;

  if (!operatorReady) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-slate-950 text-white" role="status" aria-live="polite">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
            <Icon name="lock" className="h-6 w-6 animate-pulse" />
          </div>
          <p className="mt-4 text-sm font-bold">Verifying terminal security…</p>
        </div>
      </div>
    );
  }

  if (terminalLocked) {
    const terminalRestaurant = restaurant || readStoredRestaurant();
    return (
      <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-slate-950 px-4 py-8 text-white">
        <div className="w-full max-w-md">
          <div className="mb-5 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] border border-white/10 bg-white/10 shadow-2xl shadow-black/30 backdrop-blur">
              <Icon name="lock" className="h-8 w-8" />
            </div>
            <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.28em] text-slate-400">Main terminal</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white">POS locked</h1>
            <p className="mt-2 text-sm text-slate-400">
              {terminalRestaurant?.name || 'Restaurant terminal'} · Enter your personal staff PIN to continue.
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleQuickLogin();
            }}
            className="rounded-[24px] border border-white/10 bg-white/[0.07] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl"
          >
            <label htmlFor="terminal-unlock-pin" className="block text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Personal PIN
            </label>
            <input
              id="terminal-unlock-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              autoFocus
              value={quickPin}
              onChange={(event) => {
                setQuickPin(event.target.value.replace(/\D/g, '').slice(0, 4));
                setQuickLoginError('');
              }}
              className="mt-3 h-16 w-full rounded-2xl border border-white/15 bg-slate-900/80 px-4 text-center text-3xl font-black tracking-[0.55em] text-white outline-none transition placeholder:text-slate-700 focus:border-orange-400 focus:ring-4 focus:ring-orange-500/15"
              placeholder="••••"
              aria-describedby={quickLoginError ? 'terminal-unlock-error' : 'terminal-lock-help'}
            />

            {quickLoginError ? (
              <p id="terminal-unlock-error" className="mt-3 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-center text-xs font-semibold text-rose-200" role="alert">
                {quickLoginError}
              </p>
            ) : (
              <p id="terminal-lock-help" className="mt-3 text-center text-xs leading-5 text-slate-400">
                Your identity and permissions will be restored after verification.
              </p>
            )}

            <button
              type="submit"
              disabled={quickPin.length !== 4 || quickLoginLoading}
              className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 text-sm font-extrabold text-white shadow-lg shadow-orange-950/30 transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              <Icon name="lock" className="h-4 w-4" />
              {quickLoginLoading ? 'Verifying…' : 'Unlock terminal'}
            </button>
          </form>

          <div className="mt-4 flex flex-col items-center gap-3 text-center">
            <p className="max-w-sm text-[11px] leading-5 text-slate-500">
              The cash shift remains separate and is not closed by locking the operator session.
            </p>
            <button
              type="button"
              onClick={() => api.logout().catch((error) => setQuickLoginError(error.message || 'Unable to sign out'))}
              className="rounded-lg px-4 py-2 text-xs font-bold text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              Sign out completely
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-[var(--color-bg-subtle)]">
        <div className="rounded-2xl border border-slate-200 bg-white px-10 py-12 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-primary-glow)] text-[var(--color-primary)]">
            <Icon name="spark" className="h-8 w-8 animate-pulse" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Loading POS Terminal</h2>
          <p className="mt-2 text-sm text-slate-500">Preparing menu, orders, and cashier tools.</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={posWorkspaceRef} className="flex h-full min-h-0 w-full max-w-full flex-col overflow-y-auto bg-[var(--color-bg-subtle)] xl:flex-row xl:overflow-hidden">
      <div
        className="pointer-events-none fixed right-3 top-3 z-[120] flex w-[calc(100vw-1.5rem)] max-w-[410px] flex-col gap-3 sm:right-5 sm:top-5 sm:w-full"
        aria-live="assertive"
        aria-atomic="false"
      >
        {kitchenStatusAlerts.map((alert) => (
          <KitchenStatusNotification
            key={alert.id}
            alert={alert}
            onDismiss={dismissKitchenStatusAlert}
            onReview={reviewKitchenStatusAlert}
          />
        ))}

        {incomingOrderAlerts.map((order) => {
          const orderNumber = order.orderNumber || `#${String(order.id || '').slice(-6).toUpperCase()}`;
          const itemCount = getOrderItemCount(order);
          const source = order.source || (order.orderType === 'DELIVERY' ? 'DELIVERY' : 'QR');

          return (
            <article
              key={order.id}
              role="alert"
              className="pointer-events-auto overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.28)] ring-1 ring-amber-100"
            >
              <div className="h-1.5 bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500" />
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="relative mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                    <span className="absolute inset-0 rounded-xl bg-amber-300/50 animate-ping" />
                    <Icon name="bell" className="relative h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-amber-700">
                        New incoming order
                      </p>
                      <SourceBadge source={source} compact />
                    </div>
                    <h2 className="mt-1 text-lg font-extrabold tracking-tight text-slate-950">
                      {getOrderContextLabel(order)}
                    </h2>
                    <p className="mt-0.5 truncate text-sm font-semibold text-slate-700">
                      {getOrderHeadline(order)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => dismissIncomingOrderAlert(order.id)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
                    aria-label={`Dismiss ${orderNumber} notification`}
                  >
                    <Icon name="close" className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-900">{orderNumber}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {itemCount} item{itemCount === 1 ? '' : 's'} · {formatTimeOnly(order.createdAt)}
                    </p>
                  </div>
                  <p className="shrink-0 text-base font-extrabold text-[var(--color-primary)]">
                    {formatMoney(order.grandTotal)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => reviewIncomingOrder(order)}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800"
                >
                  Review order
                  <Icon name="arrowRight" className="h-4 w-4" />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {notificationCenterOpen ? (
        <aside className="fixed right-3 top-3 z-[130] flex max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[420px] flex-col overflow-hidden rounded-[24px] border border-white/80 bg-white/90 shadow-[0_30px_90px_rgba(15,23,42,0.3)] ring-1 ring-slate-900/10 backdrop-blur-2xl sm:right-5 sm:top-5 sm:w-full">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Notification Center</p>
              <h2 className="mt-0.5 text-lg font-extrabold tracking-tight text-slate-950">
                Recent activity
                {unreadNotificationCount > 0 ? <span className="ml-2 text-sm font-bold text-rose-500">{unreadNotificationCount} new</span> : null}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setNotificationCenterOpen(false)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
              aria-label="Close notification center"
            >
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center justify-between border-b border-slate-200/70 px-5 py-2.5 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setNotifications((previous) => previous.map((entry) => ({ ...entry, read: true })))}
              disabled={unreadNotificationCount === 0}
              className="text-sky-700 transition hover:text-sky-900 disabled:cursor-default disabled:text-slate-300"
            >
              Mark all as read
            </button>
            <button
              type="button"
              onClick={() => setNotifications([])}
              disabled={notifications.length === 0}
              className="text-slate-500 transition hover:text-slate-800 disabled:cursor-default disabled:text-slate-300"
            >
              Clear history
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {notifications.length === 0 ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center px-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <Icon name="bell" className="h-6 w-6" />
                </div>
                <h3 className="mt-3 text-sm font-bold text-slate-800">You are all caught up</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">New table orders and kitchen updates will remain here until you clear them.</p>
              </div>
            ) : notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => reviewStoredNotification(notification)}
                className={cx(
                  'relative flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition hover:-translate-y-px hover:shadow-sm',
                  notification.read
                    ? 'border-slate-200 bg-white/70'
                    : 'border-sky-200 bg-sky-50/90 ring-1 ring-sky-100'
                )}
              >
                {!notification.read ? <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-sky-500" /> : null}
                <span className={cx(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm',
                  notification.type === 'order_ready'
                    ? 'bg-emerald-500'
                    : notification.type === 'new_order'
                      ? 'bg-orange-500'
                      : 'bg-violet-500'
                )}>
                  <Icon name={notification.type === 'order_ready' ? 'check' : 'bell'} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1 pr-3">
                  <span className="block truncate text-sm font-bold text-slate-900">{notification.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-600">{notification.message}</span>
                  <span className="mt-1.5 block text-[10px] font-semibold text-slate-400">{formatTimestamp(notification.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>
      ) : null}

      <section className="flex min-h-[70vh] min-w-0 flex-1 flex-col overflow-hidden border-b border-slate-200 bg-white xl:min-h-0 xl:border-b-0 xl:border-r">
        <header className="border-b border-slate-200 bg-white px-4 py-2.5 text-slate-900 md:px-5">
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new Event('dine3d:open-admin-sidebar'))}
                  className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:border-slate-300 hover:bg-white"
                  aria-label="Open navigation"
                >
                  <span className="text-lg leading-none">☰</span>
                </button>
                {/* Whose till this is. Small, and left of the name it belongs to. */}
                <RestaurantMark restaurant={restaurant} size={40} rounded="rounded-xl" className="mt-0.5" />
                <div>
                  <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                    <Icon name="terminal" className="h-3 w-3" />
                    Main Terminal
                  </div>
                  <h1 className="text-lg font-bold tracking-tight text-slate-900">
                    {restaurant?.name || 'POS Pro'}
                  </h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="location" className="h-3.5 w-3.5" />
                      {restaurant?.slug ? `/${restaurant.slug}` : 'Station 01'}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="clock" className="h-3.5 w-3.5" />
                      {formatTimeOnly(new Date())}
                    </span>
                    {lastOrder?.order?.orderNumber ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                        Last ticket {lastOrder.order.orderNumber}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 xl:w-[360px]">
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                    <Icon name="search" className="h-3.5 w-3.5" />
                  </span>
                  <input
                    ref={searchRef}
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search items or use F2"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-10 pr-3 text-[12px] text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-[var(--color-primary)] focus:bg-white"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
                  <button
                    type="button"
                    onClick={enableDesktopAlerts}
                    className={cx(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition',
                      notificationPermission === 'granted'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-300'
                        : notificationPermission === 'denied'
                          ? 'border-amber-200 bg-amber-50 text-amber-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    )}
                    title={notificationPermission === 'denied'
                      ? 'Desktop notifications are blocked in browser settings. In-app alerts remain active.'
                      : 'Enable sound and Mac-style desktop order notifications'}
                  >
                    <Icon name="bell" className="h-4 w-4" />
                    {notificationPermission === 'granted'
                      ? 'Alerts On'
                      : notificationPermission === 'denied'
                        ? 'In-app Alerts'
                        : notificationPermission === 'unsupported'
                          ? 'In-app Alerts'
                          : 'Enable Alerts'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNotificationCenterOpen((open) => !open)}
                    className={cx(
                      'relative inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition',
                      notificationCenterOpen
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    )}
                    aria-label={`Notification center, ${unreadNotificationCount} unread`}
                  >
                    <Icon name="bell" className="h-4 w-4" />
                    History
                    {unreadNotificationCount > 0 ? (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-black text-white">
                        {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                      </span>
                    ) : null}
                  </button>
                  <button
                    onClick={() => {
                      setShowOrders((previous) => {
                        const next = !previous;
                        if (next) setShowHeldTabs(false);
                        return next;
                      });
                    }}
                    className={cx(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition',
                      showOrders
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    )}
                  >
                    <Icon name="receipt" className="h-4 w-4" />
                    Active {activeOrders.length}
                  </button>
                  {canReadTabs ? (
                    <button
                      onClick={() => {
                        setShowHeldTabs((previous) => {
                          const next = !previous;
                          if (next) setShowOrders(false);
                          return next;
                        });
                      }}
                      className={cx(
                        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition',
                        showHeldTabs
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      )}
                    >
                      <Icon name="hold" className="h-4 w-4" />
                      Held {heldTabs.length}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                  {showOrders ? 'Viewing Active Orders' : showHeldTabs ? 'Viewing Held Tabs' : activeCategoryName}
                </span>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                  {filteredItems.length} visible items
                </span>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                  {cartLineCount} in ticket
                </span>
                {!activeShift ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    Shift closed
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <label className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                  <span className="hidden 2xl:inline">Menu size</span>
                  <select
                    aria-label="Menu card density"
                    value={menuDensity}
                    onChange={(event) => selectMenuDensity(event.target.value)}
                    className="min-w-0 bg-transparent font-bold text-slate-800 outline-none"
                  >
                    {Object.entries(POS_MENU_DENSITIES).map(([value, option]) => (
                      <option key={value} value={value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                {(canQuickLogin || canOpenShift || canWriteShift || canCloseShift) ? (
                <button
                  onClick={() => setShowCashierPanel(true)}
                  className={cx(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition',
                    activeShift
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-300'
                      : 'border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-300'
                  )}
                >
                  <Icon name="user" className="h-3.5 w-3.5" />
                  <span>{activeStaff ? activeStaff.name : 'Cashier offline'}</span>
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em]">
                    {activeShift ? 'Shift Open' : 'Shift Closed'}
                  </span>
                </button>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        {!showOrders && !showHeldTabs ? (
          <>
            <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-200 bg-slate-50 px-4 py-2.5 md:px-5 xl:hidden">
              <button
                onClick={() => {
                  setActiveCategory('ALL');
                  setSearchQuery('');
                }}
                className={cx(
                  'whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                  activeCategory === 'ALL'
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                )}
              >
                All Items
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => {
                    setActiveCategory(category.id);
                    setSearchQuery('');
                  }}
                  className={cx(
                    'whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                    activeCategory === category.id
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                  )}
                >
                  {category.name}
                </button>
              ))}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <aside className="hidden w-[148px] shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-slate-200 bg-slate-50 p-2.5 xl:flex">
                  <p className="px-2 pb-1 pt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Menu groups</p>
                  <button
                    onClick={() => { setActiveCategory('ALL'); setSearchQuery(''); }}
                    className={cx(
                      'rounded-xl px-3 py-3 text-left text-xs font-bold transition',
                      activeCategory === 'ALL'
                        ? 'bg-slate-950 text-white shadow-sm'
                        : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-950'
                    )}
                  >
                    All Items
                    <span className="mt-1 block text-[10px] font-semibold opacity-60">{menuItems.filter((item) => item.isAvailable).length} products</span>
                  </button>
                  {categories.map((category) => {
                    const itemCount = menuItems.filter((item) => item.isAvailable && item.categoryId === category.id).length;
                    return (
                      <button
                        key={category.id}
                        onClick={() => { setActiveCategory(category.id); setSearchQuery(''); }}
                        className={cx(
                          'rounded-xl px-3 py-3 text-left text-xs font-bold transition',
                          activeCategory === category.id
                            ? 'bg-[var(--color-primary)] text-white shadow-sm'
                            : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-950'
                        )}
                      >
                        <span className="block truncate">{category.name}</span>
                        <span className="mt-1 block text-[10px] font-semibold opacity-60">{itemCount} items</span>
                      </button>
                    );
                  })}
                </aside>

                <div className="pos-menu-surface min-h-0 min-w-0 flex-1 overflow-y-auto bg-slate-50/40 px-4 py-3 md:px-5">
                {filteredItems.length === 0 ? (
                  <EmptyPane
                    icon="search"
                    title="No menu items found"
                    message={searchQuery
                      ? `No available items match "${searchQuery}".`
                      : 'Add menu items or switch to another category to start taking orders.'}
                    actionLabel={searchQuery ? 'Clear search' : null}
                    onAction={searchQuery ? () => setSearchQuery('') : null}
                  />
                ) : (
                  <div
                    className="pos-menu-grid grid gap-2.5"
                    style={{ '--pos-menu-card-min': `${POS_MENU_DENSITIES[menuDensity].cardMinWidth}px` }}
                  >
                    {filteredItems.map((item) => (
                      <MenuProductCard
                        key={item.id}
                        item={item}
                        canCreateOrder={canCreateOrder}
                        currencySymbol={currencySymbol}
                        onAdd={initiateAddToCart}
                      />
                    ))}
                  </div>
                )}
                </div>
              </div>

              <div className={cx(
                'border-t border-slate-200 px-4 py-1.5 md:px-5',
                queueOrders.length > 0 ? 'bg-amber-50/65' : 'bg-white'
              )}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="relative flex h-5 w-5 items-center justify-center">
                      {queueOrders.length > 0 ? (
                        <span className="absolute inset-0 rounded-md bg-amber-300/60 animate-ping" />
                      ) : null}
                      <span className={cx(
                        'relative flex h-5 w-5 items-center justify-center rounded-md',
                        queueOrders.length > 0
                          ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200'
                          : 'bg-[var(--color-primary-glow)] text-[var(--color-primary)]'
                      )}>
                        <Icon name="spark" className="h-2.5 w-2.5" />
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <h2 className="text-[11px] font-bold leading-none text-slate-900">Live Remote Orders</h2>
                      <span className={cx(
                        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase leading-none tracking-[0.1em] ring-1',
                        queueOrders.length > 0
                          ? 'bg-amber-100 text-amber-800 ring-amber-200'
                          : 'bg-slate-100 text-slate-600 ring-slate-200'
                      )}>
                        {queueOrders.length > 0 ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" /> : null}
                        {onlineOrders.length} pending
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setShowOrders(true);
                      setShowHeldTabs(false);
                    }}
                    className={cx(
                      'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[8px] font-semibold transition',
                      queueOrders.length > 0
                        ? 'bg-[var(--color-primary)] text-white shadow-sm hover:opacity-90'
                        : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'
                    )}
                  >
                    Queue
                    <Icon name="arrowRight" className="h-2.5 w-2.5" />
                  </button>
                </div>

                <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                  {queueOrders.map((order) => {
                    const sourceLabel = order.source || (order.orderType === 'DELIVERY' ? 'DELIVERY' : 'QR');
                    const isDelivery = String(sourceLabel).toUpperCase() === 'DELIVERY';
                    const accentClass = isDelivery ? 'bg-[var(--color-primary)]' : 'bg-sky-500';

                    return (
                    <button
                      key={order.id}
                      onClick={() => setSelectedQueueOrder(order)}
                      className="group flex h-12 min-w-[178px] max-w-[206px] flex-1 items-stretch overflow-hidden rounded-lg border border-amber-200 bg-white text-left shadow-[0_4px_12px_rgba(245,158,11,0.1)] ring-1 ring-amber-100/80 transition hover:-translate-y-[1px] hover:border-[var(--color-primary)] hover:shadow-[0_8px_18px_rgba(255,107,53,0.12)]"
                    >
                      <span className={cx('w-1.5 shrink-0', accentClass)} />
                      <div className="flex min-w-0 flex-1 flex-col justify-center px-2.5 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1">
                            <SourceBadge source={sourceLabel} compact />
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[7px] font-semibold uppercase leading-none tracking-[0.08em] text-amber-700">
                              {getOrderContextLabel(order)}
                            </span>
                          </div>
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[8px] font-semibold leading-none text-slate-600">
                            {formatTimeOnly(order.createdAt)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <h3 className="min-w-0 truncate text-[10px] font-bold leading-none text-slate-900 group-hover:text-[var(--color-primary)]">
                            {getOrderHeadline(order)}
                          </h3>
                          <span className="shrink-0 text-[8px] font-semibold uppercase leading-none tracking-[0.08em] text-amber-700">
                            Review
                          </span>
                        </div>
                      </div>
                    </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        ) : null}

        {showOrders ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-4 md:px-5">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Active Orders</h2>
                  <p className="text-sm text-slate-500">
                    Kitchen queue, payment collection, table transfers, and merge tools.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
                    {UNIFIED_CHANNEL_TABS.map((tab) => (
                      <button
                        key={tab.value}
                        onClick={() => {
                          setActiveChannelTab(tab.value);
                          setSelectedMergeOrders([]);
                        }}
                        className={cx(
                          'rounded-lg px-4 py-2 text-sm font-semibold transition',
                          activeChannelTab === tab.value
                            ? 'bg-[var(--color-primary)] text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        )}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <select
                    value={orderViewFilter}
                    onChange={(event) => setOrderViewFilter(event.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-[var(--color-primary)]"
                  >
                    <option value="ALL">All Orders</option>
                    <option value="TABLE">Table Orders</option>
                    <option value="NON_TABLE">Counter and Takeaway</option>
                  </select>

                  {canPay ? (
                    <input
                      type="number"
                      min="2"
                      max="10"
                      value={splitCount}
                      onChange={(event) => setSplitCount(Math.max(2, parseInt(event.target.value, 10) || 2))}
                      className="w-24 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-[var(--color-primary)]"
                    />
                  ) : null}

                  <button
                    onClick={() => loadActiveOrders(activeChannelTab)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                  >
                    <Icon name="refresh" className="h-4 w-4" />
                    Refresh
                  </button>

                  {canWriteOrders ? (
                    <button
                      onClick={handleMergeSelection}
                      disabled={selectedMergeOrders.length < 2}
                      className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-violet-300"
                    >
                      <Icon name="split" className="h-4 w-4" />
                      Merge {selectedMergeOrders.length > 0 ? `(${selectedMergeOrders.length})` : ''}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
              {visibleActiveOrders.length === 0 ? (
                <EmptyPane
                  icon="receipt"
                  title="No active orders right now"
                  message="The terminal is clear. Incoming POS, QR, and delivery orders will appear here."
                  actionLabel="Back to menu"
                  onAction={() => setShowOrders(false)}
                />
              ) : (
                <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                  {visibleActiveOrders.map((order) => {
                    const nextStatus = getNextStatus(order.status);
                    const isSelectedForMerge = selectedMergeOrders.includes(order.id);
                    const isTableOrder = TABLE_ORDER_TYPES.has(order.orderType) || !!order.table?.tableNumber;
                    const sourceLabel = (order.source || '').toUpperCase()
                      || (order.orderType === 'DELIVERY' ? 'DELIVERY' : isTableOrder ? 'QR' : 'POS');

                    return (
                      <article
                        key={order.id}
                        className={cx(
                          'rounded-xl border bg-white p-4 shadow-sm transition',
                          isSelectedForMerge ? 'border-violet-300 ring-2 ring-violet-100' : 'border-slate-200'
                        )}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3">
                            {canWriteOrders ? (
                              <input
                                type="checkbox"
                                checked={isSelectedForMerge}
                                onChange={(event) => {
                                  setSelectedMergeOrders((previous) => {
                                    if (event.target.checked) {
                                      return previous.includes(order.id) ? previous : [...previous, order.id];
                                    }
                                    return previous.filter((id) => id !== order.id);
                                  });
                                }}
                                className="mt-1 h-4 w-4 accent-violet-600"
                              />
                            ) : null}

                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <SourceBadge source={sourceLabel} />
                                <StatusBadge status={order.status} />
                                {order.paymentStatus === 'PAID' ? (
                                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
                                    Paid
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
                                    Payment due
                                  </span>
                                )}
                              </div>

                              <h3 className="mt-3 text-lg font-bold text-slate-900">
                                {order.orderNumber || `#${order.id.slice(-6)}`}
                              </h3>

                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                                <span>{order.orderType}</span>
                                <span>{(order.items || []).length} items</span>
                                {order.table?.tableNumber ? <span>Table {order.table.tableNumber}</span> : null}
                                <span>{formatTimestamp(order.createdAt)}</span>
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="text-xl font-extrabold tracking-tight text-[var(--color-primary)]">
                              {formatMoney(order.grandTotal)}
                            </div>
                            <div className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                              {order.customerName || 'Walk-in'}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                          {(order.items || []).length > 0 ? (
                            <div className="space-y-1">
                              {(order.items || []).slice(0, 3).map((item, index) => (
                                <div key={`${order.id}-${item.name}-${index}`} className="flex items-center justify-between gap-3">
                                  <span className="truncate">
                                    {item.quantity}x {item.name}
                                  </span>
                                  <span className="font-semibold text-slate-500">
                                    {formatMoney(item.itemTotal || item.variantPrice || item.basePrice)}
                                  </span>
                                </div>
                              ))}
                              {(order.items || []).length > 3 ? (
                                <div className="pt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                                  +{order.items.length - 3} more lines
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <p>No items found for this order.</p>
                          )}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {canPay && order.paymentStatus !== 'PAID' ? (
                            <button
                              onClick={() => handlePayOrder(order.id)}
                              disabled={processing}
                              className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Icon name="wallet" className="h-4 w-4" />
                              Collect Payment
                            </button>
                          ) : null}

                          {canUpdateOrderStatus && nextStatus ? (
                            <button
                              onClick={() => handleTransitionOrder(order, nextStatus)}
                              className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:border-sky-300 hover:bg-sky-100"
                            >
                              <Icon name="arrowRight" className="h-4 w-4" />
                              Move to {nextStatus}
                            </button>
                          ) : null}

                          {(canPay || canCreateOrder || canWriteOrders || canVoidOrder || canUpdateOrderStatus) ? (
                          <select
                            defaultValue=""
                            onChange={(event) => {
                              const action = event.target.value;
                              if (!action) return;

                              if (action === 'split') handleSplitExistingOrder(order.id);
                              if (action === 'repeat') handleRepeatOrder(order.id);
                              if (action === 'transfer') handleTransferTable(order.id);
                              if (action === 'void') handleVoidOrder(order.id);
                              if (action === 'cancel') handleTransitionOrder(order, 'CANCELLED');

                              event.target.value = '';
                            }}
                            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-[var(--color-primary)]"
                          >
                            <option value="" disabled>More actions</option>
                            {canPay && order.paymentStatus !== 'PAID' ? <option value="split">Split bill x{splitCount}</option> : null}
                            {canCreateOrder ? <option value="repeat">Repeat order</option> : null}
                            {canWriteOrders && order.orderType === 'DINE_IN' ? <option value="transfer">Transfer table</option> : null}
                            {canVoidOrder && order.paymentStatus !== 'PAID' ? <option value="void">Void unpaid order</option> : null}
                            {canUpdateOrderStatus ? <option value="cancel">Cancel order</option> : null}
                          </select>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {showHeldTabs ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-4 md:px-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Held Tabs</h2>
                  <p className="text-sm text-slate-500">
                    Park tickets here and resume them when the guest is ready.
                  </p>
                </div>
                <button
                  onClick={loadHeldTabs}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                >
                  <Icon name="refresh" className="h-4 w-4" />
                  Refresh tabs
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
              {heldTabs.length === 0 ? (
                <EmptyPane
                  icon="hold"
                  title="No held tabs"
                  message="Use Hold Tab from the order summary to temporarily park a guest's order."
                  actionLabel="Back to menu"
                  onAction={() => setShowHeldTabs(false)}
                />
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {heldTabs.map((tab) => (
                    <article
                      key={tab.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800 ring-1 ring-amber-200">
                            Held tab
                          </div>
                          <h3 className="mt-3 text-lg font-bold text-slate-900">{tab.tabName}</h3>
                          <p className="mt-2 text-sm text-slate-500">
                            {tab.orderType} | {tab.customerName || 'Walk-in'}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-slate-400">
                          {formatTimestamp(tab.createdAt)}
                        </span>
                      </div>

                      <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        Ready to resume on this terminal.
                      </div>

                      {canResumeTabs ? (
                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={() => handleResumeTab(tab.id)}
                          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                        >
                          <Icon name="arrowRight" className="h-4 w-4" />
                          Resume tab
                        </button>
                      </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <aside
        ref={ticketPanelRef}
        className={cx(
          'pos-ticket-panel relative flex min-h-[55vh] min-w-0 w-full flex-col border-t border-slate-200 bg-slate-50 xl:min-h-0 xl:border-l xl:border-t-0',
          ticketPanelResizing && 'is-resizing'
        )}
        style={{ '--pos-ticket-panel-width': `${ticketPanelWidth}px` }}
      >
        <div
          role="separator"
          aria-label="Resize order summary panel"
          aria-orientation="vertical"
          aria-valuemin={POS_TICKET_PANEL_MIN_WIDTH}
          aria-valuemax={POS_TICKET_PANEL_MAX_WIDTH}
          aria-valuenow={ticketPanelWidth}
          tabIndex={0}
          onPointerDown={startTicketPanelResize}
          onKeyDown={resizeTicketPanelByKeyboard}
          onDoubleClick={() => {
            const workspaceWidth = posWorkspaceRef.current?.getBoundingClientRect().width;
            const next = clampTicketPanelWidth(POS_TICKET_PANEL_DEFAULT_WIDTH, workspaceWidth);
            setTicketPanelWidth(next);
            persistTicketPanelWidth(next);
          }}
          className="pos-ticket-resizer hidden xl:flex"
          title="Drag to resize · Arrow keys adjust · Double-click resets"
        >
          <span />
        </div>
        <div className="border-b border-slate-200 bg-white px-4 py-3 md:px-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Order Summary
                </p>
                <span className="hidden shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-slate-500 xl:inline">
                  {ticketPanelWidth}px
                </span>
              </div>
              <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-900">
                {canCreateOrder ? 'New Ticket' : 'Order Viewer'}
              </h2>
              <p className="mt-1 text-[13px] text-slate-500">
                {cartLineCount > 0 ? `${cartLineCount} item${cartLineCount === 1 ? '' : 's'} ready` : 'Start a fresh order from the menu'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Items</p>
              <p className="mt-1 text-lg font-extrabold tracking-tight text-slate-900">{cartLineCount}</p>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 md:px-4">
          {cart.length === 0 ? (
            <EmptyPane
              icon="cart"
              title="Cart is empty"
              message="Tap a menu item to start building this ticket."
              compact
            />
          ) : (
            <div className="space-y-1.5">
              {cart.map((item) => (
                <div
                  key={item.cartKey}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-[13px] font-bold text-slate-900">{item.name}</h4>
                      {item.variantName ? (
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{item.variantName}</p>
                      ) : null}
                      {item.modifiers?.length > 0 ? (
                        <p className="mt-0.5 truncate text-[10px] leading-4 text-slate-500" title={item.modifiers.map((modifier) => `${modifier.group}: ${modifier.option}`).join(' · ')}>
                          + {item.modifiers.map((modifier) => `${modifier.group}: ${modifier.option}`).join(' · ')}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <div className="text-[13px] font-extrabold text-slate-900">
                        {formatMoney(item.price * item.quantity)}
                      </div>
                      {canCreateOrder ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => removeFromCart(item.cartKey)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600 transition hover:bg-rose-100"
                            aria-label={`Remove ${item.name} from ticket`}
                          >
                            <Icon name="trash" className="h-3.5 w-3.5" />
                          </button>
                          <div className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                            <button
                              onClick={() => updateCartQty(item.cartKey, -1)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-slate-600 transition hover:text-slate-900"
                              aria-label={`Decrease ${item.name} quantity`}
                            >
                              <Icon name="minus" className="h-3.5 w-3.5" />
                            </button>
                            <span className="w-7 text-center text-xs font-bold text-slate-900">{item.quantity}</span>
                            <button
                              onClick={() => updateCartQty(item.cartKey, 1)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-slate-600 transition hover:text-slate-900"
                              aria-label={`Increase ${item.name} quantity`}
                            >
                              <Icon name="plus" className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-8px_20px_rgba(15,23,42,0.04)] md:px-4">
          <div className="relative">
            {previewLoading ? (
              <div className="absolute -top-7 left-0 right-0 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-primary)]">
                Calculating live totals
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <SummaryRow label="Subtotal" value={formatMoney(previewSubtotal)} />
            {previewTax > 0 ? <SummaryRow label="Tax" value={formatMoney(previewTax)} /> : null}
            {previewOtherCharges > 0 ? <SummaryRow label="Service and fees" value={formatMoney(previewOtherCharges)} /> : null}
            {previewDeliveryFee > 0 ? <SummaryRow label="Delivery fee" value={formatMoney(previewDeliveryFee)} /> : null}
            <div className="flex items-end justify-between border-t border-slate-200 pt-3">
              <span className="text-base font-bold text-slate-900">Total</span>
              <span className="text-2xl font-extrabold tracking-tight text-[var(--color-primary)]">
                {formatMoney(cartTotal)}
              </span>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            {canCreateOrder ? <button
              onClick={clearCart}
              disabled={cart.length === 0}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="trash" className="h-3.5 w-3.5" />
              Clear
            </button> : null}
            <button
              onClick={() => {
                if (paymentMethod === 'split') setPaymentMethod('CASH');
                setAmountTendered('');
                setShowPayment(true);
              }}
              disabled={!canOpenCheckout}
              className="inline-flex flex-[1.5] items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Icon name="arrowRight" className="h-4 w-4" />
              Continue
            </button>
          </div>

          <p className="mt-2 text-[11px] leading-5 text-slate-500">
            Checkout opens the dining options, customer details, and payment flow in one popup.
          </p>
        </div>
      </aside>

      {inputDialog}

      {showCashierPanel ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                  POS Header Controls
                </p>
                <h3 className="mt-1 text-xl font-extrabold tracking-tight text-slate-900">
                  POS Operator
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Personal PIN permissions, shift access, and cash drawer tools for this terminal.
                </p>
              </div>

              <button
                onClick={() => setShowCashierPanel(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
              >
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-700">
                  <Icon name="user" className="h-3.5 w-3.5" />
                  {activeStaff ? `${activeStaff.name} (${activeStaff.role})` : 'Cashier offline'}
                </span>
                <span className={cx(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold',
                  activeShift
                    ? 'bg-emerald-100 text-emerald-900'
                    : 'bg-amber-100 text-amber-900'
                )}>
                  <Icon name="clock" className="h-3.5 w-3.5" />
                  {activeShift ? 'Shift Open' : 'Shift Closed'}
                </span>
              </div>

              {activeStaff ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm font-bold text-emerald-950">
                    Signed in as {activeStaff.name}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-emerald-800">
                    Every sale, refund and drawer movement from this terminal is recorded
                    against them, and this screen now shows only what a {activeStaff.role} may do.
                    Signing out locks the terminal until someone enters their PIN. The shift
                    stays open — use Close Shift to count the drawer and end it.
                  </p>
                  <button
                    type="button"
                    onClick={handleQuickLogout}
                    className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 text-sm font-bold text-emerald-900 transition hover:bg-emerald-100"
                  >
                    <Icon name="close" className="h-4 w-4" />
                    Sign out and lock terminal
                  </button>
                </div>
              ) : null}

              {!activeShift ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {activeStaff
                    ? 'Open a shift before collecting payments from this terminal.'
                    : 'Quick-login staff first, then open a shift to begin cashier operations.'}
                </div>
              ) : null}

              {canQuickLogin ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {activeStaff ? 'Switch Operator' : 'Operator Login'}
                </p>
                <div className="mt-3 flex gap-2">
                  <div className="flex flex-1 items-center rounded-xl border border-slate-200 bg-white px-3">
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={4}
                      value={quickPin}
                      onChange={(event) => {
                        setQuickPin(event.target.value.replace(/\D/g, '').slice(0, 4));
                        setQuickLoginError('');
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleQuickLogin();
                      }}
                      placeholder="4-digit PIN"
                      className="h-10 flex-1 bg-transparent text-center font-mono text-lg font-bold tracking-[0.45em] text-slate-900 placeholder:text-left placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 outline-none"
                    />
                  </div>
                  <button
                    onClick={handleQuickLogin}
                    disabled={quickPin.length !== 4 || quickLoginLoading}
                    className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {quickLoginLoading ? 'Verifying…' : activeStaff ? 'Switch' : 'Unlock'}
                  </button>
                </div>
              </div>
              ) : null}

              {!activeShift && canOpenShift ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Shift Start
                  </p>
                  <div className="mt-3 flex gap-2">
                    <div className="flex flex-1 items-center rounded-xl border border-slate-200 bg-white px-3">
                      <input
                        type="number"
                        value={openingFloat}
                        onChange={(event) => setOpeningFloat(event.target.value)}
                        placeholder="Opening float"
                        className="h-10 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none"
                      />
                    </div>
                    <button
                      onClick={handleOpenShift}
                      disabled={!activeStaff}
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Open Shift
                    </button>
                  </div>
                </div>
              ) : activeShift && (canWriteShift || canCloseShift) ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Drawer Actions
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {canWriteShift ? <button
                      onClick={() => handleDrawerMovement('CASH_IN')}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
                    >
                      Cash In
                    </button> : null}
                    {canWriteShift ? <button
                      onClick={() => handleDrawerMovement('CASH_OUT')}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
                    >
                      Cash Out
                    </button> : null}
                    {canCloseShift ? <button
                      onClick={handleCloseShift}
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-rose-100 px-3 text-sm font-semibold text-rose-900 transition hover:bg-rose-50"
                    >
                      Close Shift
                    </button> : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {selectedQueueOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <SourceBadge source={selectedQueueOrder.source || (selectedQueueOrder.orderType === 'DELIVERY' ? 'DELIVERY' : 'QR')} />
                  <StatusBadge status={selectedQueueOrder.status} />
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {getOrderContextLabel(selectedQueueOrder)}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-bold tracking-tight text-slate-900">
                  {getOrderHeadline(selectedQueueOrder)}
                </h3>
                <p className="mt-1 text-[13px] text-slate-500">
                  {selectedQueueOrder.orderNumber || `#${selectedQueueOrder.id.slice(-6)}`}
                  {selectedQueueOrder.customerName ? ` · ${selectedQueueOrder.customerName}` : ''}
                </p>
              </div>
              <button
                onClick={() => setSelectedQueueOrder(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
              >
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Time</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{formatTimeOnly(selectedQueueOrder.createdAt)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Total</p>
                <p className="mt-1 text-sm font-semibold text-[var(--color-primary)]">{formatMoney(selectedQueueOrder.grandTotal)}</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Items</p>
              <div className="mt-2 space-y-1.5">
                {(selectedQueueOrder.items || []).length > 0 ? (
                  selectedQueueOrder.items.map((item, index) => (
                    <div key={`${selectedQueueOrder.id}-${item.name}-${index}`} className="flex items-center justify-between gap-3 text-[13px] text-slate-700">
                      <span className="truncate">{item.quantity}x {item.name}</span>
                      <span className="shrink-0 font-semibold text-slate-500">
                        {formatMoney(item.itemTotal || item.variantPrice || item.basePrice)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-[13px] text-slate-500">No items found for this order.</p>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {canPay && selectedQueueOrder.paymentStatus !== 'PAID' ? (
                <button
                  onClick={() => {
                    setSelectedQueueOrder(null);
                    handlePayOrder(selectedQueueOrder.id);
                  }}
                  disabled={processing}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3.5 py-2.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Icon name="wallet" className="h-3.5 w-3.5" />
                  Collect Payment
                </button>
              ) : (
                <div className="inline-flex items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-700">
                  Paid
                </div>
              )}

              {canUpdateOrderStatus && getNextStatus(selectedQueueOrder.status) ? (
                <button
                  onClick={() => {
                    const nextStatus = getNextStatus(selectedQueueOrder.status);
                    setSelectedQueueOrder(null);
                    handleTransitionOrder(selectedQueueOrder, nextStatus);
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-xs font-semibold text-sky-800 transition hover:border-sky-300 hover:bg-sky-100"
                >
                  <Icon name="arrowRight" className="h-3.5 w-3.5" />
                  Move to {getNextStatus(selectedQueueOrder.status)}
                </button>
              ) : (
                <button
                  onClick={() => {
                    setSelectedQueueOrder(null);
                    setShowOrders(true);
                    setShowHeldTabs(false);
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                >
                  Open Queue
                </button>
              )}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              {(canPay || canCreateOrder || canWriteOrders || canVoidOrder || canUpdateOrderStatus) ? (
              <select
                defaultValue=""
                onChange={(event) => {
                  const action = event.target.value;
                  if (!action) return;

                  setSelectedQueueOrder(null);

                  if (action === 'split') handleSplitExistingOrder(selectedQueueOrder.id);
                  if (action === 'repeat') handleRepeatOrder(selectedQueueOrder.id);
                  if (action === 'transfer') handleTransferTable(selectedQueueOrder.id);
                  if (action === 'void') handleVoidOrder(selectedQueueOrder.id);
                  if (action === 'cancel') handleTransitionOrder(selectedQueueOrder, 'CANCELLED');

                  event.target.value = '';
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none transition focus:border-[var(--color-primary)]"
              >
                <option value="" disabled>More actions</option>
                {canPay && selectedQueueOrder.paymentStatus !== 'PAID' ? <option value="split">Split bill</option> : null}
                {canCreateOrder ? <option value="repeat">Repeat order</option> : null}
                {canWriteOrders && selectedQueueOrder.orderType === 'DINE_IN' ? <option value="transfer">Transfer table</option> : null}
                {canVoidOrder && selectedQueueOrder.paymentStatus !== 'PAID' ? <option value="void">Void unpaid order</option> : null}
                {canUpdateOrderStatus ? <option value="cancel">Cancel order</option> : null}
              </select>
              ) : <div />}

              <button
                onClick={() => {
                  setSelectedQueueOrder(null);
                  setShowOrders(true);
                  setShowHeldTabs(false);
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
              >
                Full Queue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showPayment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                    Checkout Ticket
                  </p>
                  <h3 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
                    {formatMoney(cartTotal)}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Finish service details and payment for this {cartLineCount}-item ticket.
                  </p>
                </div>
                <button
                  onClick={() => setShowPayment(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-5">
                  <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Service Details
                        </p>
                        <h4 className="mt-1 text-base font-bold text-slate-900">
                          Choose the order type and guest info
                        </h4>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200">
                        <Icon name={currentOrderTypeMeta.icon} className="h-3 w-3" />
                        {currentOrderTypeMeta.label}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      {ORDER_TYPES.map((type) => (
                        <button
                          key={type.value}
                          onClick={() => setOrderType(type.value)}
                          className={cx(
                            'inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition',
                            orderType === type.value
                              ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900'
                          )}
                        >
                          <Icon name={type.icon} className="h-4 w-4" />
                          {type.label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Customer Name
                        </label>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                            <Icon name="user" className="h-4 w-4" />
                          </span>
                          <input
                            type="text"
                            placeholder="Walk-in or customer name"
                            value={customerName}
                            onChange={(event) => setCustomerName(event.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-800 outline-none transition focus:border-[var(--color-primary)]"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Mobile Number <span className="font-medium normal-case tracking-normal text-slate-400">(optional)</span>
                        </label>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                            <Icon name="phone" className="h-4 w-4" />
                          </span>
                          <input
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            maxLength={24}
                            placeholder="+92 300 1234567"
                            value={customerPhone}
                            onChange={(event) => setCustomerPhone(event.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-800 outline-none transition focus:border-[var(--color-primary)]"
                          />
                        </div>
                        <p className="mt-1.5 text-[11px] text-slate-400">Used only for order-ready contact and receipt lookup.</p>
                      </div>

                      {orderType === 'DINE_IN' ? (
                        <div>
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            Table Number
                          </label>
                          <div className="relative">
                            <select
                              value={tableId}
                              onChange={(event) => setTableId(event.target.value)}
                              className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-3 pl-4 pr-10 text-sm font-semibold text-slate-800 outline-none transition focus:border-[var(--color-primary)]"
                            >
                              <option value="">Select table</option>
                              {tables.map((table) => (
                                <option key={table.id} value={table.id}>
                                  Table {table.tableNumber}{table.label ? ` (${table.label})` : ''}
                                </option>
                              ))}
                              <option value="WALK_IN">Walk-in Draft</option>
                            </select>
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                              <Icon name="chevronDown" className="h-4 w-4" />
                            </span>
                          </div>
                        </div>
                      ) : null}

                      {orderType === 'DELIVERY' ? (
                        <div>
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            Delivery Address
                          </label>
                          <textarea
                            value={deliveryAddress}
                            onChange={(event) => setDeliveryAddress(event.target.value)}
                            placeholder="House, street, area, city"
                            className="min-h-[88px] w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[var(--color-primary)]"
                          />
                        </div>
                      ) : null}

                      {orderType === 'DELIVERY' ? (
                        <div>
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            Delivery Rider
                          </label>
                          {!ridersLoaded ? (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                              Checking who is on shift…
                            </div>
                          ) : riders.length === 0 ? (
                            /* Not an error: the sale still goes through and a
                               manager assigns a rider from Delivery later. */
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                              No rider is on shift. The order will be taken and can be assigned from Delivery.
                            </div>
                          ) : (
                            <>
                              <select
                                value={riderId}
                                onChange={(event) => setRiderId(event.target.value)}
                                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[var(--color-primary)]"
                              >
                                <option value="">Choose a rider…</option>
                                {riders.map((rider) => (
                                  <option key={rider.id} value={rider.id}>
                                    {rider.name}
                                    {rider.activeDeliveries > 0 ? ` — ${rider.activeDeliveries} out` : ' — free'}
                                    {rider.branchName ? ` · ${rider.branchName}` : ''}
                                  </option>
                                ))}
                              </select>
                              <p className="mt-1.5 text-[11px] text-slate-400">
                                How many orders each rider already has, so the load can be spread.
                              </p>
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>

                    {orderValidationMessage ? (
                      <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-semibold text-rose-700">
                        {orderValidationMessage}
                      </div>
                    ) : null}
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Ticket Snapshot
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Items</p>
                        <p className="mt-1 text-sm font-bold text-slate-900">{cartLineCount}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Guest</p>
                        <p className="mt-1 truncate text-sm font-bold text-slate-900">{customerName || 'Walk-in'}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Table / Mode</p>
                        <p className="mt-1 truncate text-sm font-bold text-slate-900">
                          {orderType === 'DINE_IN'
                            ? (tableId === 'WALK_IN' ? 'Walk-in Draft' : selectedTable ? `Table ${selectedTable.tableNumber}` : 'Not selected')
                            : currentOrderTypeMeta.label}
                        </p>
                      </div>
                    </div>
                  </section>
                </div>

                <div className="space-y-5">
                  <section className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Payment Flow
                        </p>
                        <h4 className="mt-1 text-base font-bold text-slate-900">
                          Choose how this ticket will be paid
                        </h4>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {[
                        { value: 'CASH', label: 'Cash', icon: 'wallet' },
                        { value: 'CARD', label: 'Card', icon: 'card' },
                        { value: 'split', label: 'Split', icon: 'split' },
                      ].map((method) => (
                        <button
                          key={method.value}
                          onClick={() => setPaymentMethod(method.value)}
                          className={cx(
                            'rounded-xl border px-3 py-3 text-sm font-semibold transition',
                            paymentMethod === method.value
                              ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                              : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white'
                          )}
                        >
                          <span className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
                            <Icon name={method.icon} className="h-4 w-4" />
                          </span>
                          {method.label}
                        </button>
                      ))}
                    </div>

                    {paymentMethod === 'CASH' ? (
                      <div className="mt-4">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Amount Tendered
                        </label>
                        <input
                          type="number"
                          value={amountTendered}
                          onChange={(event) => setAmountTendered(event.target.value)}
                          placeholder={String(cartTotal.toFixed(2))}
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-4 text-center text-2xl font-extrabold tracking-tight text-slate-900 outline-none transition focus:border-[var(--color-primary)]"
                          autoFocus
                        />

                        <div className="mt-3 grid grid-cols-4 gap-2">
                          {[500, 1000, 2000, 5000].map((amount) => (
                            <button
                              key={amount}
                              onClick={() => setAmountTendered(String(amount))}
                              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                            >
                              {amount}
                            </button>
                          ))}
                        </div>

                        {changeAmount > 0 ? (
                          <div className="mt-4 rounded-xl border border-[rgba(255,107,53,0.18)] bg-[var(--color-primary-glow)] px-4 py-4 text-center">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">
                              Change Due
                            </p>
                            <p className="mt-2 text-3xl font-extrabold tracking-tight text-[var(--color-primary)]">
                              {formatMoney(changeAmount)}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {paymentMethod === 'CARD' ? (
                      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="flex items-center justify-between text-sm text-slate-500">
                          <span>Charge amount</span>
                          <span className="font-bold text-slate-900">{formatMoney(cartTotal)}</span>
                        </div>
                        <p className="mt-2 text-sm text-slate-500">
                          Complete the terminal handoff, then enter its authorization reference. The browser cannot confirm a card payment by itself.
                        </p>
                        <label className="mt-3 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Terminal authorization reference<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} maxLength={200} autoComplete="off" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-[var(--color-primary)]" /></label>
                      </div>
                    ) : null}

                    {paymentMethod === 'split' ? (
                      <div className="mt-4 space-y-4">
                        <div>
                          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            Split Count
                          </label>
                          <input
                            type="number"
                            min="2"
                            max="10"
                            value={splitCount}
                            onChange={(event) => setSplitCount(Math.max(2, parseInt(event.target.value, 10) || 2))}
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-4 text-center text-xl font-extrabold tracking-tight text-slate-900 outline-none transition focus:border-[var(--color-primary)]"
                          />
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                          <div className="flex items-center justify-between text-sm text-slate-500">
                            <span>Per guest</span>
                            <span className="font-bold text-slate-900">
                              {formatMoney(cartTotal / Math.max(2, splitCount))}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-slate-500">
                            Equal split payments will be created automatically and processed as cash.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Totals
                    </p>
                    <div className="mt-3 space-y-2">
                      <SummaryRow label="Subtotal" value={formatMoney(previewSubtotal)} />
                      {previewTax > 0 ? <SummaryRow label="Tax" value={formatMoney(previewTax)} /> : null}
                      {previewOtherCharges > 0 ? <SummaryRow label="Service and fees" value={formatMoney(previewOtherCharges)} /> : null}
                      {previewDeliveryFee > 0 ? <SummaryRow label="Delivery fee" value={formatMoney(previewDeliveryFee)} /> : null}
                      <div className="flex items-end justify-between border-t border-slate-200 pt-3">
                        <span className="text-base font-bold text-slate-900">Total</span>
                        <span className="text-2xl font-extrabold tracking-tight text-[var(--color-primary)]">
                          {formatMoney(cartTotal)}
                        </span>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-white px-5 py-4">
              <div className="grid gap-2 sm:grid-cols-3">
                <button
                  onClick={() => setShowPayment(false)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                >
                  Cancel
                </button>
                {canCreateOrder ? <button
                  onClick={() => handlePlaceOrder(false)}
                  disabled={!canSubmitOrder}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save Order
                </button> : null}
                {canHoldTabs ? <button
                  onClick={handleHoldCurrentTab}
                  disabled={cart.length === 0 || processing}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[rgba(255,107,53,0.18)] bg-[var(--color-primary-glow)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon name="hold" className="h-4 w-4" />
                  Hold Tab
                </button> : null}
              </div>
              {canPay ? <button
                onClick={() => handlePlaceOrder(true)}
                disabled={!canSubmitOrder}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Icon name="wallet" className="h-4 w-4" />
                {processing ? 'Processing...' : `Complete Payment ${formatMoney(cartTotal)}`}
              </button> : null}
            </div>
          </div>
        </div>
      ) : null}

      {selectedProduct ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                  Customize Item
                </p>
                <h3 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
                  {selectedProduct.name}
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  {selectedProduct.description || 'Select variants and modifiers before adding this item.'}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedProduct(null);
                  setSelectedVariant(null);
                  setSelectedModifiers([]);
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
              >
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="grid gap-5 lg:grid-cols-[1fr,1.2fr]">
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    {selectedProductImage ? (
                      <img
                        src={selectedProductImage}
                        alt={selectedProduct.name}
                        className="h-56 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-56 items-center justify-center bg-slate-100 text-5xl font-black tracking-tight text-slate-400">
                        {getInitials(selectedProduct.name)}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                      Current Price
                    </p>
                    <p className="mt-2 text-3xl font-extrabold tracking-tight text-[var(--color-primary)]">
                      {formatMoney(selectedProductTotal)}
                    </p>
                    <p className="mt-2 text-sm text-slate-500">
                      Base selection plus any extras chosen below.
                    </p>
                  </div>
                </div>

                <div className="space-y-5">
                  {selectedProduct.variants?.length > 0 ? (
                    <section>
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-sm font-bold uppercase tracking-[0.22em] text-slate-500">
                          Variants
                        </h4>
                        <span className="text-xs font-semibold text-slate-400">
                          Pick one
                        </span>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {selectedProduct.variants.map((variant) => (
                          <button
                            key={variant.id}
                            onClick={() => setSelectedVariant(variant)}
                            className={cx(
                              'rounded-xl border p-4 text-left transition',
                              selectedVariant?.id === variant.id
                                ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white shadow-sm'
                                : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h5 className="text-sm font-bold">{variant.name}</h5>
                                <p className={cx(
                                  'mt-2 text-sm font-semibold',
                                  selectedVariant?.id === variant.id ? 'text-white/80' : 'text-[var(--color-primary)]'
                                )}>
                                  {formatMoney(variant.price)}
                                </p>
                              </div>
                              {selectedVariant?.id === variant.id ? (
                                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/12">
                                  <Icon name="check" className="h-4 w-4" />
                                </span>
                              ) : null}
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {(selectedProduct.modifierGroups || []).map((group) => (
                    <section key={group.id || group.name}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-bold uppercase tracking-[0.22em] text-slate-500">
                            {group.name}
                          </h4>
                          <p className="mt-1 text-xs text-slate-400">
                            {group.isRequired
                              ? 'Required selection'
                              : group.maxSelectable
                                ? `Choose up to ${group.maxSelectable}`
                                : 'Optional extras'}
                          </p>
                        </div>
                        {group.isRequired ? (
                          <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200">
                            Required
                          </span>
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        {(group.modifiers || []).map((option) => {
                          const isSelected = selectedModifiers.some(
                            (modifier) => modifier.group === group.name && modifier.option === option.name
                          );

                          return (
                            <label
                              key={option.id || `${group.name}-${option.name}`}
                              className={cx(
                                'flex cursor-pointer items-center justify-between gap-4 rounded-xl border px-4 py-3 transition',
                                isSelected
                                  ? 'border-[rgba(255,107,53,0.18)] bg-[var(--color-primary-glow)]'
                                  : 'border-slate-200 bg-white hover:border-slate-300'
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(event) => {
                                    if (event.target.checked) {
                                      const currentGroupCount = selectedModifiers.filter(
                                        (modifier) => modifier.group === group.name
                                      ).length;

                                      if (group.maxSelectable && currentGroupCount >= group.maxSelectable) {
                                        return;
                                      }

                                      setSelectedModifiers((previous) => [
                                        ...previous,
                                        {
                                          group: group.name,
                                          option: option.name,
                                          price: parseAmount(option.price),
                                          quantity: 1,
                                        },
                                      ]);
                                      return;
                                    }

                                    setSelectedModifiers((previous) =>
                                      previous.filter(
                                        (modifier) => !(modifier.group === group.name && modifier.option === option.name)
                                      )
                                    );
                                  }}
                                  className="h-4 w-4 accent-[var(--color-primary)]"
                                />
                                <div>
                                  <div className="text-sm font-semibold text-slate-900">{option.name}</div>
                                  {parseAmount(option.price) > 0 ? (
                                    <div className="mt-1 text-xs font-semibold text-[var(--color-primary)]">
                                      +{formatMoney(option.price)}
                                    </div>
                                  ) : (
                                    <div className="mt-1 text-xs font-semibold text-slate-400">
                                      Included
                                    </div>
                                  )}
                                </div>
                              </div>

                              {isSelected ? (
                                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-primary)] text-white">
                                  <Icon name="check" className="h-4 w-4" />
                                </span>
                              ) : null}
                            </label>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-white px-6 py-5">
              {selectedProductHasMissingRequiredGroups ? (
                <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                  Complete all required modifier groups before adding this item.
                </div>
              ) : null}

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setSelectedProduct(null);
                    setSelectedVariant(null);
                    setSelectedModifiers([]);
                  }}
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  onClick={() => addToCartRaw(selectedProduct, selectedVariant, selectedModifiers)}
                  disabled={selectedProductHasMissingRequiredGroups}
                  className="flex-[1.4] rounded-xl bg-[var(--color-primary)] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Add to Ticket | {formatMoney(selectedProductTotal)}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* The printable receipt. Hidden on screen; receipt-print.css reveals only
          this element when the browser prints, so window.print() produces a
          thermal-format receipt on any printer rather than the POS screen. */}
      <ReceiptPrint document={printDocument || documentFromReceipt(receipt)} />

      {showReceipt && receipt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Receipt
              </p>
              <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">
                {receipt.restaurantName}
              </h3>
              {receipt.restaurantPhone ? (
                <p className="mt-1 text-sm text-slate-500">{receipt.restaurantPhone}</p>
              ) : null}
              {receipt.restaurantAddress ? (
                <p className="mt-1 text-sm text-slate-500">{receipt.restaurantAddress}</p>
              ) : null}
            </div>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
                <span>{receipt.orderNumber}</span>
                <span>{formatTimestamp(receipt.createdAt)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                <span>{receipt.orderType}</span>
                {receipt.tableNumber ? <span>Table {receipt.tableNumber}</span> : null}
                {receipt.customerName ? <span>{receipt.customerName}</span> : null}
              </div>
            </div>

            <div className="mt-5 max-h-[280px] overflow-y-auto">
              <div className="space-y-3">
                {(receipt.items || []).map((item, index) => (
                  <div key={`${receipt.orderNumber}-${item.name}-${index}`} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-slate-900">
                          {item.quantity}x {item.name}
                        </div>
                        {item.variant ? (
                          <div className="mt-1 text-xs text-slate-500">{item.variant}</div>
                        ) : null}
                        {(item.modifiers || []).map((modifier, modifierIndex) => (
                          <div key={`${item.name}-modifier-${modifierIndex}`} className="mt-1 text-xs text-slate-500">
                            + {modifier.name}
                          </div>
                        ))}
                      </div>
                      <span className="text-sm font-bold text-slate-900">
                        {formatMoney(item.total)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <SummaryRow label="Subtotal" value={formatMoney(receipt.subtotal)} />
              {parseAmount(receipt.tax?.amount) > 0 ? (
                <SummaryRow label={receipt.tax.label} value={formatMoney(receipt.tax.amount)} />
              ) : null}
              {parseAmount(receipt.serviceCharge?.amount) > 0 ? (
                <SummaryRow label={receipt.serviceCharge.label || 'Service Charge'} value={formatMoney(receipt.serviceCharge.amount)} />
              ) : null}
              {parseAmount(receipt.discount) > 0 ? (
                <SummaryRow label={`Discount${receipt.promoCode ? ` (${receipt.promoCode})` : ''}`} value={`-${formatMoney(receipt.discount)}`} highlight="text-[var(--color-primary)]" />
              ) : null}
              {parseAmount(receipt.tip) > 0 ? (
                <SummaryRow label="Tip" value={formatMoney(receipt.tip)} />
              ) : null}
              <div className="flex items-end justify-between border-t border-slate-200 pt-3">
                <span className="text-lg font-bold text-slate-900">Total</span>
                <span className="text-2xl font-extrabold tracking-tight text-[var(--color-primary)]">
                  {formatMoney(receipt.grandTotal)}
                </span>
              </div>
            </div>

            {receipt.payments?.[0] ? (
              <div className="mt-4 rounded-xl border border-[rgba(255,107,53,0.18)] bg-[var(--color-primary-glow)] px-4 py-3 text-sm text-[var(--color-primary)]">
                Paid via {receipt.payments[0].method} | {formatMoney(receipt.payments[0].amount)}
                {parseAmount(receipt.payments[0].change) > 0 ? ` | Change ${formatMoney(receipt.payments[0].change)}` : ''}
              </div>
            ) : null}

            <p className="mt-4 text-center text-sm text-slate-500">
              {receipt.footer}
            </p>

            <div className="mt-6 flex gap-3">
              <button
                onClick={handlePrintReceipt}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
              >
                Print
              </button>
              <button
                onClick={() => {
                  setShowReceipt(false);
                  setReceipt(null);
                  setPrintDocument(null);
                }}
                className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-lg font-bold tracking-tight text-slate-900">{value}</p>
    </div>
  );
}

function SummaryRow({ label, value, highlight }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={cx('font-semibold text-slate-900', highlight)}>{value}</span>
    </div>
  );
}

function formatMoneyValue(value, currencySymbol) {
  const amount = parseAmount(value);
  const hasFraction = Math.abs(amount % 1) > 0.004;
  return `${currencySymbol}${amount.toLocaleString('en-US', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}
