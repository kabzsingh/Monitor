import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Droplets, FlaskConical, Gauge, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: DashboardPage });

interface SiteOverview {
  id: string; name: string; location: string | null;
  wash_today: number; wash_total: number;
  fresh_today: number;
  chemicals_low: number; chemicals_total: number;
  last_seen: string | null;
}

function DashboardPage() {
  const { isAdmin } = useAuth();
  const [sites, setSites] = useState<SiteOverview[] | null>(null);

  const load = async () => {
    const { data: siteRows } = await supabase
      .from("sites").select("id,name,location").order("name");
    if (!siteRows) { setSites([]); return; }

    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);

    const overviews: SiteOverview[] = await Promise.all(siteRows.map(async (s) => {
      const { data: meters } = await supabase
        .from("site_meters")
        .select("id,meter_type,name,unit,capacity,low_threshold")
        .eq("site_id", s.id);

      const meterIds = (meters ?? []).map((m) => m.id);
      let washToday = 0, washTotal = 0, freshToday = 0, chemLow = 0, chemTotal = 0;
      let lastSeen: string | null = null;

      if (meterIds.length > 0) {
        // Get latest reading per meter
        const { data: latest } = await supabase
          .from("readings")
          .select("meter_id,value,recorded_at")
          .in("meter_id", meterIds)
          .order("recorded_at", { ascending: false })
          .limit(500);

        const latestByMeter = new Map<string, { value: number; recorded_at: string }>();
        (latest ?? []).forEach((r) => {
          if (!latestByMeter.has(r.meter_id)) latestByMeter.set(r.meter_id, { value: Number(r.value), recorded_at: r.recorded_at });
          if (!lastSeen || r.recorded_at > lastSeen) lastSeen = r.recorded_at;
        });

        for (const m of meters!) {
          if (m.meter_type === "chemical") {
            chemTotal++;
            const v = latestByMeter.get(m.id)?.value;
            if (v !== undefined && m.capacity && m.low_threshold !== null && v <= Number(m.low_threshold)) chemLow++;
          }
        }

        // Today aggregates: sum increments for wash and fresh by site_id
        const washMeterIds = meters!.filter((m) => m.meter_type === "wash").map((m) => m.id);
        const freshMeterIds = meters!.filter((m) => m.meter_type === "fresh_water").map((m) => m.id);

        if (washMeterIds.length > 0) {
          const { data: wt } = await supabase
            .from("readings").select("value")
            .in("meter_id", washMeterIds)
            .gte("recorded_at", startOfDay.toISOString());
          washToday = (wt ?? []).reduce((a, r) => a + Number(r.value), 0);
          const { data: wlt } = await supabase
            .from("readings").select("value")
            .in("meter_id", washMeterIds);
          washTotal = (wlt ?? []).reduce((a, r) => a + Number(r.value), 0);
        }
        if (freshMeterIds.length > 0) {
          const { data: ft } = await supabase
            .from("readings").select("value")
            .in("meter_id", freshMeterIds)
            .gte("recorded_at", startOfDay.toISOString());
          freshToday = (ft ?? []).reduce((a, r) => a + Number(r.value), 0);
        }
      }

      return {
        id: s.id, name: s.name, location: s.location,
        wash_today: washToday, wash_total: washTotal,
        fresh_today: freshToday,
        chemicals_low: chemLow, chemicals_total: chemTotal,
        last_seen: lastSeen,
      };
    }));

    setSites(overviews);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("readings-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "readings" }, () => load())
      .subscribe();
    const interval = setInterval(load, 30_000);
    return () => { supabase.removeChannel(ch); clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Live sites</h1>
          <p className="text-sm text-muted-foreground">Real-time view across all your wash sites.</p>
        </div>
        <Link to="/admin"><Button variant="outline" size="sm"><Plus className="h-4 w-4" /> Manage sites</Button></Link>
      </div>

      {sites === null ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : sites.length === 0 ? (
        <EmptyState isAdmin={isAdmin} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sites.map((s) => <SiteCard key={s.id} s={s} />)}
        </div>
      )}
    </div>
  );
}

function SiteCard({ s }: { s: SiteOverview }) {
  const online = s.last_seen ? Date.now() - new Date(s.last_seen).getTime() < 5 * 60_000 : false;
  return (
    <Link to="/sites/$siteId" params={{ siteId: s.id }} className="group">
      <div className="rounded-xl border border-border bg-card p-5 shadow-card transition-all hover:border-primary/50 hover:shadow-glow">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">{s.name}</div>
            {s.location && <div className="text-xs text-muted-foreground">{s.location}</div>}
          </div>
          <span className={`text-xs flex items-center gap-1.5 ${online ? "text-success" : "text-muted-foreground"}`}>
            <span className={`h-2 w-2 rounded-full ${online ? "bg-success animate-pulse" : "bg-muted-foreground/40"}`} />
            {online ? "Online" : "Offline"}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Mini icon={Gauge} label="Today" value={s.wash_today.toLocaleString()} />
          <Mini icon={Activity} label="Lifetime" value={s.wash_total.toLocaleString()} />
          <Mini icon={Droplets} label="Fresh L" value={s.fresh_today.toFixed(0)} />
        </div>
        <div className="mt-3 text-xs flex items-center gap-1.5">
          <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
          {s.chemicals_total === 0 ? (
            <span className="text-muted-foreground">No chemical meters</span>
          ) : s.chemicals_low > 0 ? (
            <span className="text-destructive font-medium">{s.chemicals_low} of {s.chemicals_total} chemicals low</span>
          ) : (
            <span className="text-success">All {s.chemicals_total} chemicals healthy</span>
          )}
        </div>
      </div>
    </Link>
  );
}

function Mini({ icon: Icon, label, value }: { icon: typeof Gauge; label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/60 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />{label}
      </div>
      <div className="text-base font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function EmptyState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
      <div className="mx-auto h-12 w-12 rounded-xl bg-accent grid place-items-center mb-3">
        <Activity className="h-6 w-6 text-primary" />
      </div>
      <h3 className="font-semibold">No sites yet</h3>
      <p className="text-sm text-muted-foreground mt-1">
        {isAdmin ? "Create your first site and add meters to start streaming live data." : "Ask an admin to assign you to a site."}
      </p>
      {isAdmin && (
        <Link to="/admin" className="inline-block mt-4">
          <Button><Plus className="h-4 w-4" /> Create site</Button>
        </Link>
      )}
    </div>
  );
}
