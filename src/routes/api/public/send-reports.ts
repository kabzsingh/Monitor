import { Router } from "itty-router";
import type { IRequest } from "itty-router";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  SENDGRID_API_KEY: string;
}

const router = Router<IRequest & { env: Env }>();

// Helper to convert to CSV
function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");
}

// Send email via SendGrid
async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  csvContent: string,
  filename: string
) {
  const base64Csv = Buffer.from(csvContent).toString("base64");

  const emailPayload = {
    personalizations: [
      {
        to: [{ email: to }],
        subject: subject,
      },
    ],
    from: {
      email: "noreply@washgrid.com",
      name: "WashGrid Reports",
    },
    content: [
      {
        type: "text/plain",
        value: `Your requested ${filename} report is attached.`,
      },
    ],
    attachments: [
      {
        content: base64Csv,
        type: "text/csv",
        filename: filename,
        disposition: "attachment",
      },
    ],
  };

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
    },
    body: JSON.stringify(emailPayload),
  });

  if (!response.ok) {
    throw new Error(`SendGrid error: ${response.statusText}`);
  }
}

// Generate CSV report for a site
async function generateReport(
  env: Env,
  siteId: string,
  period: "daily" | "monthly",
  dateStr: string
): Promise<{ csv: string; filename: string; siteName: string }> {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_KEY;

  // Get site info
  const siteRes = await fetch(`${supabaseUrl}/rest/v1/sites?id=eq.${siteId}`, {
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      apiKey: supabaseKey,
    },
  });
  const sites = (await siteRes.json()) as any[];
  if (!sites.length) throw new Error("Site not found");
  const site = sites[0];

  // Get meters
  const metersRes = await fetch(
    `${supabaseUrl}/rest/v1/site_meters?site_id=eq.${siteId}&order=position`,
    {
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        apiKey: supabaseKey,
      },
    }
  );
  const meters = (await metersRes.json()) as any[];
  if (!meters.length) throw new Error("No meters on this site");

  // Calculate date range
  let from: Date, to: Date;
  if (period === "daily") {
    from = new Date(`${dateStr}T00:00:00Z`);
    to = new Date(from);
    to.setDate(to.getDate() + 1);
  } else {
    const [y, m] = dateStr.split("-").map(Number);
    from = new Date(Date.UTC(y, m - 1, 1));
    to = new Date(Date.UTC(y, m, 1));
  }

  // Fetch readings
  const meterIds = meters.map((m: any) => m.id);
  const all: any[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const readingsRes = await fetch(
      `${supabaseUrl}/rest/v1/readings?meter_id=in.(${meterIds.map((id: string) => `"${id}"`).join(",")})&recorded_at=gte.${from.toISOString()}&recorded_at=lt.${to.toISOString()}&order=recorded_at.asc&limit=${PAGE}&offset=${offset}`,
      {
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          apiKey: supabaseKey,
        },
      }
    );
    const rows = (await readingsRes.json()) as any[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  // Build buckets
  const buckets = new Map<string, Map<string, number>>();
  const meterById = new Map(meters.map((m: any) => [m.id, m]));

  const bucketKey = (iso: string) => {
    const d = new Date(iso);
    if (period === "daily") {
      return `${String(d.getUTCHours()).padStart(2, "0")}:00`;
    }
    return d.toISOString().slice(0, 10);
  };

  for (const r of all) {
    const k = bucketKey(r.recorded_at);
    if (!buckets.has(k)) buckets.set(k, new Map());
    const inner = buckets.get(k)!;
    const m = meterById.get(r.meter_id);
    if (!m) continue;
    if (m.meter_type === "chemical") {
      inner.set(r.meter_id, r.value);
    } else {
      inner.set(r.meter_id, (inner.get(r.meter_id) ?? 0) + r.value);
    }
  }

  // Sorted bucket keys
  let keys: string[];
  if (period === "daily") {
    keys = Array.from({ length: 24 }, (_, i) =>
      `${String(i).padStart(2, "0")}:00`
    );
  } else {
    keys = [];
    const cur = new Date(from);
    while (cur < to) {
      keys.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Build CSV
  const header = [
    period === "daily" ? "Hour" : "Date",
    ...meters.map((m: any) => `${m.name} (${m.unit || m.meter_type})`),
  ];

  const rows: (string | number)[][] = [header];
  for (const k of keys) {
    const inner = buckets.get(k);
    const row: (string | number)[] = [k];
    for (const m of meters) {
      const v = inner?.get(m.id);
      row.push(v === undefined ? "" : Number(v.toFixed(3)));
    }
    rows.push(row);
  }

  // Totals row
  const totals: (string | number)[] = ["Total"];
  for (const m of meters) {
    if (m.meter_type === "chemical") {
      totals.push("");
      continue;
    }
    let sum = 0;
    for (const k of keys) {
      const v = buckets.get(k)?.get(m.id);
      if (typeof v === "number") sum += v;
    }
    totals.push(Number(sum.toFixed(3)));
  }
  rows.push(totals);

  const safeName = site.name.replace(/[^a-z0-9]+/gi, "_");
  const filename = `${safeName}_${period}_${dateStr}.csv`;
  const csv = toCsv(rows);

  return { csv, filename, siteName: site.name };
}

// Send daily reports at 6 AM UTC
router.post("/send-daily-reports", async (req, env) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Get all sites with email subscriptions
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_KEY;

    const subsRes = await fetch(
      `${supabaseUrl}/rest/v1/email_subscriptions?period=eq.daily&active=eq.true`,
      {
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          apiKey: supabaseKey,
        },
      }
    );
    const subscriptions = (await subsRes.json()) as any[];

    for (const sub of subscriptions) {
      try {
        const { csv, filename } = await generateReport(
          env,
          sub.site_id,
          "daily",
          today
        );
        await sendEmail(
          env,
          sub.email,
          `Daily Report - ${today}`,
          csv,
          filename
        );
      } catch (e) {
        console.error(`Failed to send report for ${sub.email}:`, e);
      }
    }

    return new Response(JSON.stringify({ success: true, sent: subscriptions.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// Send monthly reports on first day of month at 6 AM UTC
router.post("/send-monthly-reports", async (req, env) => {
  try {
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const monthStr = lastMonth.toISOString().slice(0, 7);

    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_KEY;

    const subsRes = await fetch(
      `${supabaseUrl}/rest/v1/email_subscriptions?period=eq.monthly&active=eq.true`,
      {
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          apiKey: supabaseKey,
        },
      }
    );
    const subscriptions = (await subsRes.json()) as any[];

    for (const sub of subscriptions) {
      try {
        const { csv, filename } = await generateReport(
          env,
          sub.site_id,
          "monthly",
          monthStr
        );
        await sendEmail(
          env,
          sub.email,
          `Monthly Report - ${monthStr}`,
          csv,
          filename
        );
      } catch (e) {
        console.error(`Failed to send report for ${sub.email}:`, e);
      }
    }

    return new Response(JSON.stringify({ success: true, sent: subscriptions.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

export default router;
