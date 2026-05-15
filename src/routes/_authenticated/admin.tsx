import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { bootstrapAdminAccess, isSetupRequiredError } from "@/lib/bootstrap-admin";
import { clearSupabaseSession } from "@/lib/clear-supabase-session";
import { getSupabaseProjectRef } from "@/lib/supabase-project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { createSiteApiKey, grantAdminBootstrap, seedDemoData, getSmtpSettings, updateSmtpSettings } from "@/lib/admin.functions";
import { Copy, Plus, Trash2, KeyRound, Sparkles, Cpu, Mail, Send, Server, ShieldCheck, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/admin")({ component: AdminPage });

interface Site {
  id: string; name: string; location: string | null;
  timezone?: string;
  report_hour?: number;
  report_recipients?: string[];
  daily_report_enabled?: boolean;
  monthly_report_enabled?: boolean;
}
interface Meter { id: string; site_id: string; meter_type: "wash"|"fresh_water"|"chemical"|"chemical_flow"; name: string; unit: string; capacity: number | null; low_threshold: number | null; device_key: string; position: number; chemical_group: string | null }
interface ApiKeyRow { id: string; site_id: string; key_prefix: string; label: string | null; revoked: boolean; last_used_at: string | null; created_at: string }

const SETUP_SQL_HINT =
  "Supabase Dashboard → SQL Editor → run scripts/setup-admin.sql from this repo (or paste the setup SQL from the repo README).";

function AdminPage() {
  const { isAdmin, refreshRoles, user, loading } = useAuth();
  const nav = useNavigate();
  const bootstrapServer = useServerFn(grantAdminBootstrap);
  const seed = useServerFn(seedDemoData);

  const [sites, setSites] = useState<Site[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteLoc, setNewSiteLoc] = useState("");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [sketchSite, setSketchSite] = useState<Site | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [needsDbSetup, setNeedsDbSetup] = useState(false);
  const [bootstrapNote, setBootstrapNote] = useState<string | null>(null);
  const projectRef = getSupabaseProjectRef();

  const load = async () => {
    if (!isAdmin) return;
    const [{ data: s }, { data: m }, { data: k }] = await Promise.all([
      supabase.from("sites").select("id,name,location,timezone,report_hour,report_recipients,daily_report_enabled,monthly_report_enabled").order("created_at"),
      supabase.from("site_meters").select("*").order("position"),
      supabase.from("site_api_keys").select("*").order("created_at"),
    ]);
    setSites((s as any) ?? []);
    setMeters((m as any) ?? []);
    setKeys((k as any) ?? []);
  };

  const runBootstrap = useCallback(async () => {
    if (!user?.id) return;
    setIsBootstrapping(true);
    setNeedsDbSetup(false);
    setBootstrapNote(null);
    try {
      let res = await bootstrapServer();
      if (!res.granted && !res.isAdmin) {
        res = await bootstrapAdminAccess(user.id);
      }
      if (res.granted || res.isAdmin) {
        await refreshRoles();
        if (res.granted) toast.success("You're set as admin (first user)");
      } else {
        setBootstrapNote(
          "No admin role yet. If you changed Supabase projects, sign out and create a new account on this database, then retry.",
        );
        const { error: rpcProbe } = await supabase.rpc("bootstrap_first_admin");
        if (
          rpcProbe?.code === "PGRST202" ||
          (rpcProbe?.message?.includes("bootstrap_first_admin") ?? false)
        ) {
          setNeedsDbSetup(true);
        }
      }
    } catch (e) {
      console.error(e);
      if (isSetupRequiredError(e) || (e && typeof e === "object" && (e as { code?: string }).code === "42501")) {
        setNeedsDbSetup(true);
      }
      toast.error(
        isSetupRequiredError(e)
          ? "Database setup required — see instructions below."
          : e instanceof Error
            ? e.message
            : "Could not verify admin access. Try signing out and back in.",
      );
    } finally {
      setIsBootstrapping(false);
    }
  }, [user?.id, refreshRoles, bootstrapServer]);

  useEffect(() => {
    if (loading || !user?.id) return;
    void runBootstrap();
  }, [loading, user?.id, runBootstrap]);

  useEffect(() => {
    if (isAdmin) {
      load();
    }
  }, [isAdmin]);

  if (loading || isBootstrapping) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Verifying admin access...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto rounded-xl border border-border bg-card p-6 text-center">
        <div className="flex justify-center mb-4">
          <ShieldCheck className="h-12 w-12 text-muted-foreground opacity-20" />
        </div>
        <h2 className="font-semibold text-xl">Admins only</h2>
        <p className="text-sm text-muted-foreground mt-2">
          {user?.email} doesn&apos;t have admin access on{" "}
          <code className="text-xs">{projectRef ?? "this database"}</code> yet.
        </p>
        {bootstrapNote && (
          <p className="text-xs text-muted-foreground mt-2 text-left">{bootstrapNote}</p>
        )}
        {needsDbSetup && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-3 text-left rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
            {SETUP_SQL_HINT}
          </p>
        )}
        <div className="flex flex-col gap-2 mt-6">
          <Button onClick={() => void runBootstrap()} disabled={isBootstrapping}>
            {isBootstrapping ? "Checking…" : "Retry access"}
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await clearSupabaseSession();
              toast.message("Signed out — create an account on this database");
              nav({ to: "/signup" });
            }}
          >
            Sign out &amp; sign up again
          </Button>
          <Button variant="ghost" onClick={() => nav({ to: "/dashboard" })}>Back to dashboard</Button>
        </div>
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

  const addMeter = async (siteId: string, m: Partial<Meter>): Promise<boolean> => {
    const name = (m.name ?? "").trim();
    const deviceKey = (m.device_key ?? "").trim();
    if (!name || !deviceKey) {
      toast.error("Name and device_key required");
      return false;
    }
    if (meters.some((x) => x.site_id === siteId && x.device_key === deviceKey)) {
      toast.error(`This site already has a meter with device_key "${deviceKey}"`);
      return false;
    }
    try {
      const { error } = await supabase.from("site_meters").insert({
        site_id: siteId,
        meter_type: m.meter_type!,
        name,
        unit: (m.unit ?? "").trim() || "",
        capacity: m.capacity ?? null,
        low_threshold: m.low_threshold ?? null,
        device_key: deviceKey,
        chemical_group: m.chemical_group?.trim() || null,
        position: meters.filter((x) => x.site_id === siteId).length,
      });
      if (error) {
        toast.error(error.message);
        return false;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to add meter";
      toast.error(msg);
      return false;
    }
    try {
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error(`Meter was saved but the list could not be refreshed (${msg}). Try reloading the page.`);
      return true;
    }
    toast.success("Meter added");
    return true;
  };

  const removeMeter = async (id: string) => {
    try {
      const { error } = await supabase.from("site_meters").delete().eq("id", id);
      if (error) return toast.error(error.message);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to remove meter";
      toast.error(msg);
    }
  };

  const generateKey = useServerFn(createSiteApiKey);
  const handleGenKey = async (siteId: string) => {
    try {
      const res = await generateKey({ siteId, label: "ESP32" });
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
    <div className="space-y-6 pb-12">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">Manage sites, meters, and ESP32 API keys.</p>
        </div>
        <Button variant="outline" size="sm" onClick={async () => {
          const r = await seed(); if (r.seeded) { toast.success("Demo sites seeded"); load(); } else toast.info("Sites already exist — skipped seed");
        }}><Sparkles className="h-4 w-4" /> Seed demo data</Button>
      </div>

      <SmtpSettingsPanel />

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
          <p className="text-sm text-muted-foreground">Copy this key now — it won''t be shown again. Configure your ESP32 to send it in the <code className="text-foreground">x-site-api-key</code> header.</p>
          <div className="rounded-lg bg-secondary p-3 font-mono text-xs break-all">{revealedKey}</div>
          <Button onClick={() => { navigator.clipboard.writeText(revealedKey ?? ""); toast.success("Copied"); }}>
            <Copy className="h-4 w-4" /> Copy
          </Button>
        </DialogContent>
      </Dialog>

      <EspSketchDialog
        key={sketchSite?.id ?? "esp-sketch-closed"}
        site={sketchSite}
        meters={sketchSite ? meters.filter((m) => m.site_id === sketchSite.id) : []}
        onClose={() => setSketchSite(null)}
      />
    </div>
  );
}

function SmtpSettingsPanel() {
  const get = useServerFn(getSmtpSettings);
  const update = useServerFn(updateSmtpSettings);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [userEmail, setUserEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fromName, setFromName] = useState("Wash Dashboard");
  const [fromEmail, setFromEmail] = useState("");
  const [encryption, setEncryption] = useState<"tls" | "ssl" | "none">("tls");

  useEffect(() => {
    get().then((data) => {
      if (data) {
        setHost(data.host);
        setPort(String(data.port));
        setUserEmail(data.user_email);
        setPassword(data.password);
        setFromName(data.from_name);
        setFromEmail(data.from_email);
        setEncryption(data.encryption as any);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []); // eslint-disable-line

  const handleSave = async () => {
    setSaving(true);
    try {
      await update({
        host, port: Number(port), user_email: userEmail, password,
        from_name: fromName, from_email: fromEmail, encryption
      });
      toast.success("SMTP settings updated");
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center gap-2 mb-4">
        <Server className="h-5 w-5 text-primary" />
        <h2 className="font-semibold text-lg">SMTP Configuration</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label>SMTP Host</Label>
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.gmail.com" />
        </div>
        <div className="space-y-1.5">
          <Label>Port</Label>
          <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" />
        </div>
        <div className="space-y-1.5">
          <Label>Encryption</Label>
          <Select value={encryption} onValueChange={(v) => setEncryption(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tls">TLS (STARTTLS)</SelectItem>
              <SelectItem value="ssl">SSL</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>SMTP User / Email</Label>
          <Input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="user@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label>SMTP Password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <div className="space-y-1.5">
          <Label>Sender Name</Label>
          <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Wash Reports" />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <Label>Sender Email Address</Label>
          <Input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="reports@example.com" />
        </div>
        <div className="flex items-end">
          <Button onClick={handleSave} className="w-full" disabled={saving}>
            {saving ? "Saving..." : "Update SMTP Settings"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        Once configured, reports will be sent via this SMTP server instead of the default Gmail connector.
      </p>
    </div>
  );
}

function SiteAdminCard({
  site, meters, keys, onRemoveSite, onAddMeter, onRemoveMeter, onGenerateKey, onRevokeKey, onGenerateSketch,
}: {
  site: Site; meters: Meter[]; keys: ApiKeyRow[];
  onRemoveSite: () => void;
  onAddMeter: (m: Partial<Meter>) => Promise<boolean>;
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
  const [group, setGroup] = useState("");

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">{site.name}</h3>
          {site.location && <div className="text-xs text-muted-foreground">{site.location}</div>}
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={onGenerateSketch} disabled={meters.length === 0}>
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
                  {m.chemical_group ? <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-400">{m.chemical_group}</span> : null}
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
              <SelectItem value="chemical">Chemical level</SelectItem>
              <SelectItem value="chemical_flow">Chemical flow</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="device_key" value={deviceKey} onChange={(e) => setDeviceKey(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} />
          <Input placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <Input placeholder="Capacity" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          <Input placeholder="Low alert" type="number" value={low} onChange={(e) => setLow(e.target.value)} />
        </div>
        {(type === "chemical" || type === "chemical_flow") && (
          <div className="mt-2">
            <Input placeholder="Chemical group (e.g. Soap, Wax) — pair level + flow with same group" value={group} onChange={(e) => setGroup(e.target.value)} />
          </div>
        )}
        <Button
          size="sm"
          className="mt-2"
          onClick={async () => {
            if (!name.trim() || !deviceKey.trim()) return toast.error("Name and device_key required");
            const ok = await onAddMeter({
              meter_type: type,
              name: name.trim(),
              unit,
              device_key: deviceKey.trim(),
              capacity: capacity ? Number(capacity) : null,
              low_threshold: low ? Number(low) : null,
              chemical_group: group.trim() || null,
            });
            if (!ok) return;
            setName("");
            setDeviceKey("");
            setCapacity("");
            setLow("");
            setGroup("");
          }}
        ><Plus className="h-4 w-4" /> Add meter</Button>
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

      <ReportSettings site={site} onSaved={() => { /* parent will refetch on next mount */ }} />
    </div>
  );
}

function ReportSettings({ site, onSaved }: { site: Site; onSaved: () => void }) {
  const [hour, setHour] = useState<number>(site.report_hour ?? 7);
  const [tz, setTz] = useState<string>(site.timezone || "UTC");
  const [recipients, setRecipients] = useState<string>((site.report_recipients ?? []).join(", "));
  const [daily, setDaily] = useState<boolean>(site.daily_report_enabled ?? true);
  const [monthly, setMonthly] = useState<boolean>(site.monthly_report_enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const save = async () => {
    setSaving(true);
    const list = recipients.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean);
    const bad = list.find((e) => !/.+@.+\..+/.test(e));
    if (bad) { setSaving(false); return toast.error(`Invalid email: ${bad}`); }
    const { error } = await supabase.from("sites").update({
      report_hour: hour, timezone: tz, report_recipients: list,
      daily_report_enabled: daily, monthly_report_enabled: monthly,
    }).eq("id", site.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Report settings saved");
    onSaved();
  };

  const sendTest = async () => {
    setSending(true);
    try {
      const res = await fetch(`/api/public/hooks/send-reports?force=${site.id}`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(j));
      toast.success("Test report sent (check inbox)");
    } catch (e: any) {
      toast.error(e.message ?? "Send failed");
    } finally { setSending(false); }
  };

  return (
    <div className="mt-5 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email reports</h4>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={sendTest} disabled={sending}><Send className="h-3.5 w-3.5" /> {sending ? "Sending…" : "Send test now"}</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Send hour (24h, site local)</Label>
          <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }).map((_, i) => (
                <SelectItem key={i} value={String(i)}>{String(i).padStart(2, "0")}:00</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Timezone (IANA)</Label>
          <Input value={tz} onChange={(e) => setTz(e.target.value)} placeholder="Africa/Johannesburg" />
        </div>
        <div className="sm:col-span-2 space-y-1.5">
          <Label>Recipients (comma-separated)</Label>
          <Textarea rows={2} value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ops@example.com, manager@example.com" />
        </div>
        <label className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2 text-sm">
          <span>Daily report (every morning)</span>
          <Switch checked={daily} onCheckedChange={setDaily} />
        </label>
        <label className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2 text-sm">
          <span>Monthly CSV (1st of month)</span>
          <Switch checked={monthly} onCheckedChange={setMonthly} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground mt-2">Reports are sent using your configured SMTP settings.</p>
    </div>
  );
}

function buildEsp32Sketch(site: Site, meters: Meter[]) {
  const endpoint = `${typeof window !== "undefined" ? window.location.origin : "https://your-app.lovable.app"}/api/public/ingest`;
  const meterLines = meters
    .map((m) => `  // ${m.name} (${m.meter_type}) — device_key: ${m.device_key}`)
    .join("\n");
  const varDecls = meters
    .map((m) => `float v_${m.device_key.replace(/[^a-zA-Z0-9]/g, "_")} = 0; // ${m.name}`)
    .join("\n");
  // Each line appends one JSON object; leading comma separates array entries (valid C++ / JSON).
  const jsonParts = meters
    .map((m, i) => {
      const v = `v_${m.device_key.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const lead = i === 0 ? "" : ",";
      return `  payload += "${lead}{\\"device_key\\":\\"${m.device_key}\\",\\"value\\":" + String(${v}, 3) + "}";`;
    })
    .join("\n");

  return `// Auto-generated for site: ${site.name}
// Endpoint: ${endpoint}
// Replace WIFI_SSID, WIFI_PASS, and SITE_API_KEY before flashing.
//
// Meters configured:
${meterLines || "  // (no meters)"}

#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID    = "YOUR_WIFI_SSID";
const char* WIFI_PASS    = "YOUR_WIFI_PASSWORD";
const char* SITE_API_KEY = "ws_live_xxx_paste_from_admin_panel";
const char* INGEST_URL   = "${endpoint}";

unsigned long lastSendMs = 0;
const unsigned long SEND_INTERVAL_MS = 60UL * 1000UL; // every 60s

// Reading variables — update these from your sensors in loop()
${varDecls}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println(" OK");
}

void sendReadings() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();

  String payload = "{\\"readings\\":[";
${jsonParts}
  payload += "]}";

  HTTPClient http;
  http.begin(INGEST_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-site-api-key", SITE_API_KEY);
  int code = http.POST(payload);
  Serial.printf("POST %d -> %s\\n", code, http.getString().c_str());
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  connectWifi();
}

void loop() {
  if (millis() - lastSendMs >= SEND_INTERVAL_MS) {
    lastSendMs = millis();
    sendReadings();
  }
  // TODO: update reading variables from your sensors:
${meters.map((m) => `  // v_${m.device_key.replace(/[^a-zA-Z0-9]/g, "_")} = ...; // ${m.name} (${m.unit})`).join("\n")}
  delay(50);
}
`;
}

function EspSketchDialog({ site, meters, onClose }: { site: Site | null; meters: Meter[]; onClose: () => void }) {
  const code = site ? buildEsp32Sketch(site, meters) : "";
  return (
    <Dialog open={!!site} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-4 overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>ESP32 sketch — {site?.name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground shrink-0">
          Paste this into the Arduino IDE. Replace the Wi-Fi creds and the <code className="text-foreground">SITE_API_KEY</code> with the one generated above. Wire your pulse-counter / tank-level reads into the <code className="text-foreground">TODO</code> spots.
        </p>
        <Textarea readOnly value={code} className="font-mono text-xs min-h-[280px] flex-1 resize-y" spellCheck={false} />
        <DialogFooter className="shrink-0">
          <Button type="button" onClick={() => { navigator.clipboard.writeText(code); toast.success("Sketch copied"); }}>
            <Copy className="h-4 w-4" /> Copy sketch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
