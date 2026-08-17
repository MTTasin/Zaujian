// Deliberately .mjs, NOT .ts. A `next.config.ts` makes Next transpile the config
// with the SWC native module at EVERY server boot (server/config.js ->
// transpileConfig -> loadBindings), which starts a Tokio runtime sized to
// `available_parallelism()`. On the 32-core shared host that is 32 threads per
// Next process, alive for the process's whole life and doing nothing — enough to
// push the cPanel account to its 200-process ceiling on its own. `.mjs` skips
// that branch entirely: the binding is never loaded. See DEPLOY.md.
//
// `.mjs` rather than `.js` because package.json has no `"type": "module"`, so
// `export default` keeps working unchanged.

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Media is served by Django on the same host (private IP in dev, same VPS in
    // prod). Next 16 blocks optimizing private-IP upstreams, and cPanel static
    // hosting has no optimizer. Serve images as-is; lazy-loading still applies.
    // Upload pre-sized product images to keep bandwidth low for rural users.
    unoptimized: true,
    remotePatterns: [
      { protocol: "http", hostname: "127.0.0.1", port: "8000", pathname: "/media/**" },
      { protocol: "http", hostname: "localhost", port: "8000", pathname: "/media/**" },
    ],
  },
  // /shop and the plain-product detail pages retired when the catalogue moved to
  // /products (every listing is a PrebuiltCombo now). 308s so search engines move
  // the ranking across instead of treating these as dead. Query strings — the
  // ?q= and ?category= that search and the homepage tiles use — carry over
  // automatically.
  async redirects() {
    return [
      { source: "/shop", destination: "/products", permanent: true },
      { source: "/product/:slug", destination: "/products", permanent: true },
    ];
  },
};

export default nextConfig;
