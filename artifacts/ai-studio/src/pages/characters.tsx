import { useState, useRef, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { getToken } from "@/lib/auth";
import {
  Wand2, Upload, Save, Download, Trash2, Plus, RefreshCw, Loader2,
  Brush, Eraser, Palette, Sliders, Sparkles, ChevronDown, ChevronRight,
  ImageIcon, Gamepad2, User, X, Check, Eye, EyeOff, Layers, Zap,
} from "lucide-react";

/* ── Types ── */
interface SavedCharacter {
  id: string;
  name: string;
  gameStyle: string;
  prompt: string;
  imageUrl: string | null;
  imageData: string | null;
  imageType: string;
  notes: string | null;
  tags: string[] | null;
  createdAt: string;
}

type GameStyle = "realistic" | "anime" | "cartoon" | "pixel" | "lowpoly" | "chibi" | "comic";
type Tool = "brush" | "eraser";
type PanelTab = "generate" | "upload" | "adjust" | "edit";

/* ── Style definitions ── */
const STYLES: { id: GameStyle; label: string; emoji: string; desc: string }[] = [
  { id: "realistic", label: "Realistic",  emoji: "📷", desc: "Photo-real, cinematic" },
  { id: "anime",     label: "Anime",      emoji: "✨", desc: "Cel-shaded, vibrant" },
  { id: "cartoon",   label: "Cartoon",    emoji: "🎨", desc: "Pixar / bold outlines" },
  { id: "pixel",     label: "Pixel Art",  emoji: "👾", desc: "16-bit retro sprite" },
  { id: "lowpoly",   label: "Low Poly",   emoji: "💎", desc: "Geometric facets" },
  { id: "chibi",     label: "Chibi",      emoji: "🐱", desc: "Cute, big-head" },
  { id: "comic",     label: "Comic",      emoji: "💥", desc: "Ink outlines, halftone" },
];

/* ── AI prompt building blocks ── */
const QUICK_TRAITS = [
  "warrior", "wizard", "rogue", "healer", "archer", "robot", "alien",
  "dragon", "knight", "ninja", "pirate", "cyborg", "ghost", "witch",
  "samurai", "mechanic", "scientist", "vampire", "demon", "angel",
];
const QUICK_FEATURES = [
  "glowing eyes", "wings", "tail", "armor", "cape", "hat", "mask",
  "scars", "tattoos", "horns", "long hair", "short hair", "beard",
  "mechanical arm", "energy aura", "floating orbs", "weapon",
];

/* ── Helpers ── */
function authHeader() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function buildPollinationsUrl(prompt: string, style: GameStyle, seed?: number) {
  const suffixes: Record<GameStyle, string> = {
    realistic: ", photorealistic, detailed, 8k, cinematic lighting, professional",
    anime:     ", anime style, cel shading, vibrant colors, Studio Ghibli inspired",
    cartoon:   ", cartoon style, bold outlines, bright colors, Pixar 3D inspired",
    pixel:     ", pixel art, 16-bit sprite, retro game art, transparent background",
    lowpoly:   ", low poly art, geometric, faceted, clean minimal",
    chibi:     ", chibi style, cute, big eyes, small body, adorable, pastel",
    comic:     ", comic book style, halftone dots, bold ink outlines, dynamic pose",
  };
  const negatives: Record<GameStyle, string> = {
    realistic: "cartoon, anime, drawing, low quality",
    anime:     "realistic, photo, 3d render, low quality",
    cartoon:   "realistic, photo, low quality",
    pixel:     "photorealistic, blurry, anti-aliased, high res",
    lowpoly:   "photorealistic, detailed texture, complex",
    chibi:     "realistic, adult proportions, detailed, scary",
    comic:     "photorealistic, 3d, low quality",
  };
  const full = `game character, full body pose, white background, ${prompt}${suffixes[style]}`;
  const used = seed ?? Math.floor(Math.random() * 999999);
  return {
    url: `https://image.pollinations.ai/prompt/${encodeURIComponent(full)}?width=512&height=768&seed=${used}&nologo=true&negative=${encodeURIComponent(negatives[style])}&model=flux`,
    seed: used,
  };
}

/* ═══════════════════════════════════════════════════════════════ */
export default function Characters() {
  /* Library state */
  const [library, setLibrary]           = useState<SavedCharacter[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [selected, setSelected]         = useState<SavedCharacter | null>(null);

  /* Editor state */
  const [currentImageUrl, setCurrentImageUrl] = useState<string>("");
  const [imageLoading, setImageLoading]       = useState(false);
  const [characterName, setCharacterName]     = useState("New Character");
  const [style, setStyle]                     = useState<GameStyle>("cartoon");
  const [prompt, setPrompt]                   = useState("");
  const [activePanel, setActivePanel]         = useState<PanelTab>("generate");

  /* Adjustments */
  const [brightness, setBrightness]   = useState(100);
  const [contrast, setContrast]       = useState(100);
  const [saturation, setSaturation]   = useState(100);
  const [hue, setHue]                 = useState(0);

  /* Paint overlay */
  const [tool, setTool]               = useState<Tool>("brush");
  const [brushColor, setBrushColor]   = useState("#00d4ff");
  const [brushSize, setBrushSize]     = useState(12);
  const [painting, setPainting]       = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);

  /* AI Edit */
  const [editPrompt, setEditPrompt]   = useState("");
  const [editLoading, setEditLoading] = useState(false);

  /* Tags */
  const [tagInput, setTagInput]       = useState("");
  const [tags, setTags]               = useState<string[]>([]);

  /* Save state */
  const [saving, setSaving]           = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const overlayRef  = useRef<HTMLCanvasElement>(null);
  const imgRef      = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Load library ── */
  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const res = await fetch("/api/characters", { headers: { ...authHeader() } });
      if (res.ok) setLibrary(await res.json());
    } catch { /* ignore */ }
    finally { setLibraryLoading(false); }
  }, []);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  /* ── Draw image onto base canvas ── */
  function drawToCanvas(url: string) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = url;
  }

  useEffect(() => {
    if (currentImageUrl) {
      // Data URLs load instantly — don't set imageLoading or onLoad will have already fired
      if (!currentImageUrl.startsWith("data:")) {
        setImageLoading(true);
      }
      drawToCanvas(currentImageUrl);
    }
  }, [currentImageUrl]);

  /* ── Clear paint overlay ── */
  function clearOverlay() {
    const oc = overlayRef.current;
    if (!oc) return;
    oc.getContext("2d")?.clearRect(0, 0, oc.width, oc.height);
  }

  /* ── Paint on overlay canvas ── */
  function getPosFromXY(clientX: number, clientY: number) {
    const oc = overlayRef.current!;
    const rect = oc.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (oc.width  / rect.width),
      y: (clientY - rect.top)  * (oc.height / rect.height),
    };
  }

  function drawAt(x: number, y: number) {
    const oc = overlayRef.current;
    if (!oc) return;
    const ctx = oc.getContext("2d")!;
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    ctx.fillStyle = brushColor;
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function paint(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!painting) return;
    const { x, y } = getPosFromXY(e.clientX, e.clientY);
    drawAt(x, y);
  }

  function paintTouch(e: React.TouchEvent<HTMLCanvasElement>) {
    const touch = e.touches[0];
    if (!touch) return;
    const { x, y } = getPosFromXY(touch.clientX, touch.clientY);
    drawAt(x, y);
  }

  /* ── AI Generate ── */
  async function generateCharacter(styleOverride?: GameStyle) {
    if (!prompt.trim()) return;
    setImageLoading(true);
    const { url } = buildPollinationsUrl(prompt, styleOverride ?? style);
    setCurrentImageUrl(url);
  }

  /* ── AI Modify ── */
  async function aiEdit() {
    if (!editPrompt.trim()) return;
    setEditLoading(true);
    // If the current image was uploaded (data URL), there's no AI prompt to build on —
    // use the edit prompt alone as the character description.
    // If it was AI-generated, combine the original prompt with the modification.
    const isUploaded = currentImageUrl?.startsWith("data:");
    const newPrompt = isUploaded
      ? editPrompt.trim()
      : prompt
        ? `${prompt}, ${editPrompt.trim()}`
        : editPrompt.trim();
    const { url } = buildPollinationsUrl(newPrompt, style);
    setPrompt(newPrompt);
    setCurrentImageUrl(url);
    setEditPrompt("");
    setEditLoading(false);
  }

  /* ── Handle upload ── */
  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      // Clear any existing prompt — data URLs load instantly so we must NOT
      // rely on useEffect setting imageLoading, and we don't want "uploaded image"
      // as the prompt since it breaks AI Edit.
      setImageLoading(false);
      setCurrentImageUrl(dataUrl);
      setPrompt(""); // Keep blank so AI Edit uses the user's own description
      setActivePanel("adjust"); // Switch to Adjust panel automatically so the image is visible
    };
    reader.readAsDataURL(file);
  }

  /* ── Export merged canvas ── */
  function exportCharacter() {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas) return;

    try {
      const merged = document.createElement("canvas");
      merged.width  = canvas.width;
      merged.height = canvas.height;
      const ctx = merged.getContext("2d")!;
      ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hue}deg)`;
      ctx.drawImage(canvas, 0, 0);
      ctx.filter = "none";
      if (overlay) ctx.drawImage(overlay, 0, 0);

      // Try canvas export (may fail if image is cross-origin without CORS headers)
      const dataUrl = merged.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = `${characterName.replace(/\s+/g, "_")}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      // Canvas is tainted by cross-origin image — fall back to downloading the source URL
      if (currentImageUrl.startsWith("data:")) {
        // Data URLs can always be downloaded
        const link = document.createElement("a");
        link.download = `${characterName.replace(/\s+/g, "_")}.png`;
        link.href = currentImageUrl;
        link.click();
      } else {
        // Open the image URL in a new tab so the user can right-click → Save
        window.open(currentImageUrl, "_blank");
      }
    }
  }

  /* ── Save to library ── */
  async function saveCharacter() {
    if (!currentImageUrl) return;
    setSaving(true);
    try {
      const isDataUrl = currentImageUrl.startsWith("data:");
      const body = {
        name: characterName,
        gameStyle: style,
        prompt,
        imageUrl:  isDataUrl ? null : currentImageUrl,
        imageData: isDataUrl ? currentImageUrl : null,
        imageType: isDataUrl ? "uploaded" : "ai-generated",
        tags,
        notes: null,
      };

      let res: Response;
      if (selected) {
        res = await fetch(`/api/characters/${selected.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/characters", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(body),
        });
      }

      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
        loadLibrary();
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  /* ── Delete from library ── */
  async function deleteCharacter(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/characters/${id}`, { method: "DELETE", headers: { ...authHeader() } });
    if (selected?.id === id) { setSelected(null); setCurrentImageUrl(""); }
    loadLibrary();
  }

  /* ── Load from library ── */
  function loadCharacter(char: SavedCharacter) {
    setSelected(char);
    setCharacterName(char.name);
    setStyle(char.gameStyle as GameStyle);
    setPrompt(char.prompt);
    setTags(char.tags || []);
    const url = char.imageData || char.imageUrl || "";
    setCurrentImageUrl(url);
    clearOverlay();
    setBrightness(100); setContrast(100); setSaturation(100); setHue(0);
  }

  /* ── New character ── */
  function newCharacter() {
    setSelected(null);
    setCurrentImageUrl("");
    setCharacterName("New Character");
    setPrompt("");
    setTags([]);
    clearOverlay();
    setBrightness(100); setContrast(100); setSaturation(100); setHue(0);
  }

  /* ── Tag helpers ── */
  function addTag() {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput("");
  }

  const cssFilter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hue}deg)`;

  /* ═══════════════════ RENDER ═══════════════════ */
  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-[calc(100vh-4rem)] -m-4 md:-m-6 font-mono">

        {/* ── Top bar ── */}
        <div className="h-12 border-b border-border/50 bg-secondary/30 flex items-center px-4 gap-3 shrink-0">
          <Gamepad2 className="w-5 h-5 text-primary shrink-0" />
          <span className="font-display font-bold text-sm text-glow tracking-widest">CHARACTER CREATION PORTAL</span>
          <span className="text-muted-foreground/40 text-xs">— powered by 21-agent AI swarm</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={newCharacter}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-primary/40 text-primary hover:bg-primary/10 rounded transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New
            </button>
            <button
              onClick={saveCharacter}
              disabled={!currentImageUrl || saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-background rounded hover:brightness-110 transition-all disabled:opacity-40"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saveSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {saveSuccess ? "Saved!" : "Save"}
            </button>
            <button
              onClick={exportCharacter}
              disabled={!currentImageUrl}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border/50 text-muted-foreground hover:text-foreground hover:border-border rounded transition-colors disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" /> Export PNG
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">

          {/* ══ LEFT: Character Library ══ */}
          <aside className="w-52 border-r border-border/50 bg-background/50 hidden md:flex flex-col shrink-0 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-border/40 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Library</span>
              <span className="ml-auto text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded">{library.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {libraryLoading ? (
                <div className="flex items-center justify-center pt-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : library.length === 0 ? (
                <div className="text-center pt-8 px-3">
                  <User className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-[10px] text-muted-foreground/50">No characters saved yet. Generate or upload one!</p>
                </div>
              ) : (
                library.map(char => (
                  <div
                    key={char.id}
                    onClick={() => loadCharacter(char)}
                    className={`group relative rounded border cursor-pointer transition-all overflow-hidden ${
                      selected?.id === char.id
                        ? "border-primary/60 bg-primary/5"
                        : "border-border/30 hover:border-border/60 hover:bg-secondary/30"
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="h-24 bg-secondary/20 flex items-center justify-center overflow-hidden">
                      {char.imageData || char.imageUrl ? (
                        <img
                          src={char.imageData || char.imageUrl || ""}
                          alt={char.name}
                          className="w-full h-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <ImageIcon className="w-6 h-6 text-muted-foreground/30" />
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="text-[11px] font-semibold truncate">{char.name}</p>
                      <p className="text-[9px] text-muted-foreground/60 capitalize">{char.gameStyle}</p>
                    </div>
                    <button
                      onClick={(e) => deleteCharacter(char.id, e)}
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 w-5 h-5 rounded bg-destructive/80 text-white flex items-center justify-center transition-opacity"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>

          {/* ══ CENTER: Canvas ══ */}
          <div className="flex-1 flex flex-col bg-[#06060f] overflow-hidden">

            {/* Character name + style selector bar */}
            <div className="shrink-0 border-b border-border/40 px-4 py-2 flex items-center gap-3 flex-wrap">
              <input
                value={characterName}
                onChange={e => setCharacterName(e.target.value)}
                className="bg-transparent border-b border-primary/30 text-sm font-display font-bold text-foreground outline-none focus:border-primary w-48 pb-0.5"
                placeholder="Character name..."
              />
              <div className="flex items-center gap-1 flex-wrap">
                {STYLES.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setStyle(s.id)}
                    title={s.desc}
                    className={`px-2 py-0.5 text-[10px] rounded border transition-all ${
                      style === s.id
                        ? "border-primary/60 bg-primary/15 text-primary font-bold"
                        : "border-border/30 text-muted-foreground hover:border-border/60 hover:text-foreground"
                    }`}
                  >
                    {s.emoji} {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Paint toolbar */}
            <div className="shrink-0 border-b border-border/40 px-4 py-1.5 flex items-center gap-3">
              <button
                onClick={() => setTool("brush")}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${tool === "brush" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Brush className="w-3.5 h-3.5" /> Brush
              </button>
              <button
                onClick={() => setTool("eraser")}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${tool === "eraser" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Eraser className="w-3.5 h-3.5" /> Eraser
              </button>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Size</span>
                <input type="range" min={2} max={60} value={brushSize} onChange={e => setBrushSize(+e.target.value)} className="w-20 accent-primary" />
                <span className="w-5 text-center">{brushSize}</span>
              </div>
              <input type="color" value={brushColor} onChange={e => setBrushColor(e.target.value)} className="w-7 h-7 rounded cursor-pointer border border-border/50 bg-transparent" title="Brush color" />
              <button onClick={clearOverlay} className="ml-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 border border-border/30 rounded">
                Clear Paint
              </button>
              <button
                onClick={() => setShowOverlay(p => !p)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 border border-border/30 rounded"
              >
                {showOverlay ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                {showOverlay ? "Hide" : "Show"} Paint
              </button>
            </div>

            {/* Canvas area */}
            <div className="flex-1 flex items-center justify-center overflow-hidden relative p-4">
              {!currentImageUrl && !imageLoading && (
                <div className="text-center">
                  <div className="w-28 h-28 rounded-full bg-primary/5 border border-primary/20 flex items-center justify-center mx-auto mb-4">
                    <User className="w-12 h-12 text-primary/30" />
                  </div>
                  <p className="text-muted-foreground/50 text-sm mb-1">No character loaded</p>
                  <p className="text-muted-foreground/30 text-xs">Use the panel on the right to generate or upload a character</p>
                </div>
              )}

              {imageLoading && !currentImageUrl?.startsWith("data:") && (
                <div className="absolute inset-0 flex items-center justify-center z-20 bg-[#06060f]/80 backdrop-blur-sm">
                  <div className="text-center">
                    <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-3" />
                    <p className="text-primary/70 text-sm font-mono animate-pulse">AI generating character…</p>
                    <p className="text-muted-foreground/40 text-xs mt-1">This may take 5–15 seconds</p>
                  </div>
                </div>
              )}

              {currentImageUrl && (
                <div className="relative" style={{ maxHeight: "calc(100% - 16px)", maxWidth: "100%" }}>
                  {/* Hidden real image for canvas draw */}
                  <img
                    ref={imgRef}
                    src={currentImageUrl}
                    crossOrigin="anonymous"
                    onLoad={() => setImageLoading(false)}
                    onError={() => setImageLoading(false)}
                    className="hidden"
                    alt=""
                  />
                  <div className="relative rounded-lg overflow-hidden border border-primary/20 shadow-[0_0_40px_rgba(0,212,255,0.1)]">
                    {/* Base image with CSS filter adjustments */}
                    <img
                      src={currentImageUrl}
                      crossOrigin="anonymous"
                      alt={characterName}
                      onLoad={() => setImageLoading(false)}
                      onError={() => setImageLoading(false)}
                      className="block"
                      style={{
                        maxHeight: "calc(100vh - 280px)",
                        maxWidth: "100%",
                        filter: cssFilter,
                        display: "block",
                      }}
                    />
                    {/* Paint overlay canvas */}
                    {showOverlay && (
                      <canvas
                        ref={overlayRef}
                        width={512}
                        height={768}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          cursor: tool === "brush" ? "crosshair" : "cell",
                          touchAction: "none",
                        }}
                        onMouseDown={(e) => { setPainting(true); paint(e); }}
                        onMouseMove={paint}
                        onMouseUp={() => setPainting(false)}
                        onMouseLeave={() => setPainting(false)}
                        onTouchStart={(e) => { e.preventDefault(); setPainting(true); paintTouch(e); }}
                        onTouchMove={(e) => { e.preventDefault(); paintTouch(e); }}
                        onTouchEnd={() => setPainting(false)}
                        onTouchCancel={() => setPainting(false)}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Hidden base canvas for export */}
            <canvas ref={canvasRef} width={512} height={768} className="hidden" />
          </div>

          {/* ══ RIGHT: Tools Panel ══ */}
          <aside className="w-80 border-l border-border/50 bg-background/50 hidden md:flex flex-col shrink-0 overflow-hidden">

            {/* Tab selector */}
            <div className="grid grid-cols-4 border-b border-border/40 shrink-0">
              {([
                { id: "generate", icon: Wand2,    label: "AI Gen" },
                { id: "upload",   icon: Upload,   label: "Upload" },
                { id: "adjust",   icon: Sliders,  label: "Adjust" },
                { id: "edit",     icon: Sparkles, label: "AI Edit" },
              ] as { id: PanelTab; icon: React.ComponentType<{ className?: string }>; label: string }[]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActivePanel(tab.id)}
                  className={`flex flex-col items-center py-2 text-[9px] uppercase tracking-wider transition-colors border-b-2 ${
                    activePanel === tab.id
                      ? "border-primary text-primary bg-primary/5"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <tab.icon className="w-3.5 h-3.5 mb-0.5" />
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">

              {/* ── GENERATE TAB ── */}
              {activePanel === "generate" && (
                <div className="p-4 space-y-4">
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1.5 block">Describe your character</label>
                    <textarea
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      rows={4}
                      placeholder={`e.g. "fierce female warrior with glowing blue eyes and silver armor"`}
                      className="w-full bg-secondary/20 border border-border/50 rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 resize-none"
                    />
                  </div>

                  {/* Quick trait chips */}
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2">Quick Traits</p>
                    <div className="flex flex-wrap gap-1">
                      {QUICK_TRAITS.map(t => (
                        <button
                          key={t}
                          onClick={() => setPrompt(p => p ? `${p}, ${t}` : t)}
                          className="px-2 py-0.5 text-[10px] border border-border/30 rounded text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quick feature chips */}
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2">Features & Details</p>
                    <div className="flex flex-wrap gap-1">
                      {QUICK_FEATURES.map(f => (
                        <button
                          key={f}
                          onClick={() => setPrompt(p => p ? `${p}, ${f}` : f)}
                          className="px-2 py-0.5 text-[10px] border border-border/30 rounded text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Style reminder */}
                  <div className="bg-primary/5 border border-primary/20 rounded p-2.5">
                    <p className="text-[10px] text-primary/80 mb-0.5">Style: <strong>{STYLES.find(s => s.id === style)?.emoji} {STYLES.find(s => s.id === style)?.label}</strong></p>
                    <p className="text-[9px] text-muted-foreground/60">{STYLES.find(s => s.id === style)?.desc} — change style above the canvas</p>
                  </div>

                  <button
                    onClick={generateCharacter}
                    disabled={!prompt.trim() || imageLoading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-background text-sm font-bold rounded hover:brightness-110 transition-all disabled:opacity-40"
                  >
                    {imageLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    {imageLoading ? "Generating…" : "Generate Character"}
                  </button>

                  {currentImageUrl && (
                    <button
                      onClick={() => generateCharacter()}
                      disabled={imageLoading || !prompt.trim()}
                      title={!prompt.trim() ? "Enter a description above to regenerate" : "Regenerate with a new random variation"}
                      className="w-full flex items-center justify-center gap-2 py-2 border border-border/50 text-muted-foreground text-xs rounded hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Regenerate (new variation)
                    </button>
                  )}

                  {/* Tags */}
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2">Tags</p>
                    <div className="flex gap-1.5 mb-2 flex-wrap">
                      {tags.map(t => (
                        <span key={t} className="flex items-center gap-1 px-2 py-0.5 bg-secondary/40 border border-border/30 rounded text-[10px] text-foreground">
                          {t}
                          <button onClick={() => setTags(prev => prev.filter(x => x !== t))} className="text-muted-foreground hover:text-destructive">
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        value={tagInput}
                        onChange={e => setTagInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addTag()}
                        placeholder="Add tag…"
                        className="flex-1 bg-secondary/20 border border-border/30 rounded px-2 py-1 text-xs outline-none focus:border-primary/40"
                      />
                      <button onClick={addTag} className="px-2 py-1 border border-border/30 rounded text-xs text-muted-foreground hover:text-primary transition-colors">+</button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── UPLOAD TAB ── */}
              {activePanel === "upload" && (
                <div className="p-4 space-y-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-3">Upload your own image as a base — then use AI Edit or the brush tools to customize it.</p>
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex flex-col items-center justify-center gap-3 py-10 border-2 border-dashed border-border/40 rounded-lg hover:border-primary/40 hover:bg-primary/5 transition-all text-muted-foreground hover:text-primary"
                    >
                      <Upload className="w-8 h-8" />
                      <div className="text-center">
                        <p className="text-sm font-medium">Click to upload</p>
                        <p className="text-xs text-muted-foreground/60 mt-0.5">PNG, JPG, WEBP — any size</p>
                      </div>
                    </button>
                  </div>
                  <div className="border border-border/30 rounded p-3 space-y-1.5">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Tips</p>
                    <p className="text-[10px] text-muted-foreground/70">• Works best with characters on a plain / white background</p>
                    <p className="text-[10px] text-muted-foreground/70">• Use AI Edit to change style, add details, or modify the image with AI</p>
                    <p className="text-[10px] text-muted-foreground/70">• Use Brush tool to paint on top manually</p>
                    <p className="text-[10px] text-muted-foreground/70">• Use Adjust sliders to change colors and mood</p>
                  </div>
                  {currentImageUrl && (
                    <div className="text-center text-xs text-green-400 flex items-center justify-center gap-1.5">
                      <Check className="w-3.5 h-3.5" /> Image loaded — switch to Adjust or AI Edit
                    </div>
                  )}
                </div>
              )}

              {/* ── ADJUST TAB ── */}
              {activePanel === "adjust" && (
                <div className="p-4 space-y-5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Visual Adjustments</p>

                  {[
                    { label: "Brightness", value: brightness, set: setBrightness, min: 0,    max: 200, unit: "%" },
                    { label: "Contrast",   value: contrast,   set: setContrast,   min: 0,    max: 200, unit: "%" },
                    { label: "Saturation", value: saturation, set: setSaturation, min: 0,    max: 300, unit: "%" },
                    { label: "Hue Shift",  value: hue,        set: setHue,        min: -180, max: 180, unit: "°" },
                  ].map(({ label, value, set, min, max, unit }) => (
                    <div key={label}>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs text-muted-foreground">{label}</label>
                        <span className="text-xs text-primary font-mono">{value}{unit}</span>
                      </div>
                      <input
                        type="range" min={min} max={max} value={value}
                        onChange={e => set(+e.target.value)}
                        className="w-full accent-primary"
                      />
                    </div>
                  ))}

                  <button
                    onClick={() => { setBrightness(100); setContrast(100); setSaturation(100); setHue(0); }}
                    className="w-full py-1.5 border border-border/40 rounded text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Reset All
                  </button>

                  {/* Color presets */}
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2">Mood Presets</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { name: "Cyberpunk",   br: 110, ct: 130, sat: 150, hu: 180 },
                        { name: "Warm Sunset", br: 105, ct: 110, sat: 130, hu: 20  },
                        { name: "Cold Ice",    br: 100, ct: 120, sat: 80,  hu: -40 },
                        { name: "Dark Gothic", br: 70,  ct: 150, sat: 60,  hu: 0   },
                        { name: "Neon Glow",   br: 120, ct: 140, sat: 200, hu: 150 },
                        { name: "Vintage",     br: 95,  ct: 90,  sat: 70,  hu: 30  },
                      ].map(p => (
                        <button
                          key={p.name}
                          onClick={() => { setBrightness(p.br); setContrast(p.ct); setSaturation(p.sat); setHue(p.hu); }}
                          className="py-1.5 px-2 text-[10px] border border-border/30 rounded hover:border-primary/40 hover:text-primary text-muted-foreground transition-colors"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── AI EDIT TAB ── */}
              {activePanel === "edit" && (
                <div className="p-4 space-y-4">
                  {currentImageUrl?.startsWith("data:") ? (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3">
                      <p className="text-[10px] text-yellow-400 font-bold mb-1">📸 Uploaded Image Mode</p>
                      <p className="text-[10px] text-muted-foreground/70">Describe the character you want to generate — the AI will create a new version based on your description. Use the brush tools above to paint directly on your uploaded image.</p>
                    </div>
                  ) : (
                    <div className="bg-primary/5 border border-primary/20 rounded p-3">
                      <p className="text-[10px] text-primary/80 font-bold mb-1">AI Modification</p>
                      <p className="text-[10px] text-muted-foreground/70">Describe what to change. The AI will regenerate the character with your modifications applied on top of the original concept.</p>
                    </div>
                  )}

                  {!currentImageUrl && (
                    <div className="text-center py-6 text-muted-foreground/50 text-xs">
                      Generate or upload a character first
                    </div>
                  )}

                  {currentImageUrl && (
                    <>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1.5 block">Modification instruction</label>
                        <textarea
                          value={editPrompt}
                          onChange={e => setEditPrompt(e.target.value)}
                          rows={4}
                          placeholder={currentImageUrl?.startsWith("data:")
                            ? `Describe the character to generate, e.g. "fierce female warrior with silver armor and glowing blue eyes"`
                            : `e.g. "give her a red cloak and fire sword" or "make him look older with a beard"`}
                          className="w-full bg-secondary/20 border border-border/50 rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 resize-none"
                        />
                      </div>

                      {/* Quick edit suggestions */}
                      <div>
                        <p className="text-[10px] text-muted-foreground/60 mb-2">Quick edits</p>
                        <div className="flex flex-wrap gap-1">
                          {[
                            "add glowing wings", "change to dark armor", "add fire effects",
                            "make it more evil", "add a magical staff", "change eye color to red",
                            "add robot parts", "give a crown", "make larger / more imposing",
                            "add particle effects", "change outfit color to gold",
                          ].map(s => (
                            <button
                              key={s}
                              onClick={() => setEditPrompt(s)}
                              className="px-2 py-0.5 text-[10px] border border-border/30 rounded text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={aiEdit}
                        disabled={!editPrompt.trim() || editLoading}
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-background text-sm font-bold rounded hover:brightness-110 transition-all disabled:opacity-40"
                      >
                        {editLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                        {editLoading
                          ? "Generating…"
                          : currentImageUrl?.startsWith("data:")
                            ? "Generate AI Character"
                            : "Apply AI Modification"}
                      </button>
                    </>
                  )}

                  {/* Style conversion */}
                  {currentImageUrl && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2">Convert Style</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {STYLES.filter(s => s.id !== style).map(s => (
                          <button
                            key={s.id}
                            onClick={() => {
                              setStyle(s.id);
                              if (prompt.trim()) {
                                generateCharacter(s.id);
                              } else if (editPrompt.trim()) {
                                setPrompt(editPrompt.trim());
                                generateCharacter(s.id);
                              }
                              // If neither has content, style is still switched —
                              // the note below guides the user to add a description
                            }}
                            disabled={imageLoading}
                            className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] border border-border/30 rounded text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-40"
                          >
                            <span>{s.emoji}</span> {s.label}
                          </button>
                        ))}
                      </div>
                      {/* Guide when neither prompt has content to work from */}
                      {!prompt.trim() && !editPrompt.trim() && (
                        <p className="text-[10px] text-yellow-500/70 mt-2 leading-snug">
                          ⚡ Enter a description in the field above, then click a style to regenerate in that style.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </AppLayout>
  );
}
