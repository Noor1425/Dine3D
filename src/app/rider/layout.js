import '@/styles/rider.css';

export const metadata = {
  title: 'Dine3D — My deliveries',
};

// A rider portal lives on a phone and is opened from a home-screen shortcut, so
// it needs the notch-safe viewport. Next wants this as its own export.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * The rider portal stands alone: no admin sidebar, no branch switcher, no
 * restaurant chrome. That is not only a layout decision — a rider's account can
 * reach their own deliveries and nothing else, so putting them inside the admin
 * shell would show a wall of navigation that every tap would reject.
 */
export default function RiderLayout({ children }) {
  return <div className="rider-root">{children}</div>;
}
