import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error) {
    console.error("Admin check error:", error);
    throw new Error(`Admin check failed: ${error.message}`);
  }
  if (!data) {
    console.warn(`User ${userId} attempted admin action without permission`);
    throw new Error("Forbidden: Admin access required");
  }
}

/**
 * Helper to generate a SHA-256 hash using the Web Crypto API
 */
async function sha256(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Generate a new site API key for ESP32 use. Returns plaintext ONCE.
export const createSiteApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .input(
    z.object({
      siteId: z.string(),
      label: z.string().max(60).optional(),
    })
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { siteId, label } = data;

    console.log(`[Admin] Generating API key for site: ${siteId}`);

    try {
      // Generate 24 random bytes for a strong key
      const bytes = new Uint8Array(24);
      globalThis.crypto.getRandomValues(bytes);

      // Convert to hex string
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const rawKey = "ws_live_" + hex;

      // Compute hash for secure storage
      const hashedKey = await sha256(rawKey);

      // First 12 characters are used for identification in the UI (non-secret part)
      const displayPrefix = rawKey.slice(0, 12);

      const { error: dbError } = await supabaseAdmin.from("site_api_keys").insert({
        site_id: siteId,
        key_hash: hashedKey,
        key_prefix: displayPrefix,
        label: label || "ESP32",
      });

      if (dbError) {
        console.error("[Admin] Database error inserting API key:", dbError);
        throw new Error(`Database error: ${dbError.message}`);
      }

      console.log(`[Admin] Successfully generated API key for site: ${siteId}`);
      return { apiKey: rawKey, prefix: displayPrefix };
    } catch (err: any) {
      console.error("[Admin] Critical failure in createSiteApiKey:", err);
      throw new Error(err.message || "An unexpected error occurred generating the API key");
    }
  });

export const getSmtpSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin.from("smtp_settings").select("*").eq("id", true).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const updateSmtpSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .input(
    z.object({
      host: z.string(),
      port: z.number(),
      user_email: z.string().email(),
      password: z.string(),
      from_name: z.string(),
      from_email: z.string().email(),
      encryption: z.enum(["tls", "ssl", "none"]),
    })
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("smtp_settings").upsert({
      id: true,
      ...data,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const grantAdminBootstrap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count, error: cErr } = await supabaseAdmin
      .from("user_roles").select("*", { count: "exact", head: true }).eq("role", "admin");
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) > 0) {
      const { data: me } = await supabaseAdmin
        .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
      return { granted: false, isAdmin: !!me };
    }
    const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: context.userId, role: "admin" });
    if (error) throw new Error(error.message);
    return { granted: true, isAdmin: true };
  });

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

      const now = Date.now();
      const readings: any[] = [];
      for (const m of insertedMeters!) {
        if (m.meter_type === "chemical") {
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
