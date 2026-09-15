// EmptyState.tsx
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
      <p className="text-muted">{title}</p>
      {hint && <p className="text-[12px] text-muted/70">{hint}</p>}
    </div>
  )
}
