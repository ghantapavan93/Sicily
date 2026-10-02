import Link from "next/link";

/** A wrong address gets the product's own page, not the framework default. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-md">
        <p className="eyebrow">Not found</p>
        <h1 className="mt-3 font-display text-4xl font-light leading-tight text-ink-hi">There is nothing at this address.</h1>
        <p className="mt-3 text-ink-mid">The whole prototype lives on one page.</p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brass px-5 text-xs font-semibold uppercase tracking-[0.1em] text-ground-0 hover:bg-brass-ink"
        >
          Open the night
        </Link>
      </div>
    </main>
  );
}
