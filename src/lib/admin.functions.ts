import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";
import crypto from "crypto";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Forbidden", { status: 403 });
}

// Generate a new site API key for ESP32 use. Returns plaintext ONCE.
export const createSiteApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ siteId: z.string().uuid(), label: z.string().max(60).optional() }).parse)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const raw = "ws_live_" + crypto.randomBytes(24).toString("hex");
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    const prefix = raw.slice(0, 12);
    const { error } = await supabaseAdmin.from("site_api_keys").insert({
      site_id: data.siteId, key_hash: hash, key_prefix: prefix, label: data.label ?? null,
    });
    if (error) throw new Error(error.message);
    return { apiKey: raw, prefix };
  });

export const grantAdminBootstrap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Bootstrap: if there are zero admins yet, the calling user becomes admin.
    const { count, error: cErr } = await supabaseAdmin
      .from("user_roles").select("*", { count: "exact", head: true }).eq("role", "admin");
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) > 0) {
      // Only existing admins can grant — return current state
      const { data: me } = await supabaseAdmin
        .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
      return { granted: false, isAdmin: !!me };
    }
    const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: context.userId, role: "admin" });
    if (error) throw new Error(error.message);
    return { granted: true, isAdmin: true };
  });

// Demo data seeder for first-time admins
export const seedDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: existing } = await supabaseAdmin.from("sites").select("id").limit(1);
    if (existing && existing.length > 0) return { seeded: false };
    const sitesToCreate = [
      { name: "North Bay Wash", location: "Manchester, UK" },
      { name: "Riverside Auto", location: "Bristol, UK" },
      { name: "City Centre Express", location: "London, UK" },
    ];
    for (const s of sitesToCreate) {
      const { data: site, error } = await supabaseAdmin.from("sites").insert(s).select("id").single();
      if (error) throw new Error(error.message);
      const meters = [
        { meter_type: "wash" as const, name: "Wash bay", unit: "count", device_key: "wash", position: 0, capacity: null, low_threshold: null },
        { meter_type: "fresh_water" as const, name: "Fresh water", unit: "L", device_key: "fresh", position: 1, capacity: null, low_threshold: null },
        { meter_type: "chemical" as const, name: "Soap", unit: "L", device_key: "chem1", position: 2, capacity: 200, low_threshold: 40 },
        { meter_type: "chemical" as const, name: "Wax", unit: "L", device_key: "chem2", position: 3, capacity: 100, low_threshold: 20 },
        { meter_type: "chemical" as const, name: "Foam", unit: "L", device_key: "chem3", position: 4, capacity: 150, low_threshold: 30 },
        { meter_type: "chemical" as const, name: "Pre-wash", unit: "L", device_key: "chem4", position: 5, capacity: 100, low_threshold: 20 },
        { meter_type: "chemical" as const, name: "Rinse aid", unit: "L", device_key: "chem5", position: 6, capacity: 80, low_threshold: 16 },
      ];
      const { data: insertedMeters, error: mErr } = await supabaseAdmin
        .from("site_meters")
        .insert(meters.map((m) => ({ ...m, site_id: site!.id })))
        .select("id,meter_type,device_key,capacity");
      if (mErr) throw new Error(mErr.message);

      // Seed 24h of readings
      const now = Date.now();
      const readings: any[] = [];
      for (const m of insertedMeters!) {
        if (m.meter_type === "chemical") {
          // single recent level
          readings.push({
            site_id: site!.id, meter_id: m.id,
            value: Math.max(5, (m.capacity ?? 100) * (0.2 + Math.random() * 0.7)),
            recorded_at: new Date(now - Math.random() * 60_000).toISOString(),
          });
        } else {
          for (let i = 0; i < 40; i++) {
            const t = now - Math.floor(Math.random() * 24 * 60 * 60_000);
            readings.push({
              site_id: site!.id, meter_id: m.id,
              value: m.meter_type === "wash" ? 1 : Number((Math.random() * 5).toFixed(2)),
              recorded_at: new Date(t).toISOString(),
            });
          }
        }
      }
      const { error: rErr } = await supabaseAdmin.from("readings").insert(readings);
      if (rErr) throw new Error(rErr.message);
    }
    return { seeded: true };
  });
