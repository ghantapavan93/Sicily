import clsx from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

const BUTTON: Record<ButtonVariant, string> = {
  // Warm brass with a little depth under the hand. The lift is the only thing that moves.
  primary:
    "bg-brass text-ground-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] hover:bg-brass-ink hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_24px_-14px_rgba(210,162,76,0.7)] active:translate-y-px disabled:bg-ground-3 disabled:text-ink-lo disabled:shadow-none disabled:active:translate-y-0",
  secondary:
    "border border-line bg-ground-2 text-ink-hi hover:border-ink-lo disabled:text-ink-lo disabled:hover:border-line",
  ghost: "text-ink-mid hover:text-ink-hi disabled:text-ink-lo",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
}

/** Control labels are set in small capitals so actions read apart from prose. */
export function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold uppercase tracking-[0.1em] transition-[color,background-color,border-color,box-shadow,transform] duration-150 disabled:cursor-not-allowed",
        size === "sm" && "min-h-9 px-3.5 text-[0.6875rem]",
        size === "md" && "min-h-11 px-5 text-xs",
        size === "lg" && "min-h-14 px-8 text-sm",
        BUTTON[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function Panel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("rounded-2xl border border-line bg-ground-1", className)} {...rest} />;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={clsx("eyebrow", className)}>{children}</p>;
}

type ChipTone = "neutral" | "brass" | "verified" | "planned" | "unknown" | "conflict";

const CHIP: Record<ChipTone, string> = {
  neutral: "border-line text-ink-mid",
  brass: "border-brass/40 bg-brass/10 text-brass-ink",
  verified: "border-verified/40 bg-verified/10 text-verified",
  planned: "border-planned/40 bg-planned/10 text-planned",
  unknown: "border-unknown/40 bg-unknown/10 text-unknown",
  conflict: "border-conflict/45 bg-conflict/10 text-conflict",
};

export function Chip({
  tone = "neutral",
  dashed = false,
  className,
  children,
  title,
}: {
  tone?: ChipTone;
  dashed?: boolean;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]",
        dashed && "border-dashed",
        CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
