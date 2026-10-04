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
        zinc: {
          50: '#F8F5FB',
          100: '#F0EAF6',
          200: '#E2D9EC',
          300: '#CBBFD9',
          400: '#9C8EAF',
          500: '#7A6C8C',
          600: '#5E516F',
          700: '#463B55',
          800: '#2A2036',
          900: '#181220',
          950: '#0E0A12',
        },
        hs: {
          50: '#F6EEFB',
          100: '#EBD9F6',
          200: '#D9B8EE',
          300: '#B67CF0',
          400: '#A35CE0',
          500: '#7A1FB8',
          600: '#6A0FA3',
          700: '#5C088C',
          800: '#490772',
          900: '#36055A',
          950: '#230338',
        },
      },
    },
  },
  plugins: [],
}
