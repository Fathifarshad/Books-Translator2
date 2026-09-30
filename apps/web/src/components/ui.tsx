import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'pill' | 'chip';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-on-accent hover:bg-accent-hover border border-transparent rounded-lg px-3.5 py-2 text-sm font-medium',
  secondary:
    'bg-surface text-text border border-border hover:border-accent/60 hover:text-accent rounded-lg px-3 py-1.5 text-sm',
  ghost: 'text-muted hover:text-text hover:bg-row-hover rounded-lg px-2 py-1.5 text-sm border border-transparent',
  pill: 'rounded-full border px-3.5 py-1 text-sm aria-pressed:bg-accent-soft aria-pressed:text-accent aria-pressed:border-accent/60 border-border bg-surface text-muted hover:text-text',
  chip: 'bg-surface text-text border border-border hover:border-accent/60 hover:text-accent rounded-lg px-3 py-2 text-sm text-start shadow-[0_1px_0_rgb(0_0_0/0.03)]',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
  iconEnd?: IconName;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', icon, iconEnd, className = '', children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
      {iconEnd ? <Icon name={iconEnd} size={16} /> : null}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: number;
}

/** Icon-only button: the label is both the accessible name and the hover title. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 18, className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-row-hover hover:text-text disabled:opacity-40 ${className}`}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
});

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-1 w-full overflow-hidden rounded-full bg-border"
    >
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd dir="ltr" className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-muted">
      {children}
    </kbd>
  );
}
