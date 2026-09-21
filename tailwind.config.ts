import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fff5ed",
          100: "#ffe6d5",
          200: "#ffcbab",
          300: "#ffab79",
          400: "#ff8847",
          500: "#f46d24",
          600: "#ba4109",
          700: "#983407",
          800: "#7b2f10",
          900: "#652910",
          950: "#361306",
        },
      },
    },
  },
  plugins: [],
};
export default config;
