import type { NextConfig } from "next";

const config: NextConfig = {
  // Fully static — the whole experience is precomputed data + client rendering,
  // so there is no server to pay for.
  output: "export",
  reactStrictMode: true,

  // Next 16 runs Turbopack by default. onnxruntime-web's .wasm binaries are
  // fetched at runtime from /public rather than bundled, so no loader config is
  // needed here — an empty object just opts in explicitly and silences the
  // "webpack config with no turbopack config" error.
  turbopack: {},
};

export default config;
