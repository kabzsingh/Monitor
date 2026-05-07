import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Activity, LayoutDashboard, Settings, LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({ component: AuthLayout });

function AuthLayout() {
  const { session, loading, isAdmin, signOut, user } = useAuth();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !session) nav({ to: "/login" });
  }, [loading, session, nav]);

  if (loading || !session) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <Link to="/dashboard" className="flex items-center gap-2 shrink-0">
            <div className="h-8 w-8 rounded-lg bg-gradient-primary shadow-glow grid place-items-center">
              <Activity className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold tracking-tight hidden sm:inline">WashGrid</span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link to="/dashboard">
              <Button variant={path === "/dashboard" ? "secondary" : "ghost"} size="sm">
                <LayoutDashboard className="h-4 w-4" /> <span className="hidden sm:inline ml-1">Sites</span>
              </Button>
            </Link>
            {isAdmin && (
              <Link to="/admin">
                <Button variant={path.startsWith("/admin") ? "secondary" : "ghost"} size="sm">
                  <Settings className="h-4 w-4" /> <span className="hidden sm:inline ml-1">Admin</span>
                </Button>
              </Link>
            )}
          </nav>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden md:inline">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={() => { signOut(); nav({ to: "/" }); }}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 md:px-6 py-6 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}
