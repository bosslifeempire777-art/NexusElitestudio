import { AppLayout } from "@/components/layout/AppLayout";
import { useListMarketplaceListings } from "@workspace/api-client-react";
import { Card, CardContent, Badge, Button, Input } from "@/components/ui/cyber-ui";
import { Search, Download, Star, ExternalLink, Gamepad2, Cloud } from "lucide-react";

export default function Marketplace() {
  const { data: listings, isLoading } = useListMarketplaceListings();

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 border-b border-border/50 pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-glow uppercase text-accent">Nexus Exchange</h1>
            <p className="text-muted-foreground font-mono mt-2">Discover, clone, and deploy community-built constructs.</p>
          </div>
          <div className="flex w-full md:w-auto space-x-2">
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search registry..." className="pl-9" />
            </div>
            <Button className="glow-primary-hover">Publish</Button>
          </div>
        </div>

        <div className="flex space-x-2 mb-6 overflow-x-auto pb-2">
          {['ALL', 'SAAS', 'GAMES', 'AI_TOOLS', 'TEMPLATES'].map(tab => (
            <Badge key={tab} variant={tab === 'ALL' ? 'default' : 'outline'} className="cursor-pointer px-4 py-2 text-sm">
              {tab}
            </Badge>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {isLoading ? (
             Array(8).fill(0).map((_, i) => <Card key={i} className="h-72 animate-pulse bg-secondary/50" />)
          ) : (
            listings?.map(item => (
              <Card key={item.id} className="group hover:-translate-y-1 transition-all duration-300 border-border hover:border-accent/50 flex flex-col">
                {/* Fallback image if no thumbnail, using abstract game-engine image for games */}
                <div className="h-32 bg-secondary/50 relative overflow-hidden border-b border-border/50">
                  {item.category === 'game_template' ? (
                     <img src={`${import.meta.env.BASE_URL}images/game-engine.png`} alt="thumbnail" className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                      {item.category === 'saas' ? <Cloud className="w-12 h-12 text-primary/50" /> : <ExternalLink className="w-12 h-12 text-accent/50" />}
                    </div>
                  )}
                  <Badge variant="secondary" className="absolute top-2 right-2 backdrop-blur-md bg-background/80">
                    {item.category.replace('_', ' ').toUpperCase()}
                  </Badge>
                </div>
                
                <CardContent className="p-4 flex-1 flex flex-col">
                  <h3 className="font-display font-bold text-lg mb-1 truncate">{item.title}</h3>
                  <p className="text-xs font-mono text-muted-foreground mb-3 truncate">by {item.sellerName}</p>
                  
                  <div className="flex items-center space-x-4 mb-4 text-xs font-mono text-muted-foreground">
                    <span className="flex items-center"><Star className="w-3 h-3 text-yellow-500 mr-1" /> {item.rating.toFixed(1)}</span>
                    <span className="flex items-center"><Download className="w-3 h-3 text-primary mr-1" /> {item.downloads}</span>
                  </div>
                  
                  <div className="mt-auto flex items-center justify-between pt-4 border-t border-border/30">
                    <span className="font-display font-bold text-accent">
                      {item.isFree ? 'FREE' : `$${item.price}`}
                    </span>
                    <Button size="sm" variant="outline" className="border-accent text-accent hover:bg-accent/10">Clone</Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </AppLayout>
  );
}
