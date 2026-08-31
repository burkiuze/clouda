import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        clouda: {
          bg: "#F6F3FF",
          violet: "#7C3AED",
          violetDark: "#5B21B6",
          lilac: "#C4B5FD",
          ink: "#0B0714",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "clouda-radial":
          "radial-gradient(120% 120% at 100% 0%, #E9E1FF 0%, #F6F3FF 45%, #F6F3FF 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
