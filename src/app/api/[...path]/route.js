import { NextResponse } from 'next/server';
import { handleMockRequest } from '@/mocks/router';

/**
 * This is a fully standalone demo build: there is no backend process, no
 * database, no Redis. Every `/api/*` call the frontend makes is answered
 * right here, in-process, from an in-memory mock "database" seeded in
 * `src/mocks/seed.js` (real menu/category data captured from a live
 * Dine3D restaurant, plus hand-authored orders/inventory/staff/etc. for
 * everything else). See `src/mocks/router.js` for the route table.
 *
 * Data lives only for the life of this Node process — it resets whenever
 * the dev/prod server restarts. That's intentional: this folder exists to
 * be handed to someone else and run with nothing but `npm install && npm
 * run dev`, no external services required.
 */

function parseCookies(request) {
  const out = {};
  for (const c of request.cookies.getAll()) out[c.name] = c.value;
  return out;
}

async function parseBody(request, method) {
  if (['GET', 'HEAD'].includes(method)) return null;
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const text = await request.text();
      return text ? JSON.parse(text) : {};
    }
    if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      const form = await request.formData();
      const obj = {};
      for (const [key, value] of form.entries()) {
        obj[key] = typeof value === 'string' ? value : { filename: value.name, isFile: true };
      }
      return obj;
    }
    return {};
  } catch {
    return {};
  }
}

async function handle(request, context) {
  const { path } = await context.params;
  const method = request.method.toUpperCase();
  const pathname = `/${(path || []).join('/')}`;
  const query = request.nextUrl.searchParams;
  const cookies = parseCookies(request);
  const body = await parseBody(request, method);

  const result = handleMockRequest({ method, path: pathname, query, body, cookies });

  const response = NextResponse.json(result.body, { status: result.status });
  for (const [key, value] of Object.entries(result.headers || {})) {
    response.headers.set(key, value);
  }
  for (const cookie of result.cookies || []) {
    response.cookies.set(cookie.name, cookie.value, cookie.options || {});
  }
  return response;
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
};
