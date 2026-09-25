/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /**
         * Control-plane palette.
         *
         * The superadmin console is an instrument, not a consumer screen: dense,
         * read at a glance, often for hours. Its neutrals carry a slight blue
         * cast so the warm brand orange reads as a deliberate accent against
         * them rather than sharing their hue — and so the whole surface reads as
         * infrastructure rather than as another orange marketing page.
         *
         * The ramp splits by role, which is how the markup already uses it:
         *   200-600  text, brightest to faintest
         *   700-800  borders and dividers
         *   900-950  card surface and canvas
         *
         * Every text step clears WCAG AA (4.5:1) against every one of the three
         * surfaces — the faintest, sa-600 on sa-800, is the tightest at 4.66:1.
         * The scale it replaces did not: its sa-600 equivalent sat at 2.53:1 and
         * its most-used step, at 225 sites, at 4.18:1. Small uppercase labels
         * drawn in those were effectively invisible.
         */
        /**
         * The Dine3D accent, the same values the tenant app themes with, so the
         * control plane and the product read as one product.
         *
         * It is a FILL, not a text colour on dark: white on this orange is
         * 2.84:1 and fails outright, which is what the console's primary button
         * was doing. Labels on a brand fill take sa-950 (6.86:1). As text on the
         * dark canvas the orange itself is fine at 6.86:1.
         */
        brand: {
          DEFAULT: '#FF6B35',
          400: '#FF8C5C',
          500: '#FF6B35',
          600: '#E55A25',
        },
        sa: {
          200: '#EEF1F7',
          300: '#DADFE9',
          400: '#BFC8D6',
          500: '#A3AEC0',
          600: '#8792A6',
          700: '#333D4E',
          800: '#212936',
          900: '#141A24',
          950: '#0A0D13',
        },
        background: "var(--color-bg)",
        foreground: "var(--color-text)",
        primary: {
          DEFAULT: "var(--color-primary)",
          dark: "var(--color-primary-dark)",
          light: "var(--color-primary-light)",
        },
        surface: "var(--color-surface)",
        border: "var(--color-border)",
        success: "var(--color-success)",
        danger: "var(--color-danger)",
        warning: "var(--color-warning)",
        info: "var(--color-info)",
      },
      fontFamily: {
        body: ["var(--font-body)", "sans-serif"],
        heading: ["var(--font-heading)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: {
        global: "var(--border-radius)",
        sm: "var(--radius-sm)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        "2xl": "var(--shadow-2xl)",
        inner: "var(--shadow-inner)",
      },
      transitionTimingFunction: {
        "ease-out-custom": "var(--ease-out)",
        spring: "var(--ease-spring)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)",
        slow: "var(--duration-slow)",
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease both",
        "slide-up": "animateIn 0.4s cubic-bezier(0.16,1,0.3,1) both",
        shimmer: "shimmer 1.6s infinite",
        "pulse-slow": "pulse 3s cubic-bezier(0.4,0,0.6,1) infinite",
      },
      screens: {
        xs: "375px",
      },
    },
  },
  plugins: [],
};
