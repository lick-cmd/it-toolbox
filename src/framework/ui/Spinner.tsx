// Spinner.tsx
export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-[12px] text-muted">
      <span
        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent"
        aria-hidden="true"
      />
      {label}
    </span>
  )
}
