import { PageSkeleton } from '@/components/ui/Loading';

/**
 * What fills the content area while the next admin page is on its way.
 *
 * Next.js renders this the instant a link is clicked, inside the shell that is
 * already on screen — the sidebar, the header and the branch selector never
 * flicker. Without it a click left the previous page sitting there, apparently
 * frozen, until the new one resolved: the app looked stuck precisely when it
 * was working.
 */
export default function AdminLoading() {
  return <PageSkeleton />;
}
