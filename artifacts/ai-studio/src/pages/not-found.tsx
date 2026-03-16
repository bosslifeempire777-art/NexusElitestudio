import { Link } from "wouter";
import { Button } from "@/components/ui/cyber-ui";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-secondary/50 via-background to-background">
      <div className="text-center max-w-md p-8 glass-panel cyber-clip border-destructive/50">
        <AlertCircle className="w-16 h-16 text-destructive mx-auto mb-6 animate-pulse" />
        <h1 className="text-4xl font-display font-bold text-destructive mb-2">ERROR 404</h1>
        <p className="font-mono text-muted-foreground mb-8">
          The requested coordinate does not exist in the mainframe registry. Sector unmapped.
        </p>
        <Button variant="destructive" asChild className="w-full">
          <Link href="/">Return to Nexus</Link>
        </Button>
      </div>
    </div>
  );
}
