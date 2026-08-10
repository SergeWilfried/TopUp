import type { ReactNode } from 'react';
import type { OrderStatus, SubStatus } from '../api';

export const PageHead = ({ kicker, title, right }: { kicker: string; title: string; right?: ReactNode }) => (
  <div className="pagehead">
    <div>
      <div className="kicker">{kicker}</div>
      <h1>{title}</h1>
    </div>
    {right}
  </div>
);

export type Kpi = { label: string; value: string; sub?: ReactNode; delta?: number };

// One bordered block with hairline-divided cells, per the dashboard design.
export const KpiStrip = ({ items }: { items: Kpi[] }) => (
  <div className="kpis">
    {items.map((k) => (
      <div className="kpi" key={k.label}>
        <div className="label">{k.label}</div>
        <div className="value num">{k.value}</div>
        <div className="sub">
          {k.delta !== undefined && (
            <span className={k.delta >= 0 ? 'up' : 'down'}>
              {k.delta >= 0 ? '▲' : '▼'} {Math.abs(k.delta)}%{' '}
            </span>
          )}
          {k.sub}
        </div>
      </div>
    ))}
  </div>
);

export const SecHead = ({ title, right }: { title: string; right?: ReactNode }) => (
  <div className="sechead">
    <h2>{title}</h2>
    {right}
  </div>
);

export const Seg = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) => (
  <div className="seg">
    {options.map((o) => (
      <div
        key={o}
        className="opt"
        role="button"
        tabIndex={0}
        aria-pressed={value === o}
        onClick={() => onChange(o)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onChange(o)}
      >
        {o}
      </div>
    ))}
  </div>
);

export function Pager({
  page,
  pages,
  label,
  onPage,
}: {
  page: number;
  pages: number;
  label: string;
  onPage: (p: number) => void;
}) {
  return (
    <div className="pager">
      <div className="count">{label}</div>
      <div className="btns">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ← PREV
        </button>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          NEXT →
        </button>
      </div>
    </div>
  );
}

export const Panel = ({ title, children }: { title?: string; children: ReactNode }) => (
  <div className="panel">
    <div className="body">
      {title && <h3 className="title">{title}</h3>}
      {children}
    </div>
  </div>
);

const ORDER_TONE: Record<OrderStatus, string> = {
  delivered: 'tag-neutral',
  pending: 'tag-outline',
  failed: 'tag-accent',
  refunded: 'tag-neutral',
};

export const OrderTag = ({ status }: { status: OrderStatus }) => (
  <span className={`tag ${ORDER_TONE[status]}`}>{status.toUpperCase()}</span>
);

const SUB_TONE: Record<SubStatus, string> = {
  active: 'tag-neutral',
  expiring: 'tag-outline',
  lapsed: 'tag-accent',
};

export const SubTag = ({ status }: { status: SubStatus }) => (
  <span className={`tag ${SUB_TONE[status]}`}>{status.toUpperCase()}</span>
);

export const Meter = ({ pct, label }: { pct: number; label: string }) => (
  <div className="usage">
    <div className="meter">
      <i style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
    </div>
    <span className="figure num">{label}</span>
  </div>
);
