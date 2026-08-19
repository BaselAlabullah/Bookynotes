// Tailwind v4 runs entirely as a PostCSS plugin. There is no tailwind.config.js:
// theme and content detection live in src/app/globals.css.
const config = {
  plugins: ["@tailwindcss/postcss"],
};

export default config;
