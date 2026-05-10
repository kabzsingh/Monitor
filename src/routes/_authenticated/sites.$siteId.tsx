import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Activity, Droplets, FlaskConical, Gauge, Pencil } from "lucide-react";
import { StatCard } from "@/components/app/StatCard";
import { MeterCard } from "@/components/app/MeterCard";
import { ChemicalGauge } from "@/components/app/ChemicalGauge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_authenticated/sites/$siteId")({
  component: SiteDetail,
});

interface Meter {
  id: string;
  meter_type: "wash" | "fresh_water" | "chemical" | "chemical_flow";
  name: string;
  unit: string;
  capacity: number | null;
  low_threshold: number | null;
  device_key: string;
  chemical_group: string | null;
}
interface Reading {
  meter_id: string;
  value: number;
  recorded_at: string;
}

function SiteDetail() {
  const { siteId } = Route.useParams();
  const [site, setSite] = useState<{
    name: string;
    location: string | null;
  } | null>(null);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);

  const load = async () => {
    const [{ data: s }, { data: m }] = await Promise.all([
      supabase
        .from("sites")
        .select("name,location")
        .eq("id", siteId)
        .single(),
      supabase
        .from("site_meters")
        .select(
          "id,meter_type,name,unit,capacity,low_threshold,device_key,position,chemical_group"
        )
        .eq("site_id", siteId)
        .order("position"),
    ]);
    setSite(s as any);
    setMeters((m as any) ?? []);
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const { data: r } = await supabase
      .from("readings")
      .select("meter_id,value,recorded_at")
      .eq("site_id", siteId)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true })
      .limit(5000);
    setReadings((r as any) ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`site-${siteId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "readings",
          filter: `site_id=eq.${siteId}`,
        },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  const stats = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    let washToday = 0,
      washLifetime = 0,
      freshToday = 0,
      freshLifetime = 0;
    const latestByMeter = new Map<string, Reading>();
    for (const r of readings) {
      const meter = meters.find((m) => m.id === r.meter_id);
      if (!meter) continue;
      const ts = new Date(r.recorded_at).getTime();
      if (meter.meter_type === "wash") {
        washLifetime += Number(r.value);
        if (ts >= startMs) washToday += Number(r.value);
      } else if (meter.meter_type === "fresh_water") {
        freshLifetime += Number(r.value);
        if (ts >= startMs) freshToday += Number(r.value);
      } else if (meter.meter_type === "chemical" || meter.meter_type === "chemical_flow") {
        const prev = latestByMeter.get(r.meter_id);
        if (!prev || prev.recorded_at < r.recorded_at)
          latestByMeter.set(r.meter_id, r);
      }
    }
    return {
      washToday,
      washLifetime,
      freshToday,
      freshLifetime,
      latestByMeter,
    };
  }, [readings, meters]);

  const chemicalLevelMeters = meters.filter((m) => m.meter_type === "chemical");
  const chemicalFlowMeters = meters.filter((m) => m.meter_type === "chemical_flow");
  const washMeters = meters.filter((m) => m.meter_type === "wash");
  const freshMeters = meters.filter((m) => m.meter_type === "fresh_water");

  // Group chemicals by chemical_group label so a level + flow meter render side-by-side.
  const chemicalGroups = useMemo(() => {
    const groups = new Map<string, { label: string; level?: Meter; flow?: Meter }>();
    const push = (key: string, label: string, m: Meter) => {
      const g = groups.get(key) ?? { label };
      if (m.meter_type === "chemical") g.level = m;
      else if (m.meter_type === "chemical_flow") g.flow = m;
      groups.set(key, g);
    };
    for (const m of chemicalLevelMeters) push(m.chemical_group || `lvl:${m.id}`, m.chemical_group || m.name, m);
    for (const m of chemicalFlowMeters) push(m.chemical_group || `flw:${m.id}`, m.chemical_group || m.name, m);
    return Array.from(groups.values());
  }, [chemicalLevelMeters, chemicalFlowMeters]);

  // Hourly wash chart for last 24h
  const washChart = useMemo(() => {
    const buckets: Record<string, number> = {};
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 60 * 60_000);
      d.setMinutes(0, 0, 0);
      buckets[d.toISOString()] = 0;
    }
    const washIds = new Set(washMeters.map((m) => m.id));
    for (const r of readings) {
      if (!washIds.has(r.meter_id)) continue;
      const d = new Date(r.recorded_at);
      d.setMinutes(0, 0, 0);
      const k = d.toISOString();
      if (k in buckets) buckets[k] += Number(r.value);
    }
    return Object.entries(buckets).map(([k, v]) => ({
      time: new Date(k).toLocaleTimeString([], { hour: "2-digit" }),
      washes: v,
    }));
  }, [readings, washMeters]);

  const freshChart = useMemo(() => {
    const buckets: Record<string, number> = {};
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 60 * 60_000);
      d.setMinutes(0, 0, 0);
      buckets[d.toISOString()] = 0;
    }
    const ids = new Set(freshMeters.map((m) => m.id));
    for (const r of readings) {
      if (!ids.has(r.meter_id)) continue;
      const d = new Date(r.recorded_at);
      d.setMinutes(0, 0, 0);
      const k = d.toISOString();
      if (k in buckets) buckets[k] += Number(r.value);
    }
    return Object.entries(buckets).map(([k, v]) => ({
      time: new Date(k).toLocaleTimeString([], { hour: "2-digit" }),
      liters: v,
    }));
  }, [readings, freshMeters]);

  if (!site) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/dashboard">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {site.name}
            </h1>
            {site.location && (
              <p className="text-xs text-muted-foreground">{site.location}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={Gauge}
          label="Wash today"
          value={stats.washToday.toLocaleString()}
        />
        <StatCard
          icon={Activity}
          label="Wash lifetime"
          value={stats.washLifetime.toLocaleString()}
          sub="Last 24h shown"
        />
        <StatCard
          icon={Droplets}
          label="Fresh water today"
          value={`${stats.freshToday.toFixed(1)} L`}
        />
        <StatCard
          icon={FlaskConical}
          label="Chemicals low"
          tone={chemicalLevelMeters.some((m) => {
            const last = stats.latestByMeter.get(m.id);
            return (
              last &&
              m.low_threshold !== null &&
              Number(last.value) <= Number(m.low_threshold)
            );
          })
            ? "danger"
            : "success"}
          value={`${chemicalLevelMeters.filter((m) => {
            const last = stats.latestByMeter.get(m.id);
            return (
              last &&
              m.low_threshold !== null &&
              Number(last.value) <= Number(m.low_threshold)
            );
          }).length} / ${chemicalLevelMeters.length}`}
        />
      </div>

      {/* Water Meters Display */}
      {washMeters.length > 0 || freshMeters.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold mb-4">Water Meters</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {washMeters.map((m) => {
              const last = stats.latestByMeter.get(m.id);
              return (
                <div key={m.id} className="space-y-2">
                  <MeterCard
                    name={m.name}
                    meterType="wash"
                    value={last ? Number(last.value) : 0}
                    unit={m.unit}
                    capacity={m.capacity}
                    lowThreshold={m.low_threshold}
                  />
                  <AdminAdjust meterId={m.id} siteId={siteId} unit={m.unit} onSaved={load} />
                </div>
              );
            })}
            {freshMeters.map((m) => {
              const last = stats.latestByMeter.get(m.id);
              return (
                <div key={m.id} className="space-y-2">
                  <MeterCard
                    name={m.name}
                    meterType="fresh_water"
                    value={last ? Number(last.value) : 0}
                    unit={m.unit}
                    capacity={m.capacity}
                    lowThreshold={m.low_threshold}
                  />
                  <AdminAdjust meterId={m.id} siteId={siteId} unit={m.unit} onSaved={load} />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Wash count (last 24h)"
          data={washChart}
          dataKey="washes"
          stroke="var(--color-chart-1)"
        />
        <ChartCard
          title="Fresh water L (last 24h)"
          data={freshChart}
          dataKey="liters"
          stroke="var(--color-chart-2)"
        />
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
          Chemical levels
        </h2>
        {chemicalGroups.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No chemical meters configured.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {chemicalGroups.map((g, i) => {
              const lvl = g.level;
              const flw = g.flow;
              const lvlLast = lvl ? stats.latestByMeter.get(lvl.id) : undefined;
              const flwLast = flw ? stats.latestByMeter.get(flw.id) : undefined;
              return (
                <div key={i} className="rounded-xl border border-border bg-card p-4 shadow-card space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm">{g.label}</h3>
                    <FlaskConical className="h-4 w-4 text-purple-500" />
                  </div>
                  {lvl ? (
                    <ChemicalGauge
                      name={`Level — ${lvl.name}`}
                      value={lvlLast ? Number(lvlLast.value) : 0}
                      capacity={lvl.capacity}
                      unit={lvl.unit}
                      threshold={lvl.low_threshold}
                    />
                  ) : (
                    <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No level sensor</div>
                  )}
                  {lvl ? <AdminAdjust meterId={lvl.id} siteId={siteId} unit={lvl.unit} onSaved={load} /> : null}
                  {flw ? (
                    <div className="rounded-lg border border-border bg-card/60 p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium truncate">Flow — {flw.name}</span>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {(flwLast ? Number(flwLast.value) : 0).toFixed(2)} {flw.unit}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Latest flow reading</div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No flow meter</div>
                  )}
                  {flw ? <AdminAdjust meterId={flw.id} siteId={siteId} unit={flw.unit} onSaved={load} /> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminAdjust({ meterId, siteId, unit, onSaved }:
  { meterId: string; siteId: string; unit: string; onSaved: () => void }) {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  if (!isAdmin) return null;
  const submit = async () => {
    const n = Number(val);
    if (!Number.isFinite(n)) return toast.error("Enter a valid number");
    setBusy(true);
    const { error } = await supabase.from("readings").insert({
      site_id: siteId, meter_id: meterId, value: n, recorded_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Reading saved");
    setVal(""); setOpen(false); onSaved();
  };
  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="w-full justify-center text-xs h-7" onClick={() => setOpen(true)}>
        <Pencil className="h-3 w-3" /> Adjust reading
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Input autoFocus type="number" step="any" value={val} onChange={(e) => setVal(e.target.value)} placeholder={`New value (${unit})`} className="h-8 text-xs" />
      <Button size="sm" className="h-8" onClick={submit} disabled={busy}>{busy ? "…" : "Save"}</Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={() => { setOpen(false); setVal(""); }}>×</Button>
    </div>
  );
}

function ChartCard({
  title,
  data,
  dataKey,
  stroke,
}: {
  title: string;
  data: any[];
  dataKey: string;
  stroke: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <h3 className="text-sm font-medium mb-3">{title}</h3>
      <div className="h-56">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border)"
            />
            <XAxis
              dataKey="time"
              tick={{
                fontSize: 11,
                fill: "var(--color-muted-foreground)",
              }}
              stroke="var(--color-border)"
            />
            <YAxis
              tick={{
                fontSize: 11,
                fill: "var(--color-muted-foreground)",
              }}
              stroke="var(--color-border)"
            />
            <Tooltip
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={stroke}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
