import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        clouda: {
          bg: "#FAF8F5",
          card: "#FFFFFF",
          border: "#E7E2DA",
          ink: "#26262B",
          muted: "#6B6B72",
          sage: "#7E9C8B",
          sageDark: "#5F7D6D",
          sageSoft: "#EDF2EE",
          violet: "#7C6BE0",
          amber: "#E0A45C",
          sky: "#7FC0D8",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        card: "20px",
        pill: "999px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(38,38,43,0.04)",
        lift: "0 12px 40px -18px rgba(38,38,43,0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
