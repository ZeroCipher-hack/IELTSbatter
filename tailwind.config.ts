import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dbe6fe",
          200: "#bfd3fe",
          300: "#93b4fd",
          400: "#608afa",
          500: "#3b63f6",
          600: "#2544eb",
          700: "#1d32d8",
          800: "#1e2baf",
          900: "#1e2a8a",
          950: "#171d51",
        },
      },
    },
  },
  plugins: [],
};
export default config;
