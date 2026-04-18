import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";
import { trafficLogger } from "./lib/traffic-log.js";
import { deploymentHost } from "./middleware/deployment-host.js";

const app: Express = express();

app.use(cors());

// Stripe webhook MUST receive raw body — register before express.json()
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Capture every /api/* request into the in-memory traffic ring buffer
// so the admin "Live Traffic" panel can show real activity.
app.use(trafficLogger());

// Subdomain & custom-domain routing — must run before the API router so
// requests to <slug>.brand.tld or verified custom domains rewrite to
// /api/projects/:id/preview internally.
app.use(deploymentHost());

app.use("/api", router);

export default app;
