import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

type AuthSupabase = SupabaseClient<Database>;

async function assertAdmin(supabase: AuthSupabase, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error) throw new Error(error.message || "Admin check failed");
  if (!data) throw new Response("Forbidden", { status: 403 });
}

async function sha256(message: string) {
  const msgUint8 = new TextEncoder().encode(message);
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) {
    throw new Error("Web Crypto Subtle API is not available.");
  }
  const hashBuffer = await cryptoObj.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

type BootstrapResult = { granted: boolean; is_admin: boolean };

async function bootstrapViaRpc(supabase: AuthSupabase): Promise<{ granted: boolean; isAdmin: boolean }> {
  const { data, error } = await supabase.rpc("bootstrap_first_admin");
  if (error) throw error;
  const row = data as BootstrapResult | null;
  return { granted: row?.granted ?? false, isAdmin: row?.is_admin ?? false };
}

/** Fallback when migration not applied yet — needs SUPABASE_SERVICE_ROLE_KEY in env. */
async function bootstrapViaServiceRole(userId: string): Promise<{ granted: boolean; isAdmin: boolean }> {
  const { count, error: cErr } = await supabaseAdmin
    .from("user_roles")
    .select("*", { count: "exact", head: true })
    .eq("role", "admin");
  if (cErr) throw new Error(cErr.message);

  if ((count ?? 0) > 0) {
    const { data: me } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    return { granted: false, isAdmin: !!me };
  }

  const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "admin" });
  if (error) throw new Error(error.message);
  return { granted: true, isAdmin: true };
}

export const createSiteApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const parsed = z
      .object({
        siteId: z.string(),
        label: z.string().max(60).optional(),
      })
      .parse(data);

    await assertAdmin(context.supabase, context.userId);
    const { siteId, label } = parsed;

    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const raw = "ws_live_" + hex;
    const hash = await sha256(raw);
    const prefix = raw.slice(0, 12);

    const { error: insertErr } = await context.supabase.from("site_api_keys").insert({
      site_id: siteId,
      key_hash: hash,
      key_prefix: prefix,
      label: label || "ESP32",
    });

    if (insertErr) throw new Error(insertErr.message);
    return { apiKey: raw, prefix };
  });

export const getSmtpSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase.from("smtp_settings").select("*").eq("id", true).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const updateSmtpSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const parsed = z
      .object({
        host: z.string(),
        port: z.number(),
        user_email: z.string().email(),
        password: z.string(),
        from_name: z.string(),
        from_email: z.string().email(),
        encryption: z.enum(["tls", "ssl", "none"]),
      })
      .parse(data);

    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("smtp_settings").upsert({
      id: true,
      ...parsed,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const grantAdminBootstrap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await bootstrapViaServiceRole(context.userId);
    } catch (svcErr: unknown) {
      const svcMsg = svcErr instanceof Error ? svcErr.message : String(svcErr);
      if (svcMsg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
        return await bootstrapViaRpc(context.supabase);
      }
      throw svcErr;
    }
  });

export const seedDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: existing } = await context.supabase.from("sites").select("id").limit(1);
    if (existing && existing.length > 0) return { seeded: false };

    const sitesToCreate = [
      { name: "North Bay Wash", location: "Manchester, UK" },
      { name: "Riverside Auto", location: "Bristol, UK" },
    ];

    for (const s of sitesToCreate) {
      const { data: site, error } = await context.supabase.from("sites").insert(s).select("id").single();
      if (error) throw new Error(error.message);

      const meters = [
        {
          meter_type: "wash" as const,
          name: "Wash bay",
          unit: "count",
          device_key: "wash",
          position: 0,
          capacity: null,
          low_threshold: null,
        },
        {
          meter_type: "chemical" as const,
          name: "Soap",
          unit: "L",
          device_key: "chem1",
          position: 2,
          capacity: 200,
          low_threshold: 40,
        },
      ];

      const { error: mErr } = await context.supabase
        .from("site_meters")
        .insert(meters.map((m) => ({ ...m, site_id: site!.id })));
      if (mErr) throw new Error(mErr.message);
    }
    return { seeded: true };
  });
