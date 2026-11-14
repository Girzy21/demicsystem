/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  /* config options here */
  reactCompiler: true,
};

export default nextConfig;
