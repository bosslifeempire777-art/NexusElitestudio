import { useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetProject, useGetProjectBuildLogs, useGetProjectFiles } from "@workspace/api-client-react";
import { Badge, Button } from "@/components/ui/cyber-ui";
import { Terminal, Folder, FileCode2, Play, ChevronRight, Loader2, StopCircle, ExternalLink, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";

export default function ProjectDetail() {
  const { id } = useParams();
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

  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('preview');
  const [selectedFile, setSelectedFile] = useState<string | null>("src/App.tsx");
  const [logsOpen, setLogsOpen] = useState(false);

  if (isLoading) return <AppLayout><div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></AppLayout>;
  if (!project) return <AppLayout><div className="text-center mt-20 text-destructive font-mono">CONSTRUCT NOT FOUND</div></AppLayout>;

  const previewUrl = `/api/projects/${project.id}/preview`;

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-6rem)] -m-6">

        {/* Header Bar */}
        <div className="h-14 border-b border-border/50 bg-secondary/30 flex items-center justify-between px-4 shrink-0 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="font-display font-bold text-base text-glow truncate">{project.name}</h2>
            <Badge variant={project.status === 'building' ? 'default' : 'outline'} className="shrink-0">
              {project.status === 'building' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              {project.status.toUpperCase()}
            </Badge>
          </div>

          <div className="flex bg-background border border-border cyber-clip shrink-0">
            <Button size="sm" variant={activeTab === 'editor' ? 'default' : 'ghost'} onClick={() => setActiveTab('editor')} className="h-8 rounded-none">Code</Button>
            <Button size="sm" variant={activeTab === 'preview' ? 'accent' : 'ghost'} onClick={() => setActiveTab('preview')} className="h-8 rounded-none">Live Preview</Button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeTab === 'preview' && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setLogsOpen(!logsOpen)} className="h-8 gap-1">
                  {logsOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
                  <span className="hidden sm:inline">Logs</span>
                </Button>
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline" className="h-8 gap-1">
                    <ExternalLink className="w-4 h-4" />
                    <span className="hidden sm:inline">Open</span>
                  </Button>
                </a>
              </>
            )}
            <Button size="sm" variant="outline" className="h-8 text-destructive border-destructive/50 hover:bg-destructive/10 gap-1">
              <StopCircle className="w-4 h-4" />
            </Button>
            <Button size="sm" className="h-8 glow-primary-hover gap-1">
              <Play className="w-4 h-4" />
              <span className="hidden sm:inline">Deploy</span>
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">

          {/* ── CODE TAB ── 3-pane layout */}
          {activeTab === 'editor' && (
            <>
              {/* File Explorer */}
              <div className="w-56 border-r border-border/50 bg-background/50 flex flex-col shrink-0">
                <div className="p-2 border-b border-border/30 text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center">
                  <Folder className="w-3 h-3 mr-2 text-primary" /> Explorer
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  <FileTreeNode name="src" type="directory" expanded>
                    <FileTreeNode name="components" type="directory" />
                    <FileTreeNode name="pages" type="directory" />
                    <FileTreeNode name="App.tsx" type="file" active={selectedFile === 'src/App.tsx'} onClick={() => setSelectedFile('src/App.tsx')} />
                    <FileTreeNode name="index.css" type="file" active={selectedFile === 'src/index.css'} onClick={() => setSelectedFile('src/index.css')} />
                  </FileTreeNode>
                  <FileTreeNode name="package.json" type="file" />
                  <FileTreeNode name="vite.config.ts" type="file" />
                </div>
              </div>

              {/* Code Editor */}
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

              {/* Swarm Logs (always shown in code tab) */}
              <div className="w-72 border-l border-border/50 bg-background/50 flex flex-col shrink-0">
                <LogsPanel logs={logs} isBuilding={project.status === 'building'} />
              </div>
            </>
          )}

          {/* ── PREVIEW TAB ── full-width with optional slide-in logs */}
          {activeTab === 'preview' && (
            <div className="flex-1 flex overflow-hidden relative">

              {/* Preview area - takes full width */}
              <div className="flex-1 flex flex-col bg-black overflow-hidden">
                {project.status === 'building' ? (
                  <div className="flex-1 flex items-center justify-center flex-col gap-6 text-muted-foreground font-mono p-8">
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
                ) : (
                  <iframe
                    key={project.id}
                    src={previewUrl}
                    className="flex-1 w-full border-0"
                    title={`Preview: ${project.name}`}
                    sandbox="allow-scripts"
                    style={{ minHeight: 0 }}
                  />
                )}
              </div>

              {/* Slide-in Swarm Logs panel */}
              {logsOpen && (
                <div className="w-80 border-l border-border/50 bg-background/95 flex flex-col shrink-0 absolute right-0 top-0 bottom-0 z-10 shadow-2xl">
                  <div className="p-2 border-b border-border/30 flex items-center justify-between">
                    <span className="text-xs font-mono text-accent uppercase tracking-wider flex items-center gap-2">
                      <Terminal className="w-3 h-3" /> Swarm Logs
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setLogsOpen(false)} className="h-6 w-6 p-0">×</Button>
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
          <div className="flex justify-between items-center text-[10px] text-muted-foreground mb-1">
            <span className="text-primary">System</span>
          </div>
          <div className="text-primary">_</div>
        </div>
      )}
    </div>
  );
}

function FileTreeNode({ name, type, expanded = false, active = false, children, onClick }: any) {
  return (
    <div className="font-mono text-sm">
      <div
        className={`flex items-center py-1 px-2 cursor-pointer hover:bg-secondary/50 rounded-sm ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
        onClick={onClick}
      >
        {type === 'directory' ? (
          <ChevronRight className={`w-3 h-3 mr-1 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        ) : (
          <FileCode2 className="w-3 h-3 mr-1 ml-4" />
        )}
        {name}
      </div>
      {expanded && children && (
        <div className="ml-3 border-l border-border/30 pl-1">
          {children}
        </div>
      )}
    </div>
  );
}

function getLogLevelColor(level: string) {
  switch (level) {
    case 'error': return 'hsl(var(--destructive))';
    case 'warn': return 'hsl(var(--chart-5))';
    case 'success': return 'hsl(var(--chart-4))';
    default: return 'hsl(var(--primary))';
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
