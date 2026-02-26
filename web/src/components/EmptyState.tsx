import * as React from 'react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 py-8 px-4 text-center',
        className,
      )}
      {...props}
    >
      {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      {title ? <p className="text-sm font-medium text-foreground">{title}</p> : null}
      {description ? (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      ) : null}
      {children}
    </div>
  );
}
