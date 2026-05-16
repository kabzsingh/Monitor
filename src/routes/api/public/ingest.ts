import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdmin, type Env } from "@/lib/supabase";
import { getApiKeyByHash, getMetersForSite, insertReading } from "@/lib/db";
import { getEvent } from "vinxi/http";
import crypto from "crypto";
import { z } from "zod";

const PayloadSchema = z.object({
  readings: z.array(z.object({
    device_key: z.string().min(1).max(64),
    value: z.number().finite(),
    recorded_at: z.string().datetime().optional(),
  })).min(1).max(200),
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-site-api-key, authorization",
  };
}

export const Route = createFileRoute("/api/public/ingest")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      POST: async ({ request }) => {
        // Access Cloudflare environment via Vinxi event context
        const event = getEvent();
        const env = (event?.context as any)?.cloudflare?.env as Env;

        if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) {
          return json({ error: "Server configuration missing" }, 500);
        }

        const db = getSupabaseAdmin(env);

        const apiKey =
          request.headers.get("x-site-api-key") ||
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
        if (!apiKey) return json({ error: "Missing x-site-api-key" }, 401);

        // Hash the API key to compare with stored hashes
        const hash = crypto.createHash("sha256").update(apiKey).digest("hex");

        let keyRow;
        try {
          keyRow = await getApiKeyByHash(db, hash);
        } catch (e: any) {
          if (e.code === 'PGRST116') return json({ error: "Invalid key" }, 401);
          return json({ error: e.message }, 500);
        }

        if (!keyRow || keyRow.revoked) return json({ error: "Invalid key" }, 401);

        let body: unknown;
        try { body = await request.json(); }
        catch { return json({ error: "Invalid JSON" }, 400); }

        const parsed = PayloadSchema.safeParse(body);
        if (!parsed.success) return json({ error: "Invalid payload", issues: parsed.error.flatten() }, 400);

        const meters = await getMetersForSite(db, keyRow.site_id);
        const map = new Map(meters.map((m) => [m.device_key, m.id]));

        const rows: any[] = [];
        const unknown: string[] = [];
        for (const r of parsed.data.readings) {
          const meterId = map.get(r.device_key);
          if (!meterId) { unknown.push(r.device_key); continue; }
          rows.push({
            site_id: keyRow.site_id,
            meter_id: meterId,
            value: r.value,
            ...(r.recorded_at ? { recorded_at: r.recorded_at } : {}),
          });
        }

        if (rows.length === 0) return json({ error: "No matching meters", unknown }, 400);

        // Insert readings using the db helper
        const { error: insErr } = await db.from("readings").insert(rows);
        if (insErr) return json({ error: insErr.message }, 500);

        // Update last used timestamp
        await db.from("site_api_keys")
          .update({ last_used_at: new Date().toISOString() })
          .eq("key_hash", hash);

        return json({ ok: true, accepted: rows.length, unknown });
      },
    },
  },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
