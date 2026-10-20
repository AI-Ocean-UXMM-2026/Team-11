import Link from "next/link";
export default function NotFound() {
  return (
    <main className="error-page">
      <div className="error-box">
        <h1>This page isn’t in your workspace.</h1>
        <p>Return to your overview to continue.</p>
        <Link className="button primary" href="/">
          Back to overview
        </Link>
      </div>
    </main>
  );
}
