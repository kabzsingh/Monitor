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
import { Copy, Plus, Trash2, KeyRound, Sparkles, Cpu, Mail, Send, Server, ShieldCheck, Loader2, AlertTriangle } from "lucide-react";
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
  "Supabase Dashboard → SQL Editor → run scripts/setup-admin.sql from this repo.";

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
    try {
      // Load data individually to handle missing columns gracefully
      const { data: s, error: sErr } = await supabase.from("sites").select("*").order("created_at");
      if (sErr) toast.error("Error loading sites: " + sErr.message);
      else setSites((s as any) ?? []);

      const { data: m, error: mErr } = await supabase.from("site_meters").select("*").order("position");
      if (mErr) toast.error("Error loading meters: " + mErr.message);
      else setMeters((m as any) ?? []);

      const { data: k, error: kErr } = await supabase.from("site_api_keys").select("*").order("created_at");
      if (kErr) toast.error("Error loading API keys: " + kErr.message);
      else setKeys((k as any) ?? []);
    } catch (e) {
      console.error("Load failed", e);
      toast.error("Failed to load admin data");
    }
  };

  const runBootstrap = useCallback(async () => {
    if (!user?.id) return;
    setIsBootstrapping(true);
    setNeedsDbSetup(false);
    setBootstrapNote(null);
    try {
      const res = await bootstrapServer();
      if (res.granted || res.isAdmin) {
        await refreshRoles();
        if (res.granted) toast.success("You've been granted Admin access!");
      } else {
        // Fallback to client-side bootstrap if server fails
        const clientRes = await bootstrapAdminAccess(user.id);
        if (clientRes.granted || clientRes.isAdmin) {
          await refreshRoles();
          if (clientRes.granted) toast.success("You're set as admin (via fallback)");
        } else {
          setBootstrapNote("No admin role detected. Please ensure you have run the setup SQL in your Supabase dashboard.");
          setNeedsDbSetup(true);
        }
      }
    } catch (e: any) {
      console.error("Bootstrap error:", e);
      setNeedsDbSetup(true);
      toast.error(e?.message || "Failed to verify admin access");
    } finally {
      setIsBootstrapping(false);
    }
  }, [user?.id, refreshRoles, bootstrapServer]);

  useEffect(() => {
    if (loading || !user?.id) return;
    if (!isAdmin) void runBootstrap();
  }, [loading, user?.id, isAdmin, runBootstrap]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (loading || isBootstrapping) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4 text-center px-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-medium">Verifying admin permissions...</p>
        <p className="text-xs text-muted-foreground/60 max-w-xs italic">
          This usually takes a few seconds. If it hangs, please check your internet connection.
        </p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-12 rounded-xl border border-border bg-card p-8 shadow-xl text-center">
        <div className="flex justify-center mb-6">
          <div className="p-3 bg-muted rounded-full">
            <ShieldCheck className="h-10 w-10 text-muted-foreground opacity-50" />
          </div>
        </div>
        <h2 className="font-semibold text-2xl tracking-tight">Access Restricted</h2>
        <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
          Your account (<strong>{user?.email}</strong>) does not have administrator privileges on project
          <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-xs font-mono">{projectRef || "unknown"}</code>.
        </p>

        {needsDbSetup && (
          <div className="mt-6 p-4 text-left rounded-lg border border-amber-500/20 bg-amber-500/5">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-sm mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span>Database Setup Required</span>
            </div>
            <p className="text-xs text-amber-700/80 dark:text-amber-300/80 leading-relaxed mb-3">
              {SETUP_SQL_HINT}
            </p>
            <div className="text-[10px] font-mono bg-background/50 p-2 rounded border border-amber-500/10 overflow-x-auto whitespace-pre">
              {`-- Find this script in:
scripts/setup-admin.sql`}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 mt-8">
          <Button onClick={() => void runBootstrap()} disabled={isBootstrapping} className="w-full">
            {isBootstrapping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Retry Access Check
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={async () => {
              await clearSupabaseSession();
              toast.info("Signed out. Please sign up for a new account.");
              nav({ to: "/signup" });
            }}
          >
            Sign out & Switch User
          </Button>
          <Button variant="ghost" onClick={() => nav({ to: "/dashboard" })} className="text-muted-foreground">
            Return to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const addSite = async () => {
    if (!newSiteName.trim()) return;
    const { error } = await supabase.from("sites").insert({ name: newSiteName.trim(), location: newSiteLoc.trim() || null });
    if (error) return toast.error(error.message);
    setNewSiteName(""); setNewSiteLoc(""); load();
    toast.success("Site created successfully");
  };

  const removeSite = async (id: string) => {
    if (!confirm("Are you sure? This will permanently delete the site and all its data.")) return;
    const { error } = await supabase.from("sites").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
    toast.success("Site deleted");
  };

  const addMeter = async (siteId: string, m: Partial<Meter>): Promise<boolean> => {
    const name = (m.name ?? "").trim();
    const deviceKey = (m.device_key ?? "").trim();
    if (!name || !deviceKey) {
      toast.error("Name and Device Key are required");
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
      load();
      toast.success("Meter added");
      return true;
    } catch (e: any) {
      toast.error(e.message || "Failed to add meter");
      return false;
    }
  };

  const removeMeter = async (id: string) => {
    const { error } = await supabase.from("site_meters").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
    toast.success("Meter removed");
  };

  const generateKey = useServerFn(createSiteApiKey);
  const handleGenKey = async (siteId: string) => {
    try {
      const res = await generateKey({ siteId, label: "ESP32" });
      setRevealedKey(res.apiKey);
      load();
    } catch (e: any) { toast.error(e.message ?? "Key generation failed"); }
  };

  const revokeKey = async (id: string) => {
    const { error } = await supabase.from("site_api_keys").update({ revoked: true }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
    toast.success("Key revoked");
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20 px-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Console</h1>
          <p className="text-muted-foreground mt-1 text-sm">Configure site infrastructure, monitor ESP32 connectivity, and manage reports.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={async () => {
          const r = await seed();
          if (r.seeded) {
            toast.success("Demo environment initialized");
            load();
          } else {
            toast.info("Database already contains data — seeding skipped");
          }
        }} className="gap-2 shrink-0">
          <Sparkles className="h-4 w-4" /> Initialize Demo Sites
        </Button>
      </div>

      <SmtpSettingsPanel />

      <section className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-primary" />
          Infrastructure Management
        </h2>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm overflow-hidden">
          <h3 className="text-sm font-medium mb-4 text-muted-foreground">Register New Wash Site</h3>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="site-name">Friendly Name</Label>
              <Input id="site-name" value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)} placeholder="e.g. Manchester Central" />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="site-loc">Location / Area</Label>
              <Input id="site-loc" value={newSiteLoc} onChange={(e) => setNewSiteLoc(e.target.value)} placeholder="e.g. M1 1AA" />
            </div>
            <div className="flex items-end">
              <Button onClick={addSite} className="w-full gap-2 shadow-sm">
                <Plus className="h-4 w-4" /> Create Site
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-6">
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

          {sites.length === 0 && !loading && (
            <div className="py-12 text-center rounded-xl border border-dashed border-border bg-muted/30">
              <p className="text-sm text-muted-foreground italic">No wash sites registered yet. Add one above to get started.</p>
            </div>
          )}
        </div>
      </section>

      <Dialog open={!!revealedKey} onOpenChange={(o) => { if (!o) setRevealedKey(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              API Key Generated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              <strong>Action required:</strong> Copy this key immediately. For security, it will never be displayed again.
            </p>
            <div className="relative">
              <div className="rounded-lg bg-secondary/80 p-4 font-mono text-sm break-all border border-border/50 pr-12">
                {revealedKey}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-2 top-1/2 -translate-y-1/2 hover:bg-background"
                onClick={() => { navigator.clipboard.writeText(revealedKey ?? ""); toast.success("Copied to clipboard"); }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground italic bg-muted/50 p-2 rounded">
              Note: Include this in the <code>x-site-api-key</code> header of your ESP32 requests.
            </p>
          </div>
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
  const [fromName, setFromName] = useState("WashGrid Dashboard");
  const [fromEmail, setFromEmail] = useState("");
  const [encryption, setEncryption] = useState<"tls" | "ssl" | "none">("tls");

  useEffect(() => {
    get().then((data) => {
      if (data) {
        setHost(data.host || "");
        setPort(String(data.port || "587"));
        setUserEmail(data.user_email || "");
        setPassword(data.password || "");
        setFromName(data.from_name || "WashGrid Dashboard");
        setFromEmail(data.from_email || "");
        setEncryption((data.encryption as any) || "tls");
      }
      setLoading(false);
    }).catch((e) => {
      console.warn("SMTP fetch failed (normal if not setup):", e);
      setLoading(false);
    });
  }, []); // eslint-disable-line

  const handleSave = async () => {
    if (!host || !userEmail || !password) {
      return toast.error("Host, User Email, and Password are required");
    }
    setSaving(true);
    try {
      await update({
        host, port: Number(port), user_email: userEmail, password,
        from_name: fromName, from_email: fromEmail, encryption
      });
      toast.success("Mail server settings updated");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save SMTP settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm border-l-4 border-l-primary/50">
      <div className="flex items-center gap-2 mb-6">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Server className="h-5 w-5 text-primary" />
        </div>
        <h2 className="font-semibold text-lg">System Mail Server (SMTP)</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="space-y-2">
          <Label>Outbound Host</Label>
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="e.g. smtp.postmarkapp.com" />
        </div>
        <div className="space-y-2">
          <Label>Port</Label>
          <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" />
        </div>
        <div className="space-y-2">
          <Label>Encryption Method</Label>
          <Select value={encryption} onValueChange={(v) => setEncryption(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tls">STARTTLS / TLS</SelectItem>
              <SelectItem value="ssl">SSL / SMTPS</SelectItem>
              <SelectItem value="none">Unencrypted (Not Recommended)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>User Email / Login</Label>
          <Input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="smtp_user@domain.com" />
        </div>
        <div className="space-y-2">
          <Label>Account Password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <div className="space-y-2">
          <Label>Global Sender Name</Label>
          <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="WashGrid Automations" />
        </div>
        <div className="sm:col-span-2 space-y-2">
          <Label>Global From Address</Label>
          <Input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="reports@yourdomain.com" />
        </div>
        <div className="flex items-end">
          <Button onClick={handleSave} className="w-full font-medium" disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Apply SMTP Configuration
          </Button>
        </div>
      </div>
      <div className="mt-4 p-3 rounded bg-muted/30 flex gap-2 items-start">
        <Loader2 className="h-3 w-3 mt-1 shrink-0 text-muted-foreground" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <strong>Pro-tip:</strong> Use a dedicated transactional mail provider (Postmark, SendGrid, or Resend) for reliable report delivery. Gmail App Passwords work but are prone to rate limiting.
        </p>
      </div>
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
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden transition-all hover:shadow-md">
      <div className="bg-muted/30 px-6 py-4 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-background border border-border flex items-center justify-center font-bold text-primary">
            {site.name.charAt(0)}
          </div>
          <div>
            <h3 className="font-bold text-lg leading-tight">{site.name}</h3>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wider font-medium">
              <Cpu className="h-3 w-3" />
              {site.location || "Remote Site"}
              <span className="mx-1 opacity-30">•</span>
              {meters.length} Sensor{meters.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onGenerateSketch} disabled={meters.length === 0} className="h-8 text-xs font-semibold">
            <Cpu className="h-3.5 w-3.5 mr-1.5" /> Sketch
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemoveSite} className="h-8 w-8 text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="p-6 space-y-8">
        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Meter & Sensor Configuration</h4>
          </div>

          <div className="space-y-2">
            {meters.map((m) => (
              <div key={m.id} className="group flex items-center justify-between rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/30">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center justify-center px-2 py-1 rounded bg-muted font-mono text-[10px] font-bold text-muted-foreground">
                    ID
                    <span className="text-primary">{m.device_key}</span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{m.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground/70">{m.meter_type.replace("_", " ")}</span>
                      {m.chemical_group && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 font-bold border border-indigo-500/10">
                          GRP: {m.chemical_group}
                        </span>
                      )}
                      {m.capacity && <span className="text-[10px] text-muted-foreground/60">CAP: {m.capacity}{m.unit}</span>}
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => onRemoveMeter(m.id)} className="h-8 w-8 opacity-0 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}

            {meters.length === 0 && (
              <div className="text-center py-6 border-2 border-dashed border-border rounded-lg bg-muted/10">
                <p className="text-xs text-muted-foreground italic">No sensors configured for this site.</p>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-lg bg-muted/20 p-4 border border-border/40">
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-3 tracking-widest">Connect New Meter</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px]">Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as any)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wash">Wash</SelectItem>
                    <SelectItem value="fresh_water">Water</SelectItem>
                    <SelectItem value="chemical">Level</SelectItem>
                    <SelectItem value="chemical_flow">Flow</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Name</Label>
                <Input className="h-8 text-xs" placeholder="e.g. Soap 1" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Device Key</Label>
                <Input className="h-8 text-xs" placeholder="esp_id" value={deviceKey} onChange={(e) => setDeviceKey(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Unit</Label>
                <Input className="h-8 text-xs" placeholder="L / ml" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Cap</Label>
                <Input className="h-8 text-xs" placeholder="200" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Alert</Label>
                <Input className="h-8 text-xs" placeholder="20" type="number" value={low} onChange={(e) => setLow(e.target.value)} />
              </div>
            </div>

            <div className="mt-3 flex flex-col md:flex-row gap-3 items-end">
              {(type === "chemical" || type === "chemical_flow") && (
                <div className="flex-1 space-y-1 w-full">
                  <Label className="text-[10px]">Chemical Grouping (optional)</Label>
                  <Input className="h-8 text-xs" placeholder="e.g. Blue Soap" value={group} onChange={(e) => setGroup(e.target.value)} />
                </div>
              )}
              <Button
                size="sm"
                className="h-8 px-4 font-bold text-[11px]"
                onClick={async () => {
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
                  setName(""); setDeviceKey(""); setCapacity(""); setLow(""); setGroup("");
                }}
              ><Plus className="h-3.5 w-3.5 mr-1" /> Add Sensor</Button>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/80">Active ESP32 Access Keys</h4>
            <Button size="sm" variant="outline" onClick={onGenerateKey} className="h-7 text-[10px] font-bold uppercase border-dashed"><KeyRound className="h-3 w-3 mr-1.5" /> New Key</Button>
          </div>

          <div className="grid gap-2">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between rounded-md border border-border/60 px-4 py-2.5 bg-muted/10">
                <div className="flex items-center gap-4">
                  <div className="font-mono text-[11px] bg-background border border-border px-2 py-0.5 rounded font-bold shadow-sm">
                    {k.key_prefix}••••••••
                  </div>
                  {k.revoked ? (
                    <span className="text-[9px] font-bold uppercase text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">Revoked</span>
                  ) : (
                    <span className="text-[9px] font-bold uppercase text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">Active</span>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    {k.last_used_at ? `Activity: ${new Date(k.last_used_at).toLocaleDateString()}` : "Not used"}
                  </div>
                </div>
                {!k.revoked && (
                  <Button variant="ghost" size="sm" onClick={() => onRevokeKey(k.id)} className="h-7 text-[10px] font-bold text-destructive hover:bg-destructive/10 uppercase tracking-wider">Deactivate</Button>
                )}
              </div>
            ))}

            {keys.length === 0 && (
              <p className="text-xs text-muted-foreground italic text-center py-4 bg-muted/10 rounded-lg">No security keys active. Generate one to start streaming data.</p>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-border/60">
          <ReportSettings site={site} onSaved={() => { /* parent will refetch on next mount */ }} />
        </div>
      </div>
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
    if (bad) { setSaving(false); return toast.error(`Invalid email address: ${bad}`); }
    const { error } = await supabase.from("sites").update({
      report_hour: hour, timezone: tz, report_recipients: list,
      daily_report_enabled: daily, monthly_report_enabled: monthly,
    }).eq("id", site.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Automated report settings saved");
    onSaved();
  };

  const sendTest = async () => {
    setSending(true);
    try {
      const res = await fetch(`/api/public/hooks/send-reports?force=${site.id}`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Network error");
      toast.success("Test report dispatched successfully!");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to send test report");
    } finally { setSending(false); }
  };

  return (
    <div className="rounded-xl border border-border/50 bg-primary/5 p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-primary/20 flex items-center justify-center">
            <Mail className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h4 className="text-sm font-bold uppercase tracking-widest text-primary/80">Automated Site Reports</h4>
            <p className="text-[10px] text-muted-foreground mt-0.5">Scheduled email analytics for site performance.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={sendTest} disabled={sending} className="h-8 text-xs font-bold bg-background">
            {sending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Send className="mr-2 h-3 w-3" />}
            Instant Test
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="h-8 text-xs font-bold">
            {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
            Save Schedule
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Scheduled Send Time</Label>
          <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
            <SelectTrigger className="h-9 bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }).map((_, i) => (
                <SelectItem key={i} value={String(i)}>{String(i).padStart(2, "0")}:00 (Site Local)</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Site Timezone</Label>
          <Input className="h-9 bg-background" value={tz} onChange={(e) => setTz(e.target.value)} placeholder="e.g. Africa/Johannesburg" />
        </div>
        <div className="sm:col-span-2 space-y-2">
          <Label className="text-xs font-semibold">Delivery Recipients</Label>
          <Textarea className="min-h-[80px] bg-background text-sm" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="manager@wash.com, ops@wash.com" />
          <p className="text-[10px] text-muted-foreground/70 px-1">Multiple addresses supported. Separate with commas.</p>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-primary/10 bg-background px-4 py-3">
          <div className="space-y-0.5">
            <span className="text-xs font-bold">Daily Intelligence</span>
            <p className="text-[9px] text-muted-foreground">Every morning at {String(hour).padStart(2, "0")}:00</p>
          </div>
          <Switch checked={daily} onCheckedChange={setDaily} />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-primary/10 bg-background px-4 py-3">
          <div className="space-y-0.5">
            <span className="text-xs font-bold">Monthly CSV Analytics</span>
            <p className="text-[9px] text-muted-foreground">Full site data on the 1st of every month.</p>
          </div>
          <Switch checked={monthly} onCheckedChange={setMonthly} />
        </div>
      </div>
    </div>
  );
}

function buildEsp32Sketch(site: Site, meters: Meter[]) {
  const endpoint = `${typeof window !== "undefined" ? window.location.origin : "https://your-deployment-url.com"}/api/public/ingest`;
  const meterLines = meters
    .map((m) => `  // ${m.name} (${m.meter_type}) — device_key: ${m.device_key}`)
    .join("\n");
  const varDecls = meters
    .map((m) => `float v_${m.device_key.replace(/[^a-zA-Z0-9]/g, "_")} = 0; // ${m.name}`)
    .join("\n");
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
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-4 overflow-hidden shadow-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            ESP32 Configuration Script — {site?.name}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground shrink-0 leading-relaxed">
          Copy the code below into the Arduino IDE. Ensure you have the <strong>ESP32 Board Library</strong> installed. Wire your pulse counters or level sensors to the designated GPIO pins and map them to the <code>TODO</code> variables at the bottom of the sketch.
        </p>
        <div className="flex-1 relative overflow-hidden rounded-lg border border-border bg-black/5">
          <Textarea readOnly value={code} className="font-mono text-[11px] h-full w-full resize-none bg-transparent p-6 leading-relaxed" spellCheck={false} />
          <Button
            size="sm"
            className="absolute right-4 top-4 shadow-lg h-8 px-4 font-bold"
            onClick={() => { navigator.clipboard.writeText(code); toast.success("Sketch copied to clipboard"); }}
          >
            <Copy className="h-3.5 w-3.5 mr-2" /> Copy to Clipboard
          </Button>
        </div>
        <DialogFooter className="shrink-0 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose} className="h-9 font-semibold">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
