import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  GitBranch,
  MessageSquareCode,
  FileText,
  FileBarChart2,
  Sparkles,
  Github,
  Users,
  Code2,
  Database,
  ShieldCheck,
  BookOpen,
} from "lucide-react";

const items = [
  { title: "Dashboard", to: "/", icon: LayoutDashboard },
  { title: "Repository", to: "/repository", icon: GitBranch },
  { title: "Editor", to: "/editor", icon: Code2 },
  { title: "Team Chat", to: "/team", icon: Users },
  { title: "AI Chat", to: "/chat", icon: MessageSquareCode },
  { title: "Repo Chat", to: "/repo-chat", icon: Database },
  { title: "Docs", to: "/docs", icon: FileText },
  { title: "Reports", to: "/reports", icon: FileBarChart2 },
  { title: "Access", to: "/access", icon: ShieldCheck },
  { title: "Guide", to: "/guide", icon: BookOpen },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
      <div className="flex items-center gap-2 px-5 h-16 border-b border-sidebar-border">
        <div className="relative h-8 w-8 rounded-lg flex items-center justify-center"
             style={{ background: "var(--gradient-primary)" }}>
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-display font-semibold text-sm">Cortex</span>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">dev intelligence</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        <p className="px-3 pb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Workspace</p>
        {items.map((item) => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-primary/30"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <item.icon className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
              <span>{item.title}</span>
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary animate-pulse-glow" />}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 m-3 rounded-lg glass">
        <div className="flex items-center gap-2 mb-2">
          <Github className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium">Connect GitHub</span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug mb-2">
          Paste any public repo to analyze instantly.
        </p>
        <Link to="/repository" className="text-[11px] text-primary hover:underline">Open repo viewer →</Link>
      </div>
    </aside>
  );
}