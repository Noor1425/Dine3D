import { redirect } from 'next/navigation';

/**
 * /login is where people type, /admin/login is where the form lives.
 *
 * Without this the path fell through to the [slug] storefront route, which
 * asked the API for a restaurant called "login", got a 404 and logged an
 * "API Error" in the console. Every other reserved root in middleware.js has a
 * real page behind it; this one did not.
 */
export default function LoginRedirect() {
  redirect('/admin/login');
}
