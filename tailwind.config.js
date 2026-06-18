/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: {
          950: '#030804',
          900: '#070f07',
          800: '#0d1a0d',
          700: '#162616',
          600: '#1e3a1e',
          500: '#2a4f2a',
          400: '#3d6e3d',
        },
      },
    },
  },
  plugins: [],
}
