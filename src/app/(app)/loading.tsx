/** Shown instantly on navigation while the server renders the page, so the app never looks frozen. */
export default function Loading() {
  return (
    <>
      <div className="flex h-12 shrink-0 items-center border-b border-line bg-surface px-5"><div className="h-4 w-40 animate-pulse rounded-sm bg-sunken" /></div>
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-3 px-5 py-6" aria-busy="true" aria-label="Loading">
        {[70, 92, 84, 60, 88, 76, 52].map((w, i) => <div key={i} className="h-3.5 animate-pulse rounded-sm bg-sunken" style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }} />)}
      </div>
    </>
  );
}
