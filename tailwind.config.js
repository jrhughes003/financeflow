/** @type {import('tailwindcss').Config} */
// The theme maps onto the CSS variables in src/styles/tokens.css, so a utility
// like `bg-surface` or `text-ink-muted` resolves to a token rather than a raw
// palette value — which is what makes dark mode later a token swap instead of a
// sweep through every component.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--c-canvas)',
        surface: {
          DEFAULT: 'var(--c-surface)',
          sunk: 'var(--c-surface-sunk)',
          hover: 'var(--c-surface-hover)',
        },
        ink: {
          DEFAULT: 'var(--c-ink)',
          secondary: 'var(--c-ink-secondary)',
          muted: 'var(--c-ink-muted)',
          inverse: 'var(--c-ink-inverse)',
        },
        line: {
          DEFAULT: 'var(--c-line)',
          strong: 'var(--c-line-strong)',
          faint: 'var(--c-line-faint)',
        },
        accent: {
          DEFAULT: 'var(--c-accent)',
          hover: 'var(--c-accent-hover)',
          tint: 'var(--c-accent-tint)',
          ink: 'var(--c-accent-ink)',
        },
        positive: { DEFAULT: 'var(--c-positive)', tint: 'var(--c-positive-tint)' },
        negative: { DEFAULT: 'var(--c-negative)', tint: 'var(--c-negative-tint)' },
        caution: { DEFAULT: 'var(--c-caution)', tint: 'var(--c-caution-tint)' },
        data: {
          1: 'var(--c-data-1)', 2: 'var(--c-data-2)', 3: 'var(--c-data-3)', 4: 'var(--c-data-4)',
          5: 'var(--c-data-5)', 6: 'var(--c-data-6)', 7: 'var(--c-data-7)',
        },
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-numeric)',
      },
      fontSize: {
        micro: ['11px', { lineHeight: '1.2', letterSpacing: '0.07em' }],
        caption: ['12px', { lineHeight: '1.35' }],
        sm: ['13px', { lineHeight: '1.45' }],
        base: ['14px', { lineHeight: '1.5' }],
        lg: ['16px', { lineHeight: '1.45', letterSpacing: '-0.005em' }],
        xl: ['20px', { lineHeight: '1.3', letterSpacing: '-0.015em' }],
        '2xl': ['26px', { lineHeight: '1.15', letterSpacing: '-0.022em' }],
        display: ['34px', { lineHeight: '1.05', letterSpacing: '-0.03em' }],
      },
      borderRadius: {
        control: 'var(--r-control)',
        container: 'var(--r-container)',
        pill: 'var(--r-pill)',
      },
      boxShadow: {
        overlay: 'var(--shadow-overlay)',
        raised: 'var(--shadow-raised)',
      },
      spacing: {
        row: 'var(--row-height)',
      },
    },
  },
  plugins: [],
};
