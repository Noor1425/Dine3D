/**
 * The control plane's own skeleton — dark, because its shell is.
 * Same purpose as the admin one: the frame stays, the content area shows the
 * shape of what is coming.
 */
export default function SuperAdminLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading the page</span>
      <div>
        <div className="h-7 w-56 animate-pulse rounded-md bg-sa-800" />
        <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded-md bg-sa-900" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-sa-800 bg-sa-900 p-5">
            <div className="h-3 w-24 animate-pulse rounded bg-sa-800" />
            <div className="mt-3 h-7 w-20 animate-pulse rounded bg-sa-800" />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-sa-800 bg-sa-900 p-5">
        <div className="h-4 w-40 animate-pulse rounded bg-sa-800" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-11 w-full animate-pulse rounded bg-sa-800/70" />
          ))}
        </div>
      </div>
    </div>
  );
}
