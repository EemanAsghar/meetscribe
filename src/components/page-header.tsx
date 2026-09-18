export function PageHeader({ title, meta, actions }: { title: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-5 py-1.5">
      <h1 className="truncate text-base font-semibold text-ink">{title}</h1>
      {meta && <div className="hidden items-center gap-2 text-xs text-ink-3 sm:flex">{meta}</div>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </header>
  );
}
