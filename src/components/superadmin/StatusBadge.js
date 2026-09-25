const styles = {
  ACTIVE: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  TRIALING: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
  TRIAL: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
  PAST_DUE: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  GRACE_PERIOD: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  SUSPENDED: 'border-red-500/30 bg-red-500/10 text-red-400',
  FAILED: 'border-red-500/30 bg-red-500/10 text-red-400',
  BOUNCED: 'border-red-500/30 bg-red-500/10 text-red-400',
  COMPLAINED: 'border-red-500/30 bg-red-500/10 text-red-400',
  SUPPRESSED: 'border-purple-500/30 bg-purple-500/10 text-purple-400',
  DELIVERY_DELAYED: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  DELIVERED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  SENT: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
  CANCELLED: 'border-sa-600 bg-sa-800 text-sa-400',
  EXPIRED: 'border-sa-600 bg-sa-800 text-sa-400',
  // Manual payment review and invoice lifecycle
  PENDING: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
  VERIFIED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  REJECTED: 'border-red-500/30 bg-red-500/10 text-red-400',
  OPEN: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  PAID: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  DRAFT: 'border-sa-600 bg-sa-800 text-sa-400',
  VOID: 'border-sa-600 bg-sa-800 text-sa-400',
  UNCOLLECTIBLE: 'border-red-500/30 bg-red-500/10 text-red-400'
};

export default function StatusBadge({ status }) {
  const normalized = String(status || 'UNKNOWN').toUpperCase();
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black ${styles[normalized] || styles.CANCELLED}`}>{normalized.replaceAll('_', ' ')}</span>;
}
