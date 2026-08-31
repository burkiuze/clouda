import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        clouda: {
          bg: "#F6F4EF",
          card: "#FFFFFF",
          panel: "#EFEDE6",
          border: "#DFDCD3",
          ink: "#0B0B0C",
          muted: "#5A5A60",
          indigo: "#1F1BE8",
          indigoSoft: "#E8E7FE",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        serif: ["'Source Serif 4'", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        btn: "6px",
        card: "10px",
      },
    },
  },
  plugins: [],
};

export default config;
