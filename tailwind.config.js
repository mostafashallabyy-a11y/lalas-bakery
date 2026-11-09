/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        cairo: ["Cairo", "system-ui", "sans-serif"],
        script: ["Brush Script MT", "Segoe Script", "cursive"],
      },
      colors: {
        brand: {
          50: "#fbf3f4",
          100: "#f9dfe5",
          200: "#ecc9d2",
          300: "#e4a0b2",
          400: "#c98a99",
          500: "#b0687a",
          600: "#9d5a6c",
          700: "#7d3f50",
          800: "#6b3444",
          900: "#4a2a33",
        },
        mut: "#8f6f77",
        ok: "#4f8a63",
      },
    },
  },
  plugins: [],
};
