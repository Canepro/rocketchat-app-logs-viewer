import * as React from 'react';

import { cn } from '@/lib/utils';

export interface SkeletonRowsProps extends React.HTMLAttributes<HTMLDivElement> {
  rows?: number;
  label?: string;
}

/**
 * Lightweight row skeleton used for list-like loading states (audit, saved views, room/thread targets).
 * Keeps layout stable while data is pending and avoids flashing empty-state placeholders first.
 */
export function SkeletonRows({
  rows = 4,
  label = 'Loading entries',
  className,
  ...props
}: SkeletonRowsProps) {
  return (
    <div
      className={cn('rounded-md border border-border/70 bg-muted/20 p-3', className)}
      role="status"
      aria-live="polite"
      {...props}
    >
      <span className="sr-only">{label}</span>
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={`skeleton-row-${index}`} className="animate-pulse">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="mt-2 h-2.5 w-full rounded bg-muted/80" />
            <div className="mt-1.5 h-2.5 w-4/5 rounded bg-muted/70" />
          </div>
        ))}
      </div>
    </div>
  );
}
