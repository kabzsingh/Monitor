import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Activity, Droplets, FlaskConical, Gauge } from "lucide-react";
import { StatCard } from "@/components/app/StatCard";
import { MeterCard } from "@/components/app/MeterCard";
import { ChemicalGauge } from "@/components/app/ChemicalGauge";
import { Button } from "@/components/ui/button";
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
  meter_type: "wash" | "fresh_water" | "chemical";
  name: string;
  unit: string;
  capacity: number | null;
  low_threshold: number | null;
  device_key: string;
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
          "id,meter_type,name,unit,capacity,low_threshold,device_key,position"
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
      } else if (meter.meter_type === "chemical") {
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

  const chemicalMeters = meters.filter((m) => m.meter_type === "chemical");
  const washMeters = meters.filter((m) => m.meter_type === "wash");
  const freshMeters = meters.filter((m) => m.meter_type === "fresh_water");

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
          tone={chemicalMeters.some((m) => {
            const last = stats.latestByMeter.get(m.id);
            return (
              last &&
              m.low_threshold !== null &&
              Number(last.value) <= Number(m.low_threshold)
            );
          })
            ? "danger"
            : "success"}
          value={`${chemicalMeters.filter((m) => {
            const last = stats.latestByMeter.get(m.id);
            return (
              last &&
              m.low_threshold !== null &&
              Number(last.value) <= Number(m.low_threshold)
            );
          }).length} / ${chemicalMeters.length}`}
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
                <MeterCard
                  key={m.id}
                  name={m.name}
                  meterType="wash"
                  value={last ? Number(last.value) : 0}
                  unit={m.unit}
                  capacity={m.capacity}
                  lowThreshold={m.low_threshold}
                />
              );
            })}
            {freshMeters.map((m) => {
              const last = stats.latestByMeter.get(m.id);
              return (
                <MeterCard
                  key={m.id}
                  name={m.name}
                  meterType="fresh_water"
                  value={last ? Number(last.value) : 0}
                  unit={m.unit}
                  capacity={m.capacity}
                  lowThreshold={m.low_threshold}
                />
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
        {chemicalMeters.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No chemical meters configured.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {chemicalMeters.map((m) => {
              const last = stats.latestByMeter.get(m.id);
              return (
                <ChemicalGauge
                  key={m.id}
                  name={m.name}
                  value={last ? Number(last.value) : 0}
                  capacity={m.capacity}
                  unit={m.unit}
                  threshold={m.low_threshold}
                />
              );
            })}
          </div>
        )}
      </div>
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
