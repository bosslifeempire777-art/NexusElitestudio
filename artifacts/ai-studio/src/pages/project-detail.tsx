import { useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetProject, useGetProjectBuildLogs, useGetProjectFiles } from "@workspace/api-client-react";
import { Badge, Button } from "@/components/ui/cyber-ui";
import {
  Terminal, Folder, FileCode2, Play, ChevronRight, Loader2, StopCircle,
  ExternalLink, PanelRightClose, PanelRightOpen, Monitor, Tablet, Smartphone, RotateCcw
} from "lucide-react";
import { useState, useRef } from "react";
import { format } from "date-fns";

type Device = 'mobile' | 'tablet' | 'desktop';

const DEVICES: { id: Device; label: string; icon: typeof Monitor; width: number | null; height: number | null }[] = [
  { id: 'mobile',  label: 'Phone',   icon: Smartphone, width: 390,  height: 844  },
  { id: 'tablet',  label: 'Tablet',  icon: Tablet,     width: 768,  height: 1024 },
  { id: 'desktop', label: 'Desktop', icon: Monitor,    width: null, height: null  },
];

export default function ProjectDetail() {
  const { id } = useParams();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { data: project, isLoading } = useGetProject(id || "", {
    query: {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'building' ? 2000 : false;
      },
    },
  });
  const { data: logs } = useGetProjectBuildLogs(id || "", {
    query: {
      refetchInterval: project?.status === 'building' ? 2000 : false,
    },
  });
  const { data: files } = useGetProjectFiles(id || "");

  const [activeTab, setActiveTab]     = useState<'editor' | 'preview'>('preview');
  const [selectedFile, setSelectedFile] = useState<string | null>("src/App.tsx");
  const [logsOpen, setLogsOpen]       = useState(false);
  const [device, setDevice]           = useState<Device>('desktop');

  if (isLoading) return (
    <AppLayout>
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    </AppLayout>
  );
  if (!project) return (
    <AppLayout>
      <div className="text-center mt-20 text-destructive font-mono">CONSTRUCT NOT FOUND</div>
    </AppLayout>
  );

  const previewUrl   = `/api/projects/${project.id}/preview`;
  const currentDevice = DEVICES.find(d => d.id === device)!;

  const refreshPreview = () => {
    if (iframeRef.current) {
      iframeRef.current.src = previewUrl;
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-6rem)] -m-6">

        {/* ── Top Header ── */}
        <div className="border-b border-border/50 bg-secondary/30 px-4 py-2 shrink-0 flex flex-col gap-2">

          {/* Row 1: project name + tab toggle + action buttons */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="font-display font-bold text-sm text-glow truncate">{project.name}</h2>
              <Badge variant={project.status === 'building' ? 'default' : 'outline'} className="shrink-0 text-[10px]">
                {project.status === 'building' && <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />}
                {project.status.toUpperCase()}
              </Badge>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Code / Live Preview toggle */}
              <div className="flex bg-background border border-border cyber-clip">
                <Button size="sm" variant={activeTab === 'editor'  ? 'default' : 'ghost'} onClick={() => setActiveTab('editor')}  className="h-7 px-3 text-xs rounded-none">Code</Button>
                <Button size="sm" variant={activeTab === 'preview' ? 'accent'  : 'ghost'} onClick={() => setActiveTab('preview')} className="h-7 px-3 text-xs rounded-none">Live Preview</Button>
              </div>

              <Button size="sm" variant="outline" className="h-7 text-destructive border-destructive/50 hover:bg-destructive/10 px-2">
                <StopCircle className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" className="h-7 px-3 text-xs glow-primary-hover gap-1">
                <Play className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Deploy</span>
              </Button>
            </div>
          </div>

          {/* Row 2: device + preview controls (only when preview tab active) */}
          {activeTab === 'preview' && (
            <div className="flex items-center justify-between gap-2 flex-wrap">

              {/* Device picker */}
              <div className="flex items-center gap-1 bg-background/60 border border-border/50 rounded p-0.5">
                {DEVICES.map(d => {
                  const Icon = d.icon;
                  return (
                    <button
                      key={d.id}
                      onClick={() => setDevice(d.id)}
                      title={d.label + (d.width ? ` (${d.width}px)` : '')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono transition-all ${
                        device === d.id
                          ? 'bg-primary text-background font-semibold'
                          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{d.label}</span>
                      {d.width && <span className="hidden md:inline opacity-60 text-[10px]">{d.width}px</span>}
                    </button>
                  );
                })}
              </div>

              {/* Right side utilities */}
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={refreshPreview} title="Refresh preview" className="h-7 px-2 gap-1">
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-xs">Refresh</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setLogsOpen(!logsOpen)} className="h-7 px-2 gap-1">
                  {logsOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline text-xs">Logs</span>
                </Button>
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline" className="h-7 px-2 gap-1">
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline text-xs">Open</span>
                  </Button>
                </a>
              </div>
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div className="flex-1 flex overflow-hidden">

          {/* CODE TAB — 3-pane */}
          {activeTab === 'editor' && (
            <>
              <div className="w-52 border-r border-border/50 bg-background/50 flex flex-col shrink-0">
                <div className="p-2 border-b border-border/30 text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center">
                  <Folder className="w-3 h-3 mr-2 text-primary" /> Explorer
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  <FileTreeNode name="src" type="directory" expanded>
                    <FileTreeNode name="components" type="directory" />
                    <FileTreeNode name="pages" type="directory" />
                    <FileTreeNode name="App.tsx"    type="file" active={selectedFile === 'src/App.tsx'}    onClick={() => setSelectedFile('src/App.tsx')} />
                    <FileTreeNode name="index.css"  type="file" active={selectedFile === 'src/index.css'}  onClick={() => setSelectedFile('src/index.css')} />
                  </FileTreeNode>
                  <FileTreeNode name="package.json"   type="file" />
                  <FileTreeNode name="vite.config.ts" type="file" />
                </div>
              </div>

              <div className="flex-1 flex flex-col bg-secondary/10 overflow-hidden">
                <div className="h-8 border-b border-border/30 flex items-center px-4 bg-background/80 font-mono text-xs text-muted-foreground">
                  {selectedFile || "No file selected"}
                </div>
                <textarea
                  className="flex-1 w-full bg-transparent p-4 font-mono text-sm text-[#E0E2EA] resize-none outline-none selection:bg-primary/30"
                  spellCheck={false}
                  defaultValue={MOCK_CODE}
                  readOnly
                />
              </div>

              <div className="w-72 border-l border-border/50 bg-background/50 flex flex-col shrink-0">
                <LogsPanel logs={logs} isBuilding={project.status === 'building'} />
              </div>
            </>
          )}

          {/* PREVIEW TAB — full-width with device framing */}
          {activeTab === 'preview' && (
            <div className="flex-1 flex overflow-hidden relative">

              {/* Preview canvas */}
              <div className="flex-1 flex flex-col items-center overflow-auto bg-[#0a0a0f]">
                {project.status === 'building' ? (
                  <BuildingState logs={logs} />
                ) : (
                  <DeviceFrame device={currentDevice}>
                    <iframe
                      ref={iframeRef}
                      key={project.id}
                      src={previewUrl}
                      className="w-full h-full border-0 block"
                      title={`Preview: ${project.name}`}
                      sandbox="allow-scripts"
                    />
                  </DeviceFrame>
                )}
              </div>

              {/* Slide-in Swarm Logs */}
              {logsOpen && (
                <div className="w-72 border-l border-border/50 bg-background/95 flex flex-col shrink-0 z-10 shadow-2xl">
                  <div className="p-2 border-b border-border/30 flex items-center justify-between">
                    <span className="text-xs font-mono text-accent uppercase tracking-wider flex items-center gap-1.5">
                      <Terminal className="w-3 h-3" /> Swarm Logs
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setLogsOpen(false)} className="h-6 w-6 p-0 text-muted-foreground">×</Button>
                  </div>
                  <LogsPanel logs={logs} isBuilding={project.status === 'building'} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

/* ── Device frame wrapper ── */
function DeviceFrame({
  device,
  children,
}: {
  device: typeof DEVICES[number];
  children: React.ReactNode;
}) {
  if (!device.width) {
    return <div className="flex-1 w-full h-full">{children}</div>;
  }

  const isPhone  = device.id === 'mobile';
  const isTablet = device.id === 'tablet';

  return (
    <div className="flex flex-col items-center justify-start py-6 px-4 min-h-full w-full">
      {/* Device label */}
      <div className="text-xs font-mono text-muted-foreground/60 mb-3 tracking-widest uppercase">
        {device.label} — {device.width} × {device.height}
      </div>

      {/* Device shell */}
      <div
        className="relative flex-shrink-0 rounded-[2rem] overflow-hidden shadow-2xl"
        style={{
          width: Math.min(device.width, 600),
          border: isPhone  ? '6px solid #1e1e2e' :
                  isTablet ? '8px solid #1e1e2e' :
                             '2px solid #2d2d4e',
          borderRadius: isPhone  ? '2.5rem' :
                        isTablet ? '1.5rem' :
                                   '0.5rem',
          boxShadow: '0 0 0 1px rgba(0,212,255,0.15), 0 30px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* Phone notch */}
        {isPhone && (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-[#1e1e2e] rounded-b-2xl z-10" />
        )}

        <div style={{ height: Math.min(device.height ?? 800, 700), width: '100%', overflow: 'hidden' }}>
          {children}
        </div>

        {/* Phone home bar */}
        {isPhone && (
          <div className="flex justify-center items-center bg-[#1e1e2e] py-2">
            <div className="w-24 h-1 rounded-full bg-white/20" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Building state ── */
function BuildingState({ logs }: { logs: any[] | undefined }) {
  return (
    <div className="flex-1 flex items-center justify-center flex-col gap-6 text-muted-foreground font-mono p-8 w-full">
      <div className="relative">
        <div className="w-20 h-20 rounded-full border-2 border-primary/20 flex items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
        <div className="absolute inset-0 rounded-full border-2 border-primary/40 animate-ping" style={{ animationDuration: '2s' }} />
      </div>
      <div className="text-center space-y-2">
        <p className="text-primary text-sm font-semibold tracking-widest uppercase">Agent Swarm Active</p>
        <p className="text-xs text-muted-foreground">Building your application — preview will appear automatically when complete</p>
      </div>
      <div className="w-full max-w-sm space-y-2 bg-secondary/20 rounded p-3 border border-border/30">
        {(logs || []).slice(-5).map((log, i) => (
          <div key={i} className="text-xs font-mono text-muted-foreground/70 truncate">
            <span className="text-primary/60">&gt;</span> {log.message}
          </div>
        ))}
        <div className="flex items-center gap-2 text-xs text-primary/80 mt-1">
          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
          <span className="animate-pulse">Processing...</span>
        </div>
      </div>
    </div>
  );
}

/* ── Logs panel ── */
function LogsPanel({ logs, isBuilding }: { logs: any[] | undefined; isBuilding: boolean }) {
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-xs">
      {logs?.length ? logs.map(log => (
        <div key={log.id} className="border-l-2 pl-2 pb-2" style={{ borderColor: getLogLevelColor(log.level) }}>
          <div className="flex justify-between items-center text-[10px] text-muted-foreground mb-1">
            <span className="text-primary">{log.agentName}</span>
            <span>{format(new Date(log.timestamp), 'HH:mm:ss')}</span>
          </div>
          <div className="text-[#E0E2EA] leading-relaxed break-words">{log.message}</div>
        </div>
      )) : (
        <div className="text-muted-foreground opacity-50 italic">Waiting for agent activity...</div>
      )}
      {isBuilding && (
        <div className="border-l-2 border-primary pl-2 pb-2 animate-pulse">
          <div className="text-[10px] text-muted-foreground mb-1"><span className="text-primary">System</span></div>
          <div className="text-primary">_</div>
        </div>
      )}
    </div>
  );
}

/* ── File tree ── */
function FileTreeNode({ name, type, expanded = false, active = false, children, onClick }: any) {
  return (
    <div className="font-mono text-sm">
      <div
        className={`flex items-center py-1 px-2 cursor-pointer hover:bg-secondary/50 rounded-sm ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
        onClick={onClick}
      >
        {type === 'directory'
          ? <ChevronRight className={`w-3 h-3 mr-1 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          : <FileCode2 className="w-3 h-3 mr-1 ml-4" />}
        {name}
      </div>
      {expanded && children && (
        <div className="ml-3 border-l border-border/30 pl-1">{children}</div>
      )}
    </div>
  );
}

function getLogLevelColor(level: string) {
  switch (level) {
    case 'error':   return 'hsl(var(--destructive))';
    case 'warn':    return 'hsl(var(--chart-5))';
    case 'success': return 'hsl(var(--chart-4))';
    default:        return 'hsl(var(--primary))';
  }
}

const MOCK_CODE = `import React from 'react';

export default function App() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <h1 className="text-4xl font-bold text-cyan-400">
        Hello World
      </h1>
      <p className="mt-4">Generated by Nexus Agents</p>
    </div>
  );
}
`;
