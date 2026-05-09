import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { createSiteApiKey, grantAdminBootstrap, seedDemoData } from "@/lib/admin.functions";
import { Copy, Plus, Trash2, KeyRound, Sparkles, Cpu } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/admin")({ component: AdminPage });

interface Site { id: string; name: string; location: string | null }
interface Meter { id: string; site_id: string; meter_type: "wash"|"fresh_water"|"chemical"; name: string; unit: string; capacity: number | null; low_threshold: number | null; device_key: string; position: number }
interface ApiKeyRow { id: string; site_id: string; key_prefix: string; label: string | null; revoked: boolean; last_used_at: string | null; created_at: string }

function AdminPage() {
  const { isAdmin, refreshRoles, user } = useAuth();
  const nav = useNavigate();
  const bootstrap = useServerFn(grantAdminBootstrap);
  const seed = useServerFn(seedDemoData);

  const [sites, setSites] = useState<Site[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteLoc, setNewSiteLoc] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [sketchSite, setSketchSite] = useState<Site | null>(null);

  const load = async () => {
    const [{ data: s }, { data: m }, { data: k }] = await Promise.all([
      supabase.from("sites").select("id,name,location").order("created_at"),
      supabase.from("site_meters").select("*").order("position"),
      supabase.from("site_api_keys").select("*").order("created_at"),
    ]);
    setSites((s as any) ?? []);
    setMeters((m as any) ?? []);
    setKeys((k as any) ?? []);
  };

  useEffect(() => {
    // bootstrap: first user becomes admin if no admins exist yet
    bootstrap().then(async (res) => {
      if (res.granted) { await refreshRoles(); toast.success("You're set as admin (first user)"); }
      load();
    }).catch(() => load());
  }, []); // eslint-disable-line

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto rounded-xl border border-border bg-card p-6 text-center">
        <h2 className="font-semibold">Admins only</h2>
        <p className="text-sm text-muted-foreground mt-1">{user?.email} doesn't have admin access yet.</p>
        <Button className="mt-4" onClick={() => nav({ to: "/dashboard" })}>Back to dashboard</Button>
      </div>
    );
  }

  const addSite = async () => {
    if (!newSiteName.trim()) return;
    const { error } = await supabase.from("sites").insert({ name: newSiteName.trim(), location: newSiteLoc.trim() || null });
    if (error) return toast.error(error.message);
    setNewSiteName(""); setNewSiteLoc(""); load();
    toast.success("Site created");
  };

  const removeSite = async (id: string) => {
    if (!confirm("Delete this site? All meters and readings will be removed.")) return;
    const { error } = await supabase.from("sites").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const addMeter = async (siteId: string, m: Partial<Meter>) => {
    const { error } = await supabase.from("site_meters").insert({
      site_id: siteId,
      meter_type: m.meter_type!,
      name: m.name!,
      unit: m.unit ?? "",
      capacity: m.capacity ?? null,
      low_threshold: m.low_threshold ?? null,
      device_key: m.device_key!,
      position: meters.filter((x) => x.site_id === siteId).length,
    });
    if (error) return toast.error(error.message);
    load();
  };

  const removeMeter = async (id: string) => {
    const { error } = await supabase.from("site_meters").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const generateKey = useServerFn(createSiteApiKey);
  const handleGenKey = async (siteId: string) => {
    try {
      const res = await generateKey({ data: { siteId, label: "ESP32" } });
      setRevealedKey(res.apiKey);
      load();
    } catch (e: any) { toast.error(e.message ?? "Failed"); }
  };

  const revokeKey = async (id: string) => {
    const { error } = await supabase.from("site_api_keys").update({ revoked: true }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">Manage sites, meters, and ESP32 API keys.</p>
        </div>
        <Button variant="outline" size="sm" onClick={async () => {
          const r = await seed(); if (r.seeded) { toast.success("Demo sites seeded"); load(); } else toast.info("Sites already exist — skipped seed");
        }}><Sparkles className="h-4 w-4" /> Seed demo data</Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-card">
        <h2 className="font-semibold mb-3">New site</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)} placeholder="North Bay Wash" />
          </div>
          <div className="space-y-1.5">
            <Label>Location</Label>
            <Input value={newSiteLoc} onChange={(e) => setNewSiteLoc(e.target.value)} placeholder="Manchester, UK" />
          </div>
          <div className="flex items-end">
            <Button onClick={addSite} className="w-full"><Plus className="h-4 w-4" /> Add site</Button>
          </div>
        </div>
      </div>

      {sites.map((site) => (
        <SiteAdminCard
          key={site.id}
          site={site}
          meters={meters.filter((m) => m.site_id === site.id)}
          keys={keys.filter((k) => k.site_id === site.id)}
          onRemoveSite={() => removeSite(site.id)}
          onAddMeter={(m) => addMeter(site.id, m)}
          onRemoveMeter={removeMeter}
          onGenerateKey={() => handleGenKey(site.id)}
          onRevokeKey={revokeKey}
        onGenerateSketch={() => setSketchSite(site)}
        />
      ))}

      <Dialog open={!!revealedKey} onOpenChange={(o) => { if (!o) setRevealedKey(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>API key created</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Copy this key now — it won't be shown again. Configure your ESP32 to send it in the <code className="text-foreground">x-site-api-key</code> header.</p>
          <div className="rounded-lg bg-secondary p-3 font-mono text-xs break-all">{revealedKey}</div>
          <Button onClick={() => { navigator.clipboard.writeText(revealedKey ?? ""); toast.success("Copied"); }}>
            <Copy className="h-4 w-4" /> Copy
          </Button>
        </DialogContent>
      </Dialog>

      <EspSketchDialog
        site={sketchSite}
        meters={sketchSite ? meters.filter((m) => m.site_id === sketchSite.id) : []}
        onClose={() => setSketchSite(null)}
      />
    </div>
  );
}

function SiteAdminCard({
  site, meters, keys, onRemoveSite, onAddMeter, onRemoveMeter, onGenerateKey, onRevokeKey, onGenerateSketch,
}: {
  site: Site; meters: Meter[]; keys: ApiKeyRow[];
  onRemoveSite: () => void;
  onAddMeter: (m: Partial<Meter>) => void;
  onRemoveMeter: (id: string) => void;
  onGenerateKey: () => void;
  onRevokeKey: (id: string) => void;
  onGenerateSketch: () => void;
}) {
  const [type, setType] = useState<Meter["meter_type"]>("chemical");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("L");
  const [deviceKey, setDeviceKey] = useState("");
  const [capacity, setCapacity] = useState("");
  const [low, setLow] = useState("");

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">{site.name}</h3>
          {site.location && <div className="text-xs text-muted-foreground">{site.location}</div>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={onGenerateSketch} disabled={meters.length === 0}>
            <Cpu className="h-4 w-4" /> ESP32 sketch
          </Button>
          <Button variant="ghost" size="sm" onClick={onRemoveSite}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Meters</h4>
        {meters.length === 0 ? (
          <p className="text-sm text-muted-foreground">No meters yet.</p>
        ) : (
          <div className="space-y-1.5">
            {meters.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-accent text-primary">{m.device_key}</span>
                  <span className="font-medium">{m.name}</span>
                  <span className="text-xs text-muted-foreground capitalize">{m.meter_type.replace("_", " ")}</span>
                  {m.capacity ? <span className="text-xs text-muted-foreground">{m.capacity}{m.unit} cap</span> : null}
                </div>
                <Button variant="ghost" size="icon" onClick={() => onRemoveMeter(m.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-6 gap-2">
          <Select value={type} onValueChange={(v) => setType(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="wash">Wash</SelectItem>
              <SelectItem value="fresh_water">Fresh water</SelectItem>
              <SelectItem value="chemical">Chemical</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="device_key" value={deviceKey} onChange={(e) => setDeviceKey(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} />
          <Input placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <Input placeholder="Capacity" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          <Input placeholder="Low alert" type="number" value={low} onChange={(e) => setLow(e.target.value)} />
        </div>
        <Button size="sm" className="mt-2" onClick={() => {
          if (!name || !deviceKey) return toast.error("Name and device_key required");
          onAddMeter({
            meter_type: type, name, unit, device_key: deviceKey,
            capacity: capacity ? Number(capacity) : null,
            low_threshold: low ? Number(low) : null,
          });
          setName(""); setDeviceKey(""); setCapacity(""); setLow("");
        }}><Plus className="h-4 w-4" /> Add meter</Button>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs uppercase tracking-wide text-muted-foreground">ESP32 API keys</h4>
          <Button size="sm" variant="outline" onClick={onGenerateKey}><KeyRound className="h-3.5 w-3.5" /> Generate</Button>
        </div>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keys yet.</p>
        ) : (
          <div className="space-y-1.5">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs">{k.key_prefix}…</span>
                  {k.revoked && <span className="text-xs text-destructive">revoked</span>}
                  <span className="text-xs text-muted-foreground">
                    {k.last_used_at ? `Last used ${new Date(k.last_used_at).toLocaleString()}` : "Never used"}
                  </span>
                </div>
                {!k.revoked && <Button variant="ghost" size="sm" onClick={() => onRevokeKey(k.id)}>Revoke</Button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
