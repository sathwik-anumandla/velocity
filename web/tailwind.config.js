/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: {
          dark: '#000000',
          light: '#FFFFFF',
        },
        card: {
          dark: '#141414',
          light: '#F4F4F5',
        },
        popover: {
          dark: '#1E1E22',
          light: '#FFFFFF',
        },
        border: {
          dark: '#27272A',
          light: '#E4E4E7',
        },
        muted: {
          dark: '#A1A1AA',
          light: '#71717A',
        }
      },
      fontFamily: {
        sans: ['Satoshi', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Roboto Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
