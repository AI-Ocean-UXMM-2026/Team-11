import Link from "next/link";
import { Boxes } from "lucide-react";
export default function Setup() {
  return (
    <main className="error-page">
      <div className="error-box">
        <Boxes size={40} />
        <h1>Connect your Supabase workspace.</h1>
        <p>
          Copy .env.example to .env.local and add your Supabase URL and
          publishable key. Apply the database migration and provision the first
          HQ account using the setup guide.
        </p>
        <p>
          For a local preview, set NEXT_PUBLIC_DEMO_MODE=true and restart the
          server.
        </p>
        <Link className="button secondary" href="/login">
          Go to sign in
        </Link>
      </div>
    </main>
  );
}
