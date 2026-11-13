import type { NextConfig } from "next";

/**
 * Security headers on every response. No script/style CSP: Next injects inline scripts, and a
 * nonce-based CSP isn't worth the breakage risk here. `frame-ancestors` alone (plus X-Frame-Options
 * for old browsers) stops the app from being framed (clickjacking).
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), " +
      "magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
