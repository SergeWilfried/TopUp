import { useEffect, type ReactNode } from 'react';

/**
 * The dialog shell, lifted out of Wizard so everything that overlays behaves
 * the same way.
 *
 * The two behaviours worth keeping identical: Escape closes, and a click
 * dismisses only when it both starts and ends on the backdrop — so a drag that
 * happens to finish outside the dialog does not throw away a half-filled form.
 */
export function Modal({
  title,
  kicker,
  wide,
  onClose,
  children,
}: {
  title: string;
  kicker?: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`dialog${wide ? ' dialog-wide' : ''}`}>
        <div className="rowBetween" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            {kicker && <div className="kicker">{kicker}</div>}
            <h3 className="dialog-title">{title}</h3>
          </div>
          <button className="btn btn-ghost" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
