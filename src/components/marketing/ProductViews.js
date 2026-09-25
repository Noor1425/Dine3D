'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { useStep, useCountUp } from './useStep';

/**
 * PRODUCT VIEWS FOR THE LANDING PAGE
 *
 * These follow the real application's design — the same sidebar and top bar,
 * the same card, pill and table treatments, the same type scale, scaled down to
 * fit a landing-page panel. What they leave out is everything that belongs only
 * inside the product: the demo tenant's name, its plan badge, the sync clock,
 * locked menu items, dev overlays, and the stale seed data where a ticket shows
 * as 74,896 minutes old.
 *
 * Drawn rather than screenshotted, for three reasons. They stay sharp at any
 * size and weigh nothing. They can move — an order assembling itself tells a
 * buyer what using the till is like in a way a still frame cannot, where a
 * video would cost megabytes and a re-shoot every time a screen changed. And
 * the restaurant is a made-up one, which is what example data always is.
 *
 * Every loop stops when it scrolls out of view, and stops entirely for anyone
 * who has asked their system to reduce motion.
 */

const RESTAURANT = 'Saffron House';
const SLUG = '/saffron-house';

/* The modules a restaurant gets, in the product's own order. */
const NAV = [
  { icon: '⬡', label: 'Dashboard', id: 'dashboard' },
  { icon: '◆', label: 'POS Terminal', id: 'pos' },
  { icon: '⊞', label: 'Kitchen (KDS)', id: 'kitchen' },
  { icon: '≡', label: 'Order History', id: 'orders' },
  { icon: '◈', label: 'Menu Items', id: 'menu' },
  { icon: '⊡', label: 'Inventory', id: 'inventory' },
  { icon: '⇢', label: 'Delivery', id: 'delivery' },
  { icon: '⬘', label: 'Tables & QR', id: 'tables' },
  { icon: '◎', label: 'Settings', id: 'settings' },
];

/** The application shell: sidebar, top bar, and the screen inside it. */
function AppFrame({ active, children }) {
  return (
    <div className="overflow-hidden rounded-xl bg-[#F7F8FA] text-[#0F172A] shadow-[0_30px_60px_-25px_rgba(0,0,0,0.85)]">
      <div className="flex">
        <aside className="hidden w-[132px] flex-none border-r border-slate-200 bg-white sm:block">
          <div className="flex items-center gap-1.5 border-b border-slate-200 px-3 py-2.5">
            <span className="flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-[#FF6B35] to-[#F7931E]">
              <span className="h-1.5 w-1.5 rounded-[1px] bg-white" />
            </span>
            <span className="text-[11px] font-black tracking-tight text-slate-900">Dine3D</span>
          </div>
          <div className="border-b border-slate-200 px-3 py-2">
            <p className="truncate text-[10px] font-bold text-slate-900">{RESTAURANT}</p>
            <p className="truncate text-[8px] text-slate-400">{SLUG}</p>
          </div>
          <p className="px-3 pb-1 pt-2.5 text-[7px] font-black uppercase tracking-[0.16em] text-slate-400">
            Management
          </p>
          <nav className="pb-3">
            {NAV.map((item) => {
              const on = item.id === active;
              return (
                <div
                  key={item.id}
                  className={`mx-1.5 flex items-center gap-1.5 rounded-md px-2 py-[5px] ${
                    on ? 'bg-orange-50 text-[#FF6B35]' : 'text-slate-600'
                  }`}
                >
                  <span className={`text-[9px] ${on ? 'text-[#FF6B35]' : 'text-slate-400'}`} aria-hidden>{item.icon}</span>
                  <span className={`truncate text-[9px] ${on ? 'font-bold' : 'font-medium'}`}>{item.label}</span>
                </div>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-end gap-1.5 border-b border-slate-200 bg-white px-3 py-2">
            <span className="flex items-center gap-1 rounded-full border border-slate-200 px-2 py-[3px]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-[8px] font-bold text-slate-600">Online</span>
            </span>
            <span className="hidden items-center gap-1 rounded-full border border-slate-200 px-2 py-[3px] sm:flex">
              <span className="text-[8px] text-slate-400" aria-hidden>&#8982;</span>
              <span className="text-[8px] font-bold text-slate-600">All Branches</span>
            </span>
            <span className="hidden items-center gap-1 rounded-full border border-slate-200 px-2 py-[3px] md:flex">
              <span className="text-[8px] font-bold text-slate-600">{RESTAURANT}</span>
            </span>
            <span className="text-[8px] font-black uppercase tracking-wider text-slate-500">&#8599; View live store</span>
          </div>
          <div className="min-h-[300px] p-3.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function PageHead({ title, sub, action }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="truncate text-[15px] font-black tracking-tight text-slate-900">{title}</h3>
        {sub ? <p className="mt-0.5 truncate text-[9px] text-slate-500">{sub}</p> : null}
      </div>
      {action ? (
        <span className="flex-none rounded-lg bg-slate-900 px-2.5 py-1.5 text-[9px] font-bold text-white">{action}</span>
      ) : null}
    </div>
  );
}

/* ── Point of sale ───────────────────────────────────────────────────────── */
/**
 * Real photography, from the menu images already in this project — a till full
 * of food is what a restaurant owner recognises, and coloured rectangles are
 * what a prototype looks like.
 *
 * The dish list follows the photographs rather than the other way round: every
 * tile here has an actual picture behind it. The gradient stays as the tile's
 * background so a slow connection shows warm colour rather than a grey hole,
 * and it is what the eye lands on before the image decodes.
 */
const DISHES = [
  { name: 'Chicken Karahi', price: '1,450', img: '/images/dishes/chicken-curry.jpg', from: '#F97316', to: '#B45309' },
  { name: 'Chicken Biryani', price: '540', img: '/images/dishes/chicken-biryani.jpg', from: '#F59E0B', to: '#B45309' },
  { name: 'Seekh Kebab', price: '620', img: '/images/dishes/seekh-kebab.jpg', from: '#EA580C', to: '#9A3412' },
  { name: 'Zinger Burger', price: '320', img: '/images/dishes/zinger-burger.jpg', from: '#D97706', to: '#7C2D12' },
  { name: 'French Fries', price: '140', img: '/images/dishes/french-fries.jpg', from: '#FBBF24', to: '#D97706' },
  { name: 'Mango Lassi', price: '220', img: '/images/dishes/beverages.jpg', from: '#FCD34D', to: '#F59E0B' },
];

const TICKET = [
  { qty: 1, name: 'Chicken Karahi', amount: 1450 },
  { qty: 2, name: 'French Fries', amount: 280 },
  { qty: 2, name: 'Mango Lassi', amount: 440 },
];

const TAP_ORDER = [0, 4, 5];
const n0 = (value) => value.toLocaleString();

export function PosView() {
  const [step, ref] = useStep(4, 1150, { holdAtEnd: 2200 });
  const lines = TICKET.slice(0, step);
  const subtotal = lines.reduce((total, line) => total + line.amount, 0);
  const tax = Math.round(subtotal * 0.05);
  const shownSubtotal = useCountUp(subtotal);
  const shownTotal = useCountUp(subtotal + tax);
  const tapped = step > 0 ? TAP_ORDER[step - 1] : -1;

  return (
    <div ref={ref}>
      <AppFrame active="pos">
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-slate-200 bg-white px-2 py-[3px] text-[8px] font-bold text-slate-600">All items</span>
          <span className="rounded-full border border-slate-200 bg-white px-2 py-[3px] text-[8px] font-bold text-slate-600">38 visible items</span>
          <span className="rounded-full border border-slate-200 bg-white px-2 py-[3px] text-[8px] font-bold text-slate-600">
            {lines.length} in ticket
          </span>
          <span className="rounded-full bg-emerald-50 px-2 py-[3px] text-[8px] font-bold text-emerald-700">Shift open</span>
        </div>

        <div className="grid items-start gap-2.5 lg:grid-cols-[1fr_162px]">
          <div className="grid auto-rows-min grid-cols-3 gap-2">
            {DISHES.map((dish, index) => {
              const hit = index === tapped;
              return (
                <motion.div
                  key={dish.name}
                  animate={hit ? { scale: [1, 0.94, 1] } : { scale: 1 }}
                  transition={{ duration: 0.34 }}
                  className={`overflow-hidden rounded-lg border bg-white transition-colors duration-200 ${
                    hit ? 'border-[#FF6B35] ring-2 ring-[#FF6B35]/25' : 'border-slate-200'
                  }`}
                >
                  <div className="h-[72px]" style={{ background: `linear-gradient(135deg, ${dish.from}, ${dish.to})` }}>
                    <img
                      src={dish.img}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  {/* Name on its own line, price and the add button beneath it —
                      the way the real till lays a tile out, and the only way the
                      full dish name fits at this size. */}
                  <div className="px-1.5 py-1">
                    <p className="truncate text-[8.5px] font-bold leading-tight text-slate-700">{dish.name}</p>
                    <div className="mt-0.5 flex items-center justify-between gap-1">
                      <p className="text-[9px] font-black text-[#FF6B35]">Rs. {dish.price}</p>
                      <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-500">+</span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-2.5">
            <p className="text-[7px] font-black uppercase tracking-[0.16em] text-slate-400">Order summary</p>
            <p className="text-[12px] font-black tracking-tight text-slate-900">New Ticket</p>
            <div className="mt-2 min-h-[62px] space-y-1.5">
              <AnimatePresence initial={false}>
                {lines.map((line) => (
                  <motion.div
                    key={line.name}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.26 }}
                    className="flex items-baseline justify-between gap-1.5"
                  >
                    <p className="truncate text-[8.5px] text-slate-600">
                      <span className="font-black text-slate-800">{line.qty}&times;</span> {line.name}
                    </p>
                    <p className="text-[8.5px] font-bold tabular-nums text-slate-700">{n0(line.amount)}</p>
                  </motion.div>
                ))}
              </AnimatePresence>
              {lines.length === 0 ? (
                <p className="pt-4 text-center text-[8px] text-slate-300">Tap a menu item to start this ticket</p>
              ) : null}
            </div>
            <div className="mt-2 space-y-0.5 border-t border-slate-200 pt-2 text-[8.5px] text-slate-500">
              <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">Rs. {n0(shownSubtotal)}</span></div>
              <div className="flex justify-between"><span>Tax 5%</span><span className="tabular-nums">Rs. {n0(tax)}</span></div>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between border-t border-slate-200 pt-1.5">
              <span className="text-[9px] font-black text-slate-700">Total</span>
              <span className="text-[13px] font-black tabular-nums text-[#FF6B35]">Rs. {n0(shownTotal)}</span>
            </div>
            <motion.div
              animate={{ opacity: lines.length ? 1 : 0.4 }}
              className="mt-2 rounded-md bg-slate-900 py-1.5 text-center text-[8.5px] font-bold text-white"
            >
              &rarr; Continue
            </motion.div>
          </div>
        </div>
      </AppFrame>
    </div>
  );
}

/* ── Kitchen display ─────────────────────────────────────────────────────── */
const KDS = [
  { ref: 'ORD-1042', type: 'DINE IN', seat: 'Table 4', mins: 2, items: ['2× Seekh Kebab', '1× Garlic Naan'] },
  { ref: 'ORD-1043', type: 'COUNTER', seat: 'Takeaway', mins: 3, items: ['1× Chicken Biryani'] },
  { ref: 'ORD-1041', type: 'DINE IN', seat: 'Table 7', mins: 7, items: ['1× Chicken Karahi', '2× Garlic Naan'] },
  { ref: 'ORD-1039', type: 'DELIVERY', seat: 'Imran A.', mins: 11, items: ['1× Beef Nihari', '1× Mango Lassi'] },
  { ref: 'ORD-1038', type: 'DINE IN', seat: 'Table 2', mins: 14, items: ['2× Chicken Biryani'] },
];

const STAGES = [
  { key: 'confirmed', label: 'Confirmed', card: 'border-amber-200 bg-amber-50/70', pill: 'border-amber-300 bg-amber-100 text-amber-800' },
  { key: 'preparing', label: 'Preparing', card: 'border-blue-200 bg-blue-50/70', pill: 'border-blue-300 bg-blue-100 text-blue-800' },
  { key: 'ready', label: 'Ready', card: 'border-emerald-200 bg-emerald-50/70', pill: 'border-emerald-300 bg-emerald-100 text-emerald-800' },
];

function KdsCard({ order, stage }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.3 }}
      className={`rounded-lg border p-2 ${stage.card}`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <p className="text-[9px] font-black tracking-tight text-slate-900">{order.ref}</p>
        <span className={`flex-none rounded border px-1 py-[1px] text-[7px] font-bold ${stage.pill}`}>{stage.label}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-1.5">
        <p className="truncate text-[7.5px] uppercase tracking-wide text-slate-500">{order.type} &middot; {order.seat}</p>
        <p className={`flex-none text-[8px] font-black tabular-nums ${order.mins >= 10 ? 'text-rose-600' : 'text-slate-500'}`}>
          {order.mins} min
        </p>
      </div>
      <span className="mt-1 inline-block rounded bg-emerald-100 px-1 py-[1px] text-[6.5px] font-bold text-emerald-700">PAID</span>
      <ul className="mt-1 space-y-[1px] border-t border-black/5 pt-1">
        {order.items.map((item) => (
          <li key={item} className="text-[8px] font-medium text-slate-600">{item}</li>
        ))}
      </ul>
    </motion.div>
  );
}

export function KitchenView() {
  // One ticket advances a stage on each beat, so the board reads as a service
  // in progress rather than a snapshot.
  const [step, ref] = useStep(3, 1700, { holdAtEnd: 1300 });

  const columns = STAGES.map((stage, columnIndex) => {
    let orders = [];
    if (columnIndex === 0) orders = step >= 1 ? [KDS[1]] : [KDS[0], KDS[1]];
    if (columnIndex === 1) orders = step >= 2 ? [KDS[2], KDS[3]] : step >= 1 ? [KDS[0], KDS[2], KDS[3]] : [KDS[2], KDS[3]];
    if (columnIndex === 2) orders = step >= 2 ? [KDS[0], KDS[4]] : [KDS[4]];
    return { stage, orders };
  });

  const total = columns.reduce((sum, column) => sum + column.orders.length, 0);

  return (
    <div ref={ref}>
      <AppFrame active="kitchen">
        <PageHead title="Kitchen Display System" sub={`${total} active orders`} action="&#10530; Fullscreen" />
        <div className="grid grid-cols-3 gap-2">
          {columns.map(({ stage, orders }) => (
            <div key={stage.key}>
              <div className="mb-1.5 flex items-center justify-between px-0.5">
                <span className="text-[7.5px] font-black uppercase tracking-[0.14em] text-slate-500">{stage.label}</span>
                <span className="text-[7.5px] font-bold text-slate-400">{orders.length}</span>
              </div>
              <div className="min-h-[150px] space-y-1.5">
                <AnimatePresence initial={false} mode="popLayout">
                  {orders.map((order) => (
                    <KdsCard key={`${stage.key}-${order.ref}`} order={order} stage={stage} />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
      </AppFrame>
    </div>
  );
}

/* ── Dashboard ───────────────────────────────────────────────────────────── */
const BARS = [38, 52, 44, 61, 78, 96, 71];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function DashboardView() {
  const [step, ref] = useStep(2, 2600, { holdAtEnd: 1800 });
  const live = step > 0;
  const revenue = useCountUp(live ? 84320 : 0, 900);
  const orders = useCountUp(live ? 212 : 0, 900);
  const pending = useCountUp(live ? 6 : 0, 900);
  const average = useCountUp(live ? 398 : 0, 900);
  const max = Math.max(...BARS);

  const STATS = [
    { tag: 'Today', label: 'Revenue Today', value: `Rs. ${revenue.toLocaleString()}`, note: '212 orders contributed today.', tint: 'from-emerald-50 to-white', chip: 'bg-emerald-100 text-emerald-700' },
    { tag: 'Volume', label: 'Orders Today', value: String(orders), note: '6 still need attention.', tint: 'from-orange-50 to-white', chip: 'bg-orange-100 text-orange-700' },
    { tag: 'Queue', label: 'Pending Orders', value: String(pending), note: 'Kitchen follow-up pending.', tint: 'from-amber-50 to-white', chip: 'bg-amber-100 text-amber-700' },
    { tag: 'Performance', label: 'Average Ticket', value: `Rs. ${average.toLocaleString()}`, note: '1,284 lifetime orders.', tint: 'from-sky-50 to-white', chip: 'bg-sky-100 text-sky-700' },
  ];

  return (
    <div ref={ref}>
      <AppFrame active="dashboard">
        <div className="mb-3 rounded-xl bg-gradient-to-br from-orange-50 via-white to-white p-3">
          <span className="rounded-full border border-emerald-200 bg-white px-1.5 py-[2px] text-[7px] font-black uppercase tracking-wider text-emerald-700">
            &bull; Live dashboard
          </span>
          <h3 className="mt-1.5 text-[17px] font-black tracking-tight text-slate-900">Dashboard</h3>
          <p className="mt-0.5 max-w-[280px] text-[8.5px] leading-relaxed text-slate-500">
            Restaurant performance, sales movement and the live order pulse from one view.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.label} className={`rounded-lg border border-slate-200 bg-gradient-to-br ${stat.tint} p-2`}>
              <div className="flex items-center justify-end">
                <span className={`rounded px-1 py-[1px] text-[6.5px] font-black uppercase tracking-[0.12em] ${stat.chip}`}>{stat.tag}</span>
              </div>
              <p className="mt-1.5 text-[13px] font-black tabular-nums tracking-tight text-slate-900">{stat.value}</p>
              <p className="text-[8px] font-bold text-slate-600">{stat.label}</p>
              <p className="mt-0.5 text-[7px] leading-tight text-slate-400">{stat.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[7px] font-black uppercase tracking-[0.14em] text-slate-400">Business overview</p>
            <span className="rounded border border-slate-200 px-1.5 py-[1px] text-[7px] font-bold text-slate-500">Live reports</span>
          </div>
          <p className="mt-0.5 text-[10px] font-black text-slate-800">Sales this week</p>
          <div className="mt-2 flex h-[72px] items-end gap-1.5">
            {BARS.map((value, index) => (
              <div key={DAYS[index]} className="flex flex-1 flex-col items-center gap-1">
                <motion.div
                  className={`w-full rounded-t ${index === 5 ? 'bg-[#FF6B35]' : 'bg-slate-200'}`}
                  initial={{ height: '4%' }}
                  animate={{ height: live ? `${(value / max) * 100}%` : '4%' }}
                  transition={{ duration: 0.55, delay: index * 0.06, ease: 'easeOut' }}
                />
                <span className="text-[6.5px] font-bold text-slate-400">{DAYS[index]}</span>
              </div>
            ))}
          </div>
        </div>
      </AppFrame>
    </div>
  );
}

/* ── Inventory ───────────────────────────────────────────────────────────── */
const STOCK = [
  { item: 'Basmati rice', full: '77.0 KG', low: '71.5 KG', threshold: '20.0', cost: 'Rs. 340', state: 'OK' },
  { item: 'Chicken', full: '24.0 KG', low: '18.4 KG', threshold: '10.0', cost: 'Rs. 780', state: 'OK' },
  { item: 'Cooking oil', full: '18.0 L', low: '16.2 L', threshold: '8.0', cost: 'Rs. 540', state: 'OK' },
  { item: 'Tomatoes', full: '9.8 KG', low: '4.2 KG', threshold: '5.0', cost: 'Rs. 160', state: 'LOW' },
  { item: 'Yoghurt', full: '6.0 KG', low: '1.1 KG', threshold: '4.0', cost: 'Rs. 240', state: 'REORDER' },
];

const STATE_TONE = {
  OK: 'bg-emerald-100 text-emerald-700',
  LOW: 'bg-amber-100 text-amber-700',
  REORDER: 'bg-rose-100 text-rose-700',
};

export function InventoryView() {
  // Two of the five fall past their threshold as the service runs. That is the
  // whole claim of this screen, so it is the thing that moves.
  const [step, ref] = useStep(2, 2600, { holdAtEnd: 1800 });
  const sold = step > 0;

  return (
    <div ref={ref}>
      <AppFrame active="inventory">
        <PageHead
          title="Inventory Management"
          sub={sold ? '5 ingredients · 2 need attention' : '5 ingredients · Stock levels healthy'}
          action="+ Add Ingredient"
        />

        <div className="mb-2.5 grid grid-cols-4 gap-2">
          {[
            { label: 'Total Ingredients', value: '5', tone: 'text-sky-600' },
            { label: 'Low Stock Alerts', value: sold ? '1' : '0', tone: sold ? 'text-amber-600' : 'text-emerald-600' },
            { label: 'Reorder Now', value: sold ? '1' : '0', tone: sold ? 'text-rose-600' : 'text-emerald-600' },
            { label: 'Total Value', value: 'Rs. 65,660', tone: 'text-emerald-600' },
          ].map((card) => (
            <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-2">
              <p className="truncate text-[7px] font-bold text-slate-500">{card.label}</p>
              <p className={`mt-0.5 text-[13px] font-black tabular-nums ${card.tone}`}>{card.value}</p>
            </div>
          ))}
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded-lg bg-slate-900 px-2 py-1 text-[8px] font-bold text-white">Stock Levels</span>
          <span className="px-1.5 py-1 text-[8px] font-medium text-slate-500">Suppliers &amp; POs</span>
          <span className="px-1.5 py-1 text-[8px] font-medium text-slate-500">Activity Log</span>
          <span className="ml-auto rounded-lg bg-emerald-700 px-2 py-1 text-[8px] font-bold text-white">Closing stock count</span>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="grid grid-cols-[1.4fr_1fr_0.8fr_0.9fr_0.8fr] border-b border-slate-200 px-2.5 py-1.5">
            {['Ingredient', 'Current Stock', 'Threshold', 'Cost/Unit', 'Status'].map((head) => (
              <span key={head} className="text-[7px] font-black uppercase tracking-wide text-slate-400">{head}</span>
            ))}
          </div>
          {STOCK.map((row) => {
            const state = sold ? row.state : 'OK';
            return (
              <div key={row.item} className="grid grid-cols-[1.4fr_1fr_0.8fr_0.9fr_0.8fr] items-center border-b border-slate-100 px-2.5 py-[7px] last:border-b-0">
                <span className="truncate text-[8.5px] font-bold text-slate-800">{row.item}</span>
                <motion.span
                  key={sold ? row.low : row.full}
                  initial={{ opacity: 0.35 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.45 }}
                  className="text-[8.5px] font-bold tabular-nums text-slate-700"
                >
                  {sold ? row.low : row.full}
                </motion.span>
                <span className="text-[8px] tabular-nums text-slate-500">{row.threshold}</span>
                <span className="text-[8px] tabular-nums text-slate-500">{row.cost}</span>
                <motion.span
                  key={state}
                  initial={{ opacity: 0.35, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.35 }}
                  className={`w-fit rounded px-1.5 py-[1px] text-[7px] font-black ${STATE_TONE[state]}`}
                >
                  {state}
                </motion.span>
              </div>
            );
          })}
        </div>
      </AppFrame>
    </div>
  );
}

/* ── Delivery ────────────────────────────────────────────────────────────── */
const RIDERS = [
  { name: 'Imran Ali', ref: 'ORD-1042', area: 'Gulberg', cash: 'Rs. 1,680' },
  { name: 'Bilal Khan', ref: 'ORD-1045', area: 'Model Town', cash: 'Rs. 940' },
  { name: 'Usman Raza', ref: 'ORD-1039', area: 'DHA', cash: 'Rs. 620' },
];

const RIDER_STAGES = [
  { state: 'Assigned', tone: 'bg-slate-100 text-slate-600' },
  { state: 'Picked up', tone: 'bg-blue-100 text-blue-700' },
  { state: 'On the way', tone: 'bg-violet-100 text-violet-700' },
  { state: 'Delivered', tone: 'bg-emerald-100 text-emerald-700' },
];

export function DeliveryView() {
  const [step, ref] = useStep(4, 1500, { holdAtEnd: 1400 });

  return (
    <div ref={ref}>
      <AppFrame active="delivery">
        <PageHead title="Delivery" sub="3 riders on shift &middot; 3 orders out" action="Assign rider" />

        <div className="mb-2.5 grid grid-cols-3 gap-2">
          {[
            { label: 'Out for delivery', value: '3', tone: 'text-violet-600' },
            { label: 'Delivered today', value: '28', tone: 'text-emerald-600' },
            { label: 'Cash to collect', value: 'Rs. 3,240', tone: 'text-slate-900' },
          ].map((card) => (
            <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-2">
              <p className="truncate text-[7px] font-bold text-slate-500">{card.label}</p>
              <p className={`mt-0.5 text-[13px] font-black tabular-nums ${card.tone}`}>{card.value}</p>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="grid grid-cols-[1.3fr_1fr_1fr_0.9fr_0.9fr] border-b border-slate-200 px-2.5 py-1.5">
            {['Rider', 'Order', 'Area', 'Status', 'Cash'].map((head) => (
              <span key={head} className="text-[7px] font-black uppercase tracking-wide text-slate-400">{head}</span>
            ))}
          </div>
          {RIDERS.map((rider, index) => {
            const stage = RIDER_STAGES[(step + index) % RIDER_STAGES.length];
            const done = stage.state === 'Delivered';
            return (
              <div key={rider.name} className="grid grid-cols-[1.3fr_1fr_1fr_0.9fr_0.9fr] items-center border-b border-slate-100 px-2.5 py-[7px] last:border-b-0">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-slate-100 text-[7px] font-black text-slate-500">
                    {rider.name.charAt(0)}
                  </span>
                  <span className="truncate text-[8.5px] font-bold text-slate-800">{rider.name}</span>
                </span>
                <span className="text-[8px] tabular-nums text-slate-500">{rider.ref}</span>
                <span className="truncate text-[8px] text-slate-500">{rider.area}</span>
                <motion.span
                  key={stage.state}
                  initial={{ opacity: 0.35, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.35 }}
                  className={`w-fit rounded px-1.5 py-[1px] text-[7px] font-black uppercase ${stage.tone}`}
                >
                  {stage.state}
                </motion.span>
                <span className="text-[8px] font-bold tabular-nums text-slate-600">{done ? 'Collected' : rider.cash}</span>
              </div>
            );
          })}
        </div>
      </AppFrame>
    </div>
  );
}

/* ── Guest QR ordering ───────────────────────────────────────────────────── */
export function GuestView() {
  const [step, ref] = useStep(4, 1400, { holdAtEnd: 1600 });

  return (
    <div ref={ref} className="flex justify-center py-2">
      <div className="w-[248px] overflow-hidden rounded-[22px] border-[5px] border-slate-800 bg-white shadow-[0_30px_60px_-25px_rgba(0,0,0,0.85)]">
        <div className="bg-slate-900 px-3 py-2.5">
          <p className="text-[7px] font-black uppercase tracking-[0.16em] text-white/40">Table 7</p>
          <p className="text-[12px] font-black text-white">{RESTAURANT}</p>
        </div>
        <div className="space-y-1.5 p-2.5">
          {DISHES.slice(0, 3).map((dish, index) => (
            <motion.div
              key={dish.name}
              animate={index === step - 1 ? { scale: [1, 0.96, 1] } : { scale: 1 }}
              transition={{ duration: 0.34 }}
              className={`flex items-center gap-2 rounded-lg border p-1.5 ${
                index === step - 1 ? 'border-[#FF6B35] ring-2 ring-[#FF6B35]/20' : 'border-slate-200'
              }`}
            >
              <div
                className="h-8 w-8 flex-none overflow-hidden rounded-md"
                style={{ background: `linear-gradient(135deg, ${dish.from}, ${dish.to})` }}
              >
                <img src={dish.img} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[9px] font-bold text-slate-800">{dish.name}</p>
                <p className="text-[8.5px] font-black text-[#FF6B35]">Rs. {dish.price}</p>
              </div>
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-md bg-slate-900 text-[10px] font-black text-white">+</span>
            </motion.div>
          ))}
          <div className="flex items-center justify-between rounded-lg bg-[#FF6B35] px-2.5 py-1.5">
            <span className="text-[8.5px] font-black text-white">View in 3D</span>
            <span className="text-[8.5px] font-black text-white">
              {Math.min(step, 3)} item{Math.min(step, 3) === 1 ? '' : 's'} &rarr;
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export const PRODUCT_VIEWS = [
  { id: 'pos', label: 'Point of sale', Component: PosView,
    headline: 'Take the order in seconds, not minutes.',
    caption: 'One till for the whole floor, with the queue moving.' },
  { id: 'kitchen', label: 'Kitchen', Component: KitchenView,
    headline: 'The kitchen sees it the moment it is rung up.',
    caption: 'No chits, no shouting, no lost orders. Every ticket shows what to cook and how long it has been waiting.' },
  { id: 'dashboard', label: 'Dashboard', Component: DashboardView,
    headline: 'Know where the money went before you go home.',
    caption: 'Revenue, covers, average ticket and what is still pending — from the same data the till writes, so it is always today’s truth.' },
  { id: 'inventory', label: 'Inventory', Component: InventoryView,
    headline: 'Stop finding out you are out of chicken at 8pm.',
    caption: 'Recipes deduct stock as dishes sell. You see what is running low while there is still time to order it.' },
  { id: 'delivery', label: 'Delivery', Component: DeliveryView,
    headline: 'Every rider, every order, every rupee accounted for.',
    caption: 'Name a rider at the till, confirm with the customer’s code, and the cash they carry is reconciled for you.' },
  { id: 'guest', label: 'Guest ordering', Component: GuestView,
    headline: 'Your guests order from their own phone.',
    caption: 'They scan the table code, see the dish in 3D, and order — no app to download and no waiter waiting.' },
];
