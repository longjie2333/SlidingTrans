import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/35 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border border-brand bg-brand text-brand-foreground hover:bg-brand/90",
        outline: "border border-brand bg-transparent text-brand hover:bg-brand-soft",
        ghost: "border border-transparent bg-transparent text-slate-500 hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-800",
        destructive: "border border-transparent bg-red-600 text-white hover:bg-red-700",
      },
      size: {
        default: "min-h-9 px-3",
        sm: "min-h-8 px-2.5 text-xs",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";
