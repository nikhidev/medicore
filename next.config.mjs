export default {
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination:
          (process.env.MEDICORE_API_URL ?? "http://127.0.0.1:4080") +
          "/v1/:path*",
      },
    ];
  },
};
