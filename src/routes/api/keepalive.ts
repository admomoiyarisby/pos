import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { db } from "#/lib/server/db";

/**
 * Lightweight endpoint hit by the Vercel Cron job (see vercel.json) to keep
 * the Supabase database from being paused for inactivity. It just opens a
 * connection and runs `select 1` — no data is read or written.
 *
 * If a CRON_SECRET env var is set on Vercel, the request must carry
 * `Authorization: Bearer <CRON_SECRET>` (Vercel sends this automatically for
 * cron jobs). When the secret is unset the endpoint stays open, which keeps
 * it working in local/dev and before the secret is configured.
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
          return new Response(JSON.stringify({ ok: false, error: String(err) }), {
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
