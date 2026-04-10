import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-[#2563EB] text-white hover:bg-[#1D4ED8]',
  secondary: 'bg-[#F3F4F6] text-[#111827] border border-[#E5E7EB] hover:bg-[#E5E7EB]',
  ghost: 'bg-transparent text-[#6B7280] hover:bg-[#E5E7EB] hover:text-[#111827]',
  danger: 'bg-red-50 text-red-700 hover:bg-red-100',
};

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center px-3 py-1.5 rounded text-sm font-medium transition-colors min-h-[32px] ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
