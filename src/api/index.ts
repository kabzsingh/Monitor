import { getSupabase, getSupabaseAdmin, type Env } from "../lib/supabase";
import {
  getSites, getSiteById, createSite, updateSite, deleteSite,
  getMetersForSite, createMeter, updateMeter, deleteMeter,
  getApiKeyByHash, getApiKeysForSite, createApiKey, deleteApiKey,
  insertReading, getReadingsForSite, getLatestReading,
  getSmtpSettings, upsertSmtpSettings,
  logReport, getReportLog,
} from "../lib/db";
import crypto from "crypto";

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  try {
    // ── ESP32: Submit a reading ─────────────────────────
    // POST /api/readings
    if (path === "/api/readings" && method === "POST") {
      const apiKey = request.headers.get("X-API-Key") || request.headers.get("x-site-api-key");
      if (!apiKey) return json({ error: "Missing API key" }, 401);

      const admin = getSupabaseAdmin(env);
      const hash = crypto.createHash("sha256").update(apiKey).digest("hex");

      let keyData;
      try {
        keyData = await getApiKeyByHash(admin, hash);
      } catch (e) {
        return json({ error: "Invalid API key" }, 403);
      }

      if (!keyData || keyData.revoked) return json({ error: "Invalid API key" }, 403);

      const body = await request.json();
      const reading = await insertReading(admin, {
        site_id: keyData.site_id,
        ...body,
      });
      return json(reading, 201);
    }

    // ── Sites ───────────────────────────────────────────
    // GET /api/sites
    if (path === "/api/sites" && method === "GET") {
      const db = getSupabase(env);
      const sites = await getSites(db);
      return json(sites);
    }

    // POST /api/sites
    if (path === "/api/sites" && method === "POST") {
      const db = getSupabaseAdmin(env);
      const body = await request.json();
      const site = await createSite(db, body);
      return json(site, 201);
    }

    // GET /api/sites/:id
    const siteMatch = path.match(/^\/api\/sites\/([^/]+)$/);
    if (siteMatch && method === "GET") {
      const db = getSupabase(env);
      const site = await getSiteById(db, siteMatch[1]);
      return json(site);
    }

    // PUT /api/sites/:id
    if (siteMatch && method === "PUT") {
      const db = getSupabaseAdmin(env);
      const body = await request.json();
      const site = await updateSite(db, siteMatch[1], body);
      return json(site);
    }

    // DELETE /api/sites/:id
    if (siteMatch && method === "DELETE") {
      const db = getSupabaseAdmin(env);
      await deleteSite(db, siteMatch[1]);
      return json({ success: true });
    }

    // ── Meters ──────────────────────────────────────────
    // GET /api/sites/:id/meters
    const metersMatch = path.match(/^\/api\/sites\/([^/]+)\/meters$/);
    if (metersMatch && method === "GET") {
      const db = getSupabase(env);
      const meters = await getMetersForSite(db, metersMatch[1]);
      return json(meters);
    }

    // POST /api/sites/:id/meters
    if (metersMatch && method === "POST") {
      const db = getSupabaseAdmin(env);
      const body = await request.json();
      const meter = await createMeter(db, { site_id: metersMatch[1], ...body });
      return json(meter, 201);
    }

    // PUT /api/meters/:id
    const meterUpdateMatch = path.match(/^\/api\/meters\/([^/]+)$/);
    if (meterUpdateMatch && method === "PUT") {
      const db = getSupabaseAdmin(env);
      const body = await request.json();
      const meter = await updateMeter(db, meterUpdateMatch[1], body);
      return json(meter);
    }

    // DELETE /api/meters/:id
    if (meterUpdateMatch && method === "DELETE") {
      const db = getSupabaseAdmin(env);
      await deleteMeter(db, meterUpdateMatch[1]);
      return json({ success: true });
    }

    // ── API Keys ────────────────────────────────────────
    // GET /api/sites/:id/keys
    const keysMatch = path.match(/^\/api\/sites\/([^/]+)\/keys$/);
    if (keysMatch && method === "GET") {
      const db = getSupabase(env);
      const keys = await getApiKeysForSite(db, keysMatch[1]);
      return json(keys);
    }

    // POST /api/sites/:id/keys
    if (keysMatch && method === "POST") {
      const db = getSupabaseAdmin(env);
      const body = await request.json();
      const key = await createApiKey(db, { site_id: keysMatch[1], ...body });
      return json(key, 201);
    }

    // DELETE /api/keys/:id
    const keyDeleteMatch = path.match(/^\/api\/keys\/([^/]+)$/);
    if (keyDeleteMatch && method === "DELETE") {
      const db = getSupabaseAdmin(env);
      await deleteApiKey(db, keyDeleteMatch[1]);
      return json({ success: true });
    }

    // ── Readings ────────────────────────────────────────
    // GET /api/sites/:id/readings
    const readingsMatch = path.match(/^\/api\/sites\/([^/]+)\/readings$/);
    if (readingsMatch && method === "GET") {
      const db = getSupabase(env);
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const limit = url.searchParams.get("limit");
      const readings = await getReadingsForSite(db, readingsMatch[1], {
        from: from || undefined,
        to: to || undefined,
        limit: limit ? parseInt(limit) : undefined,
      });
      return json(readings);
    }

    // GET /api/sites/:id/readings/latest
    const latestMatch = path.match(/^\/api\/sites\/([^/]+)\/readings\/latest$/);
    if (latestMatch && method === "GET") {
      const db = getSupabase(env);
      const reading = await getLatestReading(db, latestMatch[1]);
      return json(reading);
    }

    // ── SMTP Settings ───────────────────────────────────
    // GET /api/smtp
    if (path === "/api/smtp" && method === "GET") {
      const db = getSupabase(env);
      const settings = await getSmtpSettings(db);
      return json(settings);
    }

    // PUT /api/smtp
    if (path === "/api/smtp" && method === "PUT") {
      const db = getSupabaseAdmin(env);
      const body = await request.json();
      const settings = await upsertSmtpSettings(db, body);
      return json(settings);
    }

    // ── Report Send Log ─────────────────────────────────
    // GET /api/sites/:id/reports
    const reportsMatch = path.match(/^\/api\/sites\/([^/]+)\/reports$/);
    if (reportsMatch && method === "GET") {
      const db = getSupabase(env);
      const limit = url.searchParams.get("limit");
      const logs = await getReportLog(db, reportsMatch[1], limit ? parseInt(limit) : 50);
      return json(logs);
    }

    // POST /api/sites/:id/reports
    if (reportsMatch && method === "POST") {
      const db = getSupabaseAdmin(env);
      const body = await request.json();
      const log = await logReport(db, { site_id: reportsMatch[1], ...body });
      return json(log, 201);
    }

    return json({ error: "Not found" }, 404);
  } catch (err: any) {
    return json({ error: err.message || "Internal server error" }, 500);
  }
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
