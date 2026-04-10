/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        tiny: ['11px', { lineHeight: '14px' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['16px', { lineHeight: '24px' }],
        lg: ['18px', { lineHeight: '28px' }],
      },
      colors: {
        surface: {
          0: '#FFFFFF',
          1: '#F9FAFB',
          2: '#F3F4F6',
          3: '#E5E7EB',
        },
        'text-primary': '#111827',
        'text-secondary': '#6B7280',
        'text-tertiary': '#9CA3AF',
        accent: {
          blue: '#2563EB',
          'blue-dark': '#1D4ED8',
        },
        status: {
          green: '#059669',
          yellow: '#D97706',
          red: '#DC2626',
        },
        issue: {
          epic: { bg: '#EDE9FE', text: '#6D28D9' },
          story: { bg: '#DBEAFE', text: '#1D4ED8' },
          task: { bg: '#D1FAE5', text: '#047857' },
          bug: { bg: '#FEE2E2', text: '#B91C1C' },
        },
      },
      spacing: {
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        6: '24px',
        8: '32px',
      },
      borderRadius: {
        DEFAULT: '4px',
      },
    },
  },
};
