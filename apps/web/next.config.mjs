/** @type {import('next').NextConfig} */
const nextConfig = {
  // @duskfleet/core uses node:sqlite and child_process; keep it out of the bundler
  // and require it at runtime in the Node.js server runtime.
  serverExternalPackages: ["@duskfleet/core"],
};

export default nextConfig;
