import { useEffect, useState, type ReactNode } from 'react';

export type Step = {
  label: string;
  /** Gate on Next — undefined means the step is always satisfied. */
  valid?: boolean;
  content: ReactNode;
};

/**
 * Multi-step dialog. Steps are declared by the caller so each wizard keeps its
 * own form state; this only owns which step is showing and the navigation.
 */
export function Wizard({
  title,
  kicker,
  steps,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  title: string;
  kicker: string;
  steps: Step[];
  submitLabel: string;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const [i, setI] = useState(0);
  const last = i === steps.length - 1;
  const step = steps[i];
  const canAdvance = step.valid !== false;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // Only a click that starts and ends on the backdrop dismisses, so a drag
      // that ends outside the dialog does not throw the form away.
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="dialog dialog-wide">
        <div className="wiz-head">
          <div>
            <div className="kicker">{kicker}</div>
            <h2 className="dialog-title">{title}</h2>
          </div>
          <button className="btn btn-ghost" type="button" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </div>

        <ol className="wiz-rail">
          {steps.map((s, n) => (
            <li key={s.label} className={n === i ? 'on' : n < i ? 'done' : undefined} aria-current={n === i}>
              <span className="n">{String(n + 1).padStart(2, '0')}</span>
              <span className="l">{s.label}</span>
            </li>
          ))}
        </ol>

        <div className="wiz-body">{step.content}</div>

        <div className="dialog-actions">
          <button className="btn btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <span style={{ flex: 1 }} />
          {i > 0 && (
            <button className="btn btn-secondary" type="button" onClick={() => setI(i - 1)}>
              ← BACK
            </button>
          )}
          <button
            className="btn btn-primary"
            type="button"
            disabled={!canAdvance}
            onClick={() => (last ? onSubmit() : setI(i + 1))}
          >
            {last ? submitLabel : 'NEXT →'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Labelled field using the design system's .field/.input pair. */
export const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) => (
  <div className="field">
    <label>{label}</label>
    {children}
    {hint && <p className="note" style={{ marginTop: 5 }}>{hint}</p>}
  </div>
);

/** Radio list of options, one per row, in the system's card idiom. */
export function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; title: string; sub?: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="choices">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`choice${value === o.value ? ' on' : ''}`}
          // The label lives in nested spans, which leaves the button unnamed
          // in the accessibility tree — state it explicitly.
          aria-label={o.title}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
        >
          <span className="dot" aria-hidden />
          <span>
            <span className="t">{o.title}</span>
            {o.sub && <span className="s">{o.sub}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Read-only key/value list used by every wizard's review step. */
export const Review = ({ rows }: { rows: [string, ReactNode][] }) => (
  <div className="rows">
    {rows.map(([k, v]) => (
      <div className="row" key={k}>
        <span className="k">{k}</span>
        <span className="figure">{v}</span>
      </div>
    ))}
  </div>
);
