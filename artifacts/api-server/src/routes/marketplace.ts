import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { marketplaceListingsTable } from "@workspace/db/schema";
import { eq, like } from "drizzle-orm";
import { nanoid } from "../lib/nanoid.js";

const router: IRouter = Router();

const DEMO_LISTINGS = [
  {
    id: "listing-1", projectId: "proj-1", title: "SaaS Boilerplate Pro",
    description: "Complete SaaS starter with auth, billing, admin panel, and multi-tenancy out of the box.",
    category: "saas", price: 49, isFree: false, sellerId: "user-1", sellerName: "DevStudio",
    downloads: 1243, rating: 4.8, thumbnailUrl: null,
    tags: ["saas", "nextjs", "stripe", "auth"],
    createdAt: new Date("2025-12-01").toISOString(),
  },
  {
    id: "listing-2", projectId: "proj-2", title: "AI Chatbot Template",
    description: "Plug-and-play AI chatbot with OpenAI integration, conversation history, and custom persona support.",
    category: "ai_tool", price: 0, isFree: true, sellerId: "user-2", sellerName: "AIForge",
    downloads: 5632, rating: 4.9, thumbnailUrl: null,
    tags: ["ai", "chatbot", "openai", "free"],
    createdAt: new Date("2025-11-15").toISOString(),
  },
  {
    id: "listing-3", projectId: "proj-3", title: "Survival RPG Template",
    description: "Full 3D survival RPG in Godot with inventory system, crafting, day/night cycle, and procedural maps.",
    category: "game_template", price: 29, isFree: false, sellerId: "user-3", sellerName: "GameCraft",
    downloads: 867, rating: 4.7, thumbnailUrl: null,
    tags: ["godot", "rpg", "survival", "3d"],
    createdAt: new Date("2025-10-20").toISOString(),
  },
  {
    id: "listing-4", projectId: "proj-4", title: "E-Commerce Dashboard",
    description: "Beautiful admin dashboard for e-commerce with real-time analytics, order management, and inventory.",
    category: "app", price: 19, isFree: false, sellerId: "user-1", sellerName: "DevStudio",
    downloads: 2341, rating: 4.6, thumbnailUrl: null,
    tags: ["ecommerce", "dashboard", "react", "analytics"],
    createdAt: new Date("2025-09-05").toISOString(),
  },
  {
    id: "listing-5", projectId: "proj-5", title: "Open World Generator",
    description: "Procedural open world generator for Unity with biomes, weather, day/night cycle, and NPC AI.",
    category: "game_template", price: 79, isFree: false, sellerId: "user-4", sellerName: "WorldForge",
    downloads: 432, rating: 4.9, thumbnailUrl: null,
    tags: ["unity", "open-world", "procedural", "3d"],
    createdAt: new Date("2025-08-10").toISOString(),
  },
  {
    id: "listing-6", projectId: "proj-6", title: "Marketing Automation Suite",
    description: "AI-powered marketing tool with email sequences, SEO analyzer, social media scheduler, and funnel builder.",
    category: "saas", price: 39, isFree: false, sellerId: "user-5", sellerName: "GrowthAI",
    downloads: 789, rating: 4.5, thumbnailUrl: null,
    tags: ["marketing", "automation", "email", "seo"],
    createdAt: new Date("2025-07-22").toISOString(),
  },
  {
    id: "listing-7", projectId: "proj-7", title: "React Component Library",
    description: "150+ production-ready React components with TypeScript, Storybook docs, and Figma design tokens.",
    category: "app", price: 0, isFree: true, sellerId: "user-2", sellerName: "AIForge",
    downloads: 12456, rating: 4.8, thumbnailUrl: null,
    tags: ["react", "components", "typescript", "free"],
    createdAt: new Date("2025-06-15").toISOString(),
  },
  {
    id: "listing-8", projectId: "proj-8", title: "Multiplayer Shooter Template",
    description: "Complete multiplayer FPS template in Unreal Engine 5 with matchmaking, spectator mode, and replay system.",
    category: "game_template", price: 99, isFree: false, sellerId: "user-4", sellerName: "WorldForge",
    downloads: 234, rating: 4.7, thumbnailUrl: null,
    tags: ["unreal", "fps", "multiplayer", "ue5"],
    createdAt: new Date("2025-05-30").toISOString(),
  },
];

router.get("/listings", async (req, res) => {
  const { category, search } = req.query as { category?: string; search?: string };

  let listings = DEMO_LISTINGS;

  if (category && category !== "all") {
    listings = listings.filter((l) => l.category === category);
  }

  if (search) {
    const q = search.toLowerCase();
    listings = listings.filter((l) =>
      l.title.toLowerCase().includes(q) ||
      l.description.toLowerCase().includes(q) ||
      l.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  res.json(listings);
});

router.post("/listings", async (req, res) => {
  const userId = req.headers["x-user-id"] as string || "demo-user";
  const { projectId, title, description, category, price, tags } = req.body;

  const [listing] = await db.insert(marketplaceListingsTable).values({
    id: nanoid(),
    projectId,
    title,
    description,
    category,
    price: Number(price),
    isFree: price === 0,
    sellerId: userId,
    sellerName: "You",
    downloads: 0,
    rating: 0,
    tags: tags || [],
  }).returning();

  res.status(201).json({
    ...listing,
    createdAt: listing.createdAt.toISOString(),
    tags: Array.isArray(listing.tags) ? listing.tags : [],
  });
});

export default router;
