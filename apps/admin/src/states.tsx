import type { ReactNode } from 'react';

/** Row spanning the table while a request is in flight or has failed. */
export const TableState = ({
  loading,
  error,
  empty,
  colSpan,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  colSpan: number;
  onRetry: () => void;
}) => {
  if (!loading && !error && !empty) return null;
  return (
    <tr>
      <td colSpan={colSpan}>
        {loading ? (
          <p className="empty">Loading…</p>
        ) : error ? (
          <p className="empty">
            Could not load: <span className="lead">{error}</span>{' '}
            <button className="btn btn-ghost" type="button" onClick={onRetry}>
              RETRY
            </button>
          </p>
        ) : (
          <p className="empty">Nothing matches these filters.</p>
        )}
      </td>
    </tr>
  );
};

/** Block-level state for panels that are not tables. */
export const Loaded = ({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  children: ReactNode;
}) => {
  if (error)
    return (
      <p className="empty">
        Could not load: <span className="lead">{error}</span>{' '}
        <button className="btn btn-ghost" type="button" onClick={onRetry}>
          RETRY
        </button>
      </p>
    );
  if (loading) return <p className="empty">Loading…</p>;
  return <>{children}</>;
};
