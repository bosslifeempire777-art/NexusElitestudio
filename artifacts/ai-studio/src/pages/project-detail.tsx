import { useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetProject, useGetProjectBuildLogs, useGetProjectFiles } from "@workspace/api-client-react";
import { Badge, Button } from "@/components/ui/cyber-ui";
import { Terminal, Folder, FileCode2, Play, AlertCircle, CheckCircle2, ChevronRight, Loader2, StopCircle } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";

export default function ProjectDetail() {
  const { id } = useParams();
  const { data: project, isLoading } = useGetProject(id || "");
  const { data: logs } = useGetProjectBuildLogs(id || "");
  const { data: files } = useGetProjectFiles(id || "");

  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('preview');
  const [selectedFile, setSelectedFile] = useState<string | null>("src/App.tsx");

  if (isLoading) return <AppLayout><div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></AppLayout>;
  if (!project) return <AppLayout><div className="text-center mt-20 text-destructive font-mono">CONSTRUCT NOT FOUND</div></AppLayout>;

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-6rem)] -m-6">
        {/* Header Bar */}
        <div className="h-14 border-b border-border/50 bg-secondary/30 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center space-x-4">
            <h2 className="font-display font-bold text-lg text-glow">{project.name}</h2>
            <Badge variant={project.status === 'building' ? 'default' : 'outline'} className="animate-in">
              {project.status === 'building' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              {project.status.toUpperCase()}
            </Badge>
          </div>
          <div className="flex space-x-2 bg-background p-1 border border-border cyber-clip">
            <Button size="sm" variant={activeTab === 'editor' ? 'default' : 'ghost'} onClick={() => setActiveTab('editor')} className="h-8">Code</Button>
            <Button size="sm" variant={activeTab === 'preview' ? 'accent' : 'ghost'} onClick={() => setActiveTab('preview')} className="h-8">Live Preview</Button>
          </div>
          <div className="flex items-center space-x-2">
             <Button size="sm" variant="outline" className="text-destructive border-destructive/50 hover:bg-destructive/10"><StopCircle className="w-4 h-4 mr-1"/> Halt</Button>
             <Button size="sm" className="glow-primary-hover"><Play className="w-4 h-4 mr-1"/> Deploy</Button>
          </div>
        </div>

        {/* 3-Pane Layout */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left: File Tree */}
          <div className="w-64 border-r border-border/50 bg-background/50 flex flex-col shrink-0">
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

          {/* Center: Editor / Preview */}
          <div className="flex-1 flex flex-col bg-secondary/10 relative overflow-hidden">
            {activeTab === 'editor' ? (
              <>
                <div className="h-8 border-b border-border/30 flex items-center px-4 bg-background/80 font-mono text-xs text-muted-foreground">
                  {selectedFile || "No file selected"}
                </div>
                {/* Mock Code Editor using Textarea for requested simplicity */}
                <textarea 
                  className="flex-1 w-full bg-transparent p-4 font-mono text-sm text-[#E0E2EA] resize-none outline-none selection:bg-primary/30"
                  spellCheck={false}
                  defaultValue={MOCK_CODE}
                  readOnly
                />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-background relative">
                 <div className="absolute inset-4 border-2 border-dashed border-primary/20 rounded-lg flex items-center justify-center flex-col text-muted-foreground font-mono">
                    <Play className="w-12 h-12 text-primary/40 mb-4" />
                    Preview Env: {project.deployedUrl || 'localhost:3000'}
                 </div>
              </div>
            )}
          </div>

          {/* Right: Agent Logs */}
          <div className="w-80 border-l border-border/50 bg-background/50 flex flex-col shrink-0">
             <div className="p-2 border-b border-border/30 text-xs font-mono text-accent uppercase tracking-wider flex items-center">
              <Terminal className="w-3 h-3 mr-2" /> Swarm Logs
            </div>
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
              {/* Fake animated typing log for effect */}
              {project.status === 'building' && (
                <div className="border-l-2 border-primary pl-2 pb-2 animate-pulse">
                  <div className="flex justify-between items-center text-[10px] text-muted-foreground mb-1">
                    <span className="text-primary">System</span>
                  </div>
                  <div className="text-primary">_</div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </AppLayout>
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
  switch(level) {
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
