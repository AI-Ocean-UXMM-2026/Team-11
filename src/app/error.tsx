"use client";
import { CircleHelp } from "lucide-react";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <div className="error-box">
        <CircleHelp size={40} />
        <h1>The workspace couldn’t load.</h1>
        <p>
          Check your Supabase connection and confirm the database migration is
          applied, then retry. Existing records have not been changed.
        </p>
        <button className="button primary" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
