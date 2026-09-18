export function PageHeader({ title, meta, actions }: { title: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-5">
      <h1 className="truncate text-base font-semibold text-ink">{title}</h1>
      {meta && <div className="flex items-center gap-2 text-xs text-ink-3">{meta}</div>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </header>
  );
}
