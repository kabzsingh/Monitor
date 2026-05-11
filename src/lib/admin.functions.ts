import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message || "Admin check failed");
  if (!data) throw new Error("Forbidden: Admin access required");
}

export const createSiteApiKey = createServerFn({ method: "POST" })
  .validator((data: any) => z.object({
    siteId: z.string(),
    label: z.string().max(60).optional()
  }).parse(data))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { siteId, label } = data;

    try {
      const bytes = new Uint8Array(24);
      // Use globalThis.crypto for broad environment compatibility
      if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
      } else {
        // Fallback for older environments
        for (let i = 0; i < 24; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const raw = "ws_live_" + hex;

      // SHA-256 hash using Web Crypto API
      const msgUint8 = new TextEncoder().encode(raw);
      const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      const prefix = raw.slice(0, 12);

      const { error: insertErr } = await supabaseAdmin.from("site_api_keys").insert({
        site_id: siteId,
        key_hash: hash,
        key_prefix: prefix,
        label: label || "ESP32",
      });

      if (insertErr) throw new Error(insertErr.message);
      return { apiKey: raw, prefix };
    } catch (err: any) {
      throw new Error(err.message || "Failed to generate key");
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
  .validator((data: any) => z.object({
    host: z.string(),
    port: z.number(),
    user_email: z.string().email(),
    password: z.string(),
    from_name: z.string(),
    from_email: z.string().email(),
    encryption: z.enum(["tls", "ssl", "none"]),
  }).parse(data))
  .middleware([requireSupabaseAuth])
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
    ];

    for (const s of sitesToCreate) {
      const { data: site, error } = await supabaseAdmin.from("sites").insert(s).select("id").single();
      if (error) throw new Error(error.message);

      const meters = [
        { meter_type: "wash" as const, name: "Wash bay", unit: "count", device_key: "wash", position: 0, capacity: null, low_threshold: null },
        { meter_type: "chemical" as const, name: "Soap", unit: "L", device_key: "chem1", position: 2, capacity: 200, low_threshold: 40 },
      ];

      const { data: insertedMeters, error: mErr } = await supabaseAdmin
        .from("site_meters")
        .insert(meters.map((m) => ({ ...m, site_id: site!.id })))
        .select("id");
      if (mErr) throw new Error(mErr.message);
    }
    return { seeded: true };
  });
