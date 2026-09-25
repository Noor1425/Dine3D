/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV === 'development';

const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  // Keep dev and production build artifacts separate so running `dev` and `build`
  // in parallel cannot corrupt chunk references.
  distDir: isDev ? '.next-dev' : '.next-prod',
  webpack(config) {
    // Generated architecture graphs are repository artifacts, never runtime
    // source. Excluding them prevents graph updates from invalidating HMR.
    config.watchOptions = {
      ...(config.watchOptions || {}),
      ignored: [...(Array.isArray(config.watchOptions?.ignored) ? config.watchOptions.ignored : []), '**/graphify-out/**'],
    };
    return config;
  },
  // This is a fully standalone demo: /api/* is answered in-process by
  // src/app/api/[...path]/route.js from an in-memory mock "database" — no
  // rewrite to an external backend, no /uploads passthrough. Every seeded
  // record has imageUrl: null, so nothing in the UI requests /uploads/*.
};

module.exports = nextConfig;
