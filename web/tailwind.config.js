/** Paleta empresarial (Noche/Día) (estilo Datadog). Los colores de estado son exclusivos para estado. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Clases que se arman dinámicamente (badge-${tone}, pulse-${tone})
  safelist: [{ pattern: /^(badge|pulse)-(ok|warn|crit|info|sg|off)$/ }],
  theme: {
    extend: {
      colors: {
        // Colores por variable CSS (tema Noche/Día en index.css). Admiten opacidad: bg-surface/50
        bg: 'rgb(var(--c-bg) / <alpha-value>)', bg1: 'rgb(var(--c-bg1) / <alpha-value>)', surface: 'rgb(var(--c-surface) / <alpha-value>)',
        surface2: 'rgb(var(--c-surface2) / <alpha-value>)', hover: 'rgb(var(--c-hover) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)', line2: 'rgb(var(--c-line2) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)', ink2: 'rgb(var(--c-ink2) / <alpha-value>)', muted: 'rgb(var(--c-muted) / <alpha-value>)', faint: 'rgb(var(--c-faint) / <alpha-value>)',
        ok: 'rgb(var(--c-ok) / <alpha-value>)', warn: 'rgb(var(--c-warn) / <alpha-value>)', crit: 'rgb(var(--c-crit) / <alpha-value>)',
        info: 'rgb(var(--c-info) / <alpha-value>)', violet: '#A3E635', cyan: '#22D3EE', brand: 'rgb(var(--c-brand) / <alpha-value>)', lime: 'rgb(var(--c-lime) / <alpha-value>)', sg: 'rgb(var(--c-sg) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Mulish', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Jost', 'Futura', 'Mulish', 'sans-serif'], 
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      keyframes: {
        ring: { '0%': { transform: 'scale(1)', opacity: '.55' }, '80%,100%': { transform: 'scale(2.8)', opacity: '0' } },
        pop: { from: { opacity: '0', transform: 'translateY(-4px) scale(.98)' }, to: { opacity: '1', transform: 'none' } },
        tin: { from: { opacity: '0', transform: 'translateY(10px)' } },
        fade: { from: { opacity: '0' } },
        slidein: { from: { transform: 'translateX(-100%)' } },
      },
      animation: {
        ring: 'ring 2.2s ease-out infinite', ringfast: 'ring 1.2s ease-out infinite',
        pop: 'pop .14s ease-out', tin: 'tin .22s ease-out', fade: 'fade .15s ease-out',
      },
    },
  },
  plugins: [],
};
