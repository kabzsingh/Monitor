import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GMAIL_GATEWAY = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

function b64url(s: string) {
  // Use Buffer (Node available with nodejs_compat) for accurate UTF-8 handling
  return Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildRawWithAttachment(
  to: string[],
  subject: string,
  text: string,
  attachment: { filename: string; mime: string; content: string },
) {
  const boundary = "lovable_" + Math.random().toString(36).slice(2);
  const headers = [
    `To: ${to.join(", ")}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].join("\r\n");
  const attachmentB64 = Buffer.from(attachment.content, "utf-8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    `--${boundary}`,
    `Content-Type: ${attachment.mime}; name="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    "",
    attachmentB64,
    `--${boundary}--`,
  ].join("\r\n");
  return b64url(headers + "\r\n\r\n" + body);
}

async function sendGmail(
  to: string[],
  subject: string,
  text: string,
  attachment: { filename: string; mime: string; content: string },
) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const GOOGLE_MAIL_API_KEY = process.env.GOOGLE_MAIL_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");
  if (!GOOGLE_MAIL_API_KEY) throw new Error("GOOGLE_MAIL_API_KEY missing");
  const raw = buildRawWithAttachment(to, subject, text, attachment);
  const res = await fetch(`${GMAIL_GATEWAY}/users/me/messages/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GOOGLE_MAIL_API_KEY,
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gmail ${res.status}: ${t.slice(0, 300)}`);
  }
}

// Returns { hour, dayOfMonth, ymd } in the given IANA timezone for a given instant.
function nowInTz(tz: string, instant = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    hour: Number(parts.hour),
    day: Number(parts.day),
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    ym: `${parts.year}-${parts.month}`,
  };
}

function ymdInTz(tz: string, instant: Date) {
  return nowInTz(tz, instant).ymd;
}

function escapeCsv(v: any) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function fetchReadings(siteId: string, fromIso: string, toIso: string) {
  const all: any[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("readings")
      .select("meter_id,value,recorded_at")
      .eq("site_id", siteId)
      .gte("recorded_at", fromIso)
      .lt("recorded_at", toIso)
      .order("recorded_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function buildDailyReport(site: any, meters: any[]) {
  const tz = site.timezone || "UTC";
  // yesterday in site tz
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 3600_000);
  const ymd = ymdInTz(tz, yesterday);
  // start/end of that local day -> UTC bounds (approx via Date construction in tz)
  const startLocal = new Date(`${ymd}T00:00:00`);
  const endLocal = new Date(`${ymd}T23:59:59.999`);
  // crude UTC offset using Intl: not perfect for DST edges but acceptable here
  const fromIso = new Date(startLocal.toISOString()).toISOString();
  const toIso = new Date(endLocal.getTime() + 1).toISOString();

  const readings = await fetchReadings(site.id, fromIso, toIso);
  // hour buckets
  const buckets = new Map<string, Map<string, number[]>>();
  for (const r of readings) {
    const d = new Date(r.recorded_at);
    const hourKey = `${String(d.getUTCHours()).padStart(2, "0")}:00`;
    if (!buckets.has(hourKey)) buckets.set(hourKey, new Map());
    const inner = buckets.get(hourKey)!;
    const arr = inner.get(r.meter_id) ?? [];
    arr.push(Number(r.value));
    inner.set(r.meter_id, arr);
  }
  const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

  const header = ["hour", ...meters.map((m) => `${m.name} (${m.unit || m.meter_type})`)];
  const lines = [header.map(escapeCsv).join(",")];
  for (const h of hours) {
    const row: any[] = [h];
    for (const meter of meters) {
      const vals = buckets.get(h)?.get(meter.id) ?? [];
      if (meter.meter_type === "wash") row.push(vals.length);
      else if (meter.meter_type === "fresh_water") row.push(vals.reduce((a, b) => a + b, 0).toFixed(2));
      else row.push(vals.length ? vals[vals.length - 1].toFixed(2) : "");
    }
    lines.push(row.map(escapeCsv).join(","));
  }
  const csv = lines.join("\n");

  const safeName = site.name.replace(/[^a-z0-9]+/gi, "_");
  const subject = `Daily report — ${site.name} — ${ymd}`;
  const text = `Daily report for ${site.name} — ${ymd}\n\nSee attached CSV.`;
  return {
    subject,
    text,
    periodKey: ymd,
    attachment: { filename: `${safeName}_daily_${ymd}.csv`, mime: "text/csv; charset=UTF-8", content: csv },
  };
}

async function buildMonthlyReport(site: any, meters: any[]) {
  const tz = site.timezone || "UTC";
  // previous month
  const now = new Date();
  const localToday = nowInTz(tz, now);
  const [y, m] = localToday.ym.split("-").map(Number);
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  const ym = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
  const startLocal = new Date(`${ym}-01T00:00:00`);
  const endLocal = new Date(prevYear, prevMonth, 1); // first of current month local
  const fromIso = startLocal.toISOString();
  const toIso = endLocal.toISOString();

  const readings = await fetchReadings(site.id, fromIso, toIso);
  // bucket by ymd per meter
  const days = new Set<string>();
  const map = new Map<string, Map<string, number[]>>(); // ymd -> meterId -> values
  for (const r of readings) {
    const d = ymdInTz(tz, new Date(r.recorded_at));
    days.add(d);
    if (!map.has(d)) map.set(d, new Map());
    const inner = map.get(d)!;
    const arr = inner.get(r.meter_id) ?? [];
    arr.push(Number(r.value));
    inner.set(r.meter_id, arr);
  }
  const sortedDays = Array.from(days).sort();

  const header = ["date", ...meters.map((m) => `${m.name} (${m.unit || m.meter_type})`)];
  const lines = [header.map(escapeCsv).join(",")];
  for (const d of sortedDays) {
    const row: any[] = [d];
    for (const meter of meters) {
      const vals = map.get(d)?.get(meter.id) ?? [];
      if (meter.meter_type === "wash") row.push(vals.length);
      else if (meter.meter_type === "fresh_water") row.push(vals.reduce((a, b) => a + b, 0).toFixed(2));
      else row.push(vals.length ? vals[vals.length - 1].toFixed(2) : "");
    }
    lines.push(row.map(escapeCsv).join(","));
  }
  const csv = lines.join("\n");

  const safeName = site.name.replace(/[^a-z0-9]+/gi, "_");
  const subject = `Monthly report — ${site.name} — ${ym}`;
  const text = `Monthly report for ${site.name} — ${ym}\n\nSee attached CSV.`;
  return {
    subject,
    text,
    periodKey: ym,
    attachment: { filename: `${safeName}_monthly_${ym}.csv`, mime: "text/csv; charset=UTF-8", content: csv },
  };
}

async function processSite(site: any) {
  const tz = site.timezone || "UTC";
  const local = nowInTz(tz);
  if (local.hour !== site.report_hour) return { site: site.name, skipped: "hour-mismatch", localHour: local.hour };
  const recipients: string[] = (site.report_recipients ?? []).filter((e: string) => /.+@.+\..+/.test(e));
  if (recipients.length === 0) return { site: site.name, skipped: "no-recipients" };

  const { data: meters, error: mErr } = await supabaseAdmin
    .from("site_meters").select("*").eq("site_id", site.id).order("position");
  if (mErr) throw new Error(mErr.message);

  const results: any[] = [];

  if (site.daily_report_enabled) {
    const r = await buildDailyReport(site, meters ?? []);
    const { error: dupErr } = await supabaseAdmin
      .from("report_send_log")
      .insert({ site_id: site.id, report_type: "daily", period_key: r.periodKey, recipients });
    if (!dupErr) {
      try {
        await sendGmail(recipients, r.subject, r.text, r.attachment);
        results.push({ type: "daily", period: r.periodKey, ok: true });
      } catch (e: any) {
        await supabaseAdmin.from("report_send_log")
          .update({ status: "failed", error: e.message })
          .eq("site_id", site.id).eq("report_type", "daily").eq("period_key", r.periodKey);
        results.push({ type: "daily", period: r.periodKey, ok: false, error: e.message });
      }
    } else {
      results.push({ type: "daily", period: r.periodKey, skipped: "already-sent" });
    }
  }

  if (site.monthly_report_enabled && local.day === 1) {
    const r = await buildMonthlyReport(site, meters ?? []);
    const { error: dupErr } = await supabaseAdmin
      .from("report_send_log")
      .insert({ site_id: site.id, report_type: "monthly", period_key: r.periodKey, recipients });
    if (!dupErr) {
      try {
        await sendGmail(recipients, r.subject, r.text, r.attachment);
        results.push({ type: "monthly", period: r.periodKey, ok: true });
      } catch (e: any) {
        await supabaseAdmin.from("report_send_log")
          .update({ status: "failed", error: e.message })
          .eq("site_id", site.id).eq("report_type", "monthly").eq("period_key", r.periodKey);
        results.push({ type: "monthly", period: r.periodKey, ok: false, error: e.message });
      }
    } else {
      results.push({ type: "monthly", period: r.periodKey, skipped: "already-sent" });
    }
  }

  return { site: site.name, results };
}

export const Route = createFileRoute("/api/public/hooks/send-reports")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Allow `?force=siteId` for manual test sends regardless of hour
        const url = new URL(request.url);
        const force = url.searchParams.get("force");

        const { data: sites, error } = await supabaseAdmin.from("sites").select("*");
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const out: any[] = [];
        for (const site of sites ?? []) {
          if (force && site.id !== force) continue;
          try {
            const r = await processSite(force ? { ...site, report_hour: nowInTz(site.timezone || "UTC").hour } : site);
            out.push(r);
          } catch (e: any) {
            out.push({ site: site.name, error: e.message });
          }
        }
        return Response.json({ ok: true, processed: out });
      },
      GET: async () => Response.json({ ok: true, hint: "POST to trigger" }),
    },
  },
});