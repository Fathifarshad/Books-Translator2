import { type ReactNode, useId } from 'react';
import { Icon } from '../../components/Icon';
import { fmtNum } from '../../lib/format';

/** Small form controls of the cover editor: a slider with its value, a colour field, segments, a switch. */

export const fieldClass =
  'w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent/60';

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** How the value is shown (default: the number in the UI's digits). */
  format?: (v: number) => string;
  testId?: string;
}) {
  const id = useId();
  const { label, value, min, max, step, onChange, format, testId } = props;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <label htmlFor={id} className="text-muted">
          {label}
        </label>
        <output htmlFor={id} className="tabular-nums text-text">
          {format ? format(value) : fmtNum(Math.round(value * 100) / 100)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
        data-testid={testId}
      />
    </div>
  );
}

export function ColorField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Colours of the design offered one click away. */
  swatches?: string[];
  testId?: string;
}) {
  const id = useId();
  const { label, value, onChange, swatches = [], testId } = props;
  const unique = [...new Set(swatches.map((s) => s.toLowerCase()))].filter((s) => s !== value).slice(0, 5);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-border bg-bg p-0.5"
          data-testid={testId}
        />
        <bdi className="font-mono text-xs text-muted" dir="ltr">
          {value}
        </bdi>
        {unique.map((s) => (
          <button
            key={s}
            type="button"
            title={s}
            aria-label={`${label} ${s}`}
            onClick={() => onChange(s)}
            className="size-6 rounded-full border border-black/15 shadow-sm"
            style={{ background: s }}
          />
        ))}
      </div>
    </div>
  );
}

export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  testId?: string;
}) {
  const { label, value, options, onChange, testId } = props;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1" data-testid={testId}>
        {options.map((o) => (
          // biome-ignore lint/a11y/useSemanticElements: a row of toggle buttons reads better than radio inputs here
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:text-text aria-checked:border-accent/60 aria-checked:bg-accent-soft aria-checked:text-accent"
            data-value={o.value}
          >
            {o.icon ?? o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        data-testid={props.testId}
      />
      {props.label}
    </label>
  );
}

/** A titled group of controls that can be folded away. */
export function Group(props: { title: string; children: ReactNode; open?: boolean; testId?: string }) {
  return (
    <details open={props.open ?? true} className="group border-t border-border pt-3" data-testid={props.testId}>
      <summary className="mb-2 flex cursor-pointer list-none items-center gap-1.5 text-sm font-bold [&::-webkit-details-marker]:hidden">
        <Icon
          name="chevronDown"
          size={15}
          className="-rotate-90 text-muted transition-transform group-open:rotate-0 rtl:rotate-90 rtl:group-open:rotate-0"
        />
        {props.title}
      </summary>
      <div className="flex flex-col gap-3">{props.children}</div>
    </details>
  );
}
