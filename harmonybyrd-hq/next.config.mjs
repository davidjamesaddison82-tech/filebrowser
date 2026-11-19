// HQ holds private development records: no usage telemetry leaves the machine.
process.env.NEXT_TELEMETRY_DISABLED = "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  agentRules: false,
  // No floating development badge: nothing may sit on top of HQ's content.
  devIndicators: false,
  // pg uses native Node APIs and must not be bundled.
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HQ serves private development records: never let a shared cache keep a copy.
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
