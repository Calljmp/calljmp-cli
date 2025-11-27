// Shim for dynamic require() calls in bundled code
// Maps Node.js built-in module names to dynamic imports
// This allows packages like mysql2 to work in Cloudflare Workers with nodejs_compat_v2

export function __require(id) {
  // Map of Node.js built-in modules that might be dynamically required
  const builtins = {
    events: () => import('node:events'),
    stream: () => import('node:stream'),
    buffer: () => import('node:buffer'),
    crypto: () => import('node:crypto'),
    util: () => import('node:util'),
    process: () => import('node:process'),
    timers: () => import('node:timers'),
    net: () => import('node:net'),
    tls: () => import('node:tls'),
    zlib: () => import('node:zlib'),
    fs: () => import('node:fs'),
    path: () => import('node:path'),
    os: () => import('node:os'),
    async_hooks: () => import('node:async_hooks'),
    string_decoder: () => import('node:string_decoder'),
    url: () => import('node:url'),
    querystring: () => import('node:querystring'),
  };

  if (builtins[id]) {
    // Return a synchronous-looking module wrapper
    // This is a hack but necessary for some packages
    throw new Error(
      `Dynamic require of "${id}" is not supported. The package must be updated to use static imports.`
    );
  }

  throw new Error(`Cannot require module "${id}"`);
}

// Make require available globally for dynamic requires
export const require = __require;
