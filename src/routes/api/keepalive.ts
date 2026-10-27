import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { db } from "#/lib/server/db";

/**
 * Lightweight database probe. Originally hit by a Vercel Cron job to keep the
 * Supabase free project from pausing for inactivity; with the native Postgres
 * on the VPS that job is obsolete, but the endpoint stays as a cheap liveness
 * check. It opens a connection and runs `select 1` — no data is read or
 * written.
 *
 * If a CRON_SECRET env var is set, the request must carry
 * `Authorization: Bearer <CRON_SECRET>`. When the secret is unset the endpoint
 * stays open, which keeps it working in local/dev.
 */
export const Route = createFileRoute("/api/keepalive")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        if (secret) {
          const auth = request.headers.get("authorization");
          if (auth !== `Bearer ${secret}`) {
            return new Response("Unauthorized", { status: 401 });
          }
        }

        try {
          await db.execute(sql`select 1`);
        } catch (err) {
          // Returning 500 lets Vercel surface the failure in cron logs; the
          // connection attempt itself still wakes a paused Supabase instance.
          //
          // The detail is logged, never returned: this endpoint is open to
          // anyone when CRON_SECRET is unset, and `String(err)` on a failed
          // statement renders the SQL and its bound parameters into the body.
          console.error("[keepalive] database probe failed", err);
          return new Response(JSON.stringify({ ok: false }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ ok: true, at: new Date().toISOString() }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
