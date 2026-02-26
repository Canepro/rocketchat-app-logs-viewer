import * as React from 'react';

import { cn } from '@/lib/utils';

const alertVariants = {
  default: 'border-border bg-card',
  destructive: 'border-destructive/50 bg-destructive/10 text-destructive',
  success: 'border-success/50 bg-success/10 text-success',
  warning: 'border-warning/50 bg-warning/10 text-warning',
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof alertVariants;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = 'default', role, ['aria-live']: ariaLive, ...props }, ref) => {
    const resolvedRole = role ?? (variant === 'destructive' ? 'alert' : 'status');
    const resolvedAriaLive = ariaLive ?? (variant === 'destructive' ? 'assertive' : 'polite');

    return (
      <div
        ref={ref}
        role={resolvedRole}
        aria-live={resolvedAriaLive}
        className={cn(
          'rounded-md border p-3 text-sm',
          alertVariants[variant],
          className,
        )}
        {...props}
      />
    );
  },
);
Alert.displayName = 'Alert';
