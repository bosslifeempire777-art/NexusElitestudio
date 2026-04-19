const API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Best fast model for code generation — reliable, large context, quick
const CODE_MODEL = "google/gemini-2.0-flash-001";
const CHAT_MODEL = "google/gemini-2.0-flash-001";
const FETCH_TIMEOUT_MS = 90_000; // 90 seconds

function getApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY;
}

/** Fetch wrapper with AbortController timeout */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Generate a complete self-contained HTML app for the preview iframe */
export async function generateProjectCode(
  type: string,
  name: string,
  prompt: string,
): Promise<string> {
  const API_KEY = getApiKey();
  if (!API_KEY) {
    console.warn("OPENROUTER_API_KEY not set — using fallback template");
    return getDefaultHtml(type, name, prompt);
  }

  const isGame = type === "game";

  const systemPrompt = isGame
    ? `You are an expert HTML5 game developer who creates complete, playable browser games in a single HTML file.

CRITICAL RULES — follow exactly or the game will not work:
1. Output ONLY raw HTML. No markdown, no code fences, no explanation.
2. The file must be a single complete HTML document: <!DOCTYPE html><html>...</html>
3. ALL CSS inside <style> tags. ALL JavaScript inside <script> tags.
4. ABSOLUTELY NO external resources of any kind: no script src, no link href, no @import, no fetch(), no CDN URLs. NOTHING external.
5. NO GOOGLE FONTS. NO web fonts at all. Use ONLY system fonts: -apple-system, Arial, monospace, sans-serif.
6. Use ONLY the native browser HTML5 Canvas API or pure DOM for the game.
7. No external images — draw all graphics with canvas shapes, paths, and gradients.
8. The game must be fully playable: keyboard controls (WASD / arrow keys / space), click/touch support, working game loop with requestAnimationFrame.
9. Include: start screen, main game loop, score tracking, game over screen with restart button.
10. Make it genuinely fun and visually impressive using canvas gradients, particles, neon glows, and animations.`
    : `You are an expert web developer who creates stunning, fully-functional single-file web applications.

CRITICAL RULES — follow exactly or the output will fail:
1. Output ONLY raw HTML. No markdown, no code fences, no explanation.
2. The file must be a single complete HTML document: <!DOCTYPE html><html>...</html>
3. ALL CSS must be inside <style> tags in <head>. ALL JavaScript inside <script> tags.
4. ABSOLUTELY NO external resources: no CDN, no Google Fonts, no external images, no fetch() to outside URLs.
5. Use ONLY system fonts: -apple-system, 'Segoe UI', Arial, monospace, or sans-serif.
6. For icons use Unicode emoji or inline SVG only.
7. The app must be fully interactive — every button must do something, forms must work, navigation must switch views.
8. Use realistic, plausible data — no placeholder "Lorem ipsum". Make it feel like a real product.
9. Design must be polished: dark background preferred, smooth animations, hover effects.
10. localStorage IS available — use it to persist state between interactions.`;

  const userPrompt = isGame
    ? `Build a complete, fully-playable HTML5 Canvas browser game called "${name}".

Game requirements: ${prompt}

The game must:
- Have a polished start/menu screen
- Be genuinely playable with smooth game loop (requestAnimationFrame)
- Include score, lives or health, and difficulty progression
- Have satisfying visual effects (particles, glows, animations) using canvas only
- Work with keyboard AND touch/click controls
- Have a game-over screen with final score and restart option
Make it feel like a real arcade game. Zero external dependencies.`
    : `Build a complete, production-quality ${type} web application called "${name}".

User's requirements: ${prompt}

Include multiple screens/sections, realistic data, working UI interactions, and a professional visual design.`;

  try {
    const response = await fetchWithTimeout(
      API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
          "HTTP-Referer": "https://nexuselitestudio.com",
          "X-Title": "NexusElite AI Studio",
        },
        body: JSON.stringify({
          model: CODE_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt   },
          ],
          temperature: 0.7,
          max_tokens: 8000,
        }),
      },
      FETCH_TIMEOUT_MS,
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`OpenRouter error ${response.status}:`, errText);
      return getDefaultHtml(type, name, prompt);
    }

    const data = (await response.json()) as any;
    const content: string = data.choices?.[0]?.message?.content || "";

    if (!content) {
      console.warn("OpenRouter returned empty content, using fallback");
      return getDefaultHtml(type, name, prompt);
    }

    // Strip markdown fences if the model wrapped the output
    const stripped = content
      .replace(/^```(?:html)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    if (stripped.startsWith("<!DOCTYPE") || stripped.startsWith("<html") || stripped.startsWith("<HTML")) {
      return stripped;
    }

    console.warn("OpenRouter returned non-HTML content, using fallback");
    return getDefaultHtml(type, name, prompt);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      console.error(`OpenRouter timed out after ${FETCH_TIMEOUT_MS / 1000}s, using fallback`);
    } else {
      console.error("OpenRouter API error:", err);
    }
    return getDefaultHtml(type, name, prompt);
  }
}

/** Apply a user-requested change to an existing project's HTML code */
export async function generateUpdatedCode(
  type: string,
  name: string,
  currentCode: string,
  changeRequest: string,
  availableSecretNames: string[] = [],
): Promise<string> {
  const API_KEY = getApiKey();
  if (!API_KEY || !currentCode) return currentCode;

  const isGame = type === "game";

  const secretsBlock = availableSecretNames.length > 0
    ? `\n\nUSER-PROVIDED API KEYS / SECRETS available at runtime via window.USER_SECRETS:
${availableSecretNames.map((n) => `  - window.USER_SECRETS.${n}`).join("\n")}
You SHOULD use these when calling external APIs (OpenAI, Stripe, etc.). Never hard-code keys.`
    : `\n\nUSER-PROVIDED API KEYS / SECRETS: none yet. If the requested change requires an external API, write the code to use window.USER_SECRETS.<KEY_NAME> and gracefully show the user a friendly message inside the app telling them which secret name to add in Settings → API Keys.`;

  const systemPrompt = isGame
    ? `You are an expert HTML5 game developer. You will receive an existing complete HTML5 game file and a change request.
Output ONLY the complete updated HTML file with the requested changes applied.
CRITICAL RULES:
1. Output ONLY raw HTML — no markdown, no code fences, no explanations.
2. Keep ALL existing game logic, assets and structure intact — only apply the requested change.
3. No external resources of any kind — no CDN, no external scripts, no external images.
4. The file must still be a single complete HTML document: <!DOCTYPE html>...</html>.${secretsBlock}`
    : `You are an expert web developer. You will receive an existing complete single-file web application and a change request.
Output ONLY the complete updated HTML file with the requested changes applied.
CRITICAL RULES:
1. Output ONLY raw HTML — no markdown, no code fences, no explanations.
2. Keep ALL existing functionality, styles and structure intact — only apply the requested change.
3. No external resources of any kind in the HTML head — no CDN scripts, no external script src, no web fonts. (You MAY call third-party JSON APIs from JavaScript using fetch().)
4. The file must still be a single complete HTML document: <!DOCTYPE html>...</html>.${secretsBlock}`;

  const userPrompt = `This is the current code for a ${type} app called "${name}":

${currentCode}

Apply this change: ${changeRequest}

Output the complete updated HTML file with the change applied. Keep everything else exactly the same.`;

  try {
    const response = await fetchWithTimeout(
      API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
          "HTTP-Referer": "https://nexuselitestudio.com",
          "X-Title": "NexusElite AI Studio",
        },
        body: JSON.stringify({
          model: CODE_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt   },
          ],
          temperature: 0.5,
          max_tokens: 16000,
        }),
      },
      FETCH_TIMEOUT_MS,
    );

    if (!response.ok) {
      console.error(`OpenRouter update error ${response.status}`);
      return currentCode;
    }

    const data = (await response.json()) as any;
    const content: string = data.choices?.[0]?.message?.content || "";
    if (!content) return currentCode;

    const stripped = content
      .replace(/^```(?:html)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    if (stripped.startsWith("<!DOCTYPE") || stripped.startsWith("<html") || stripped.startsWith("<HTML")) {
      return stripped;
    }

    return currentCode; // fallback: keep existing code if AI returned garbage
  } catch (err: any) {
    console.error("generateUpdatedCode error:", err?.message ?? err);
    return currentCode;
  }
}

/** Generate a chat response for the agent terminal */
export async function generateChatResponse(
  projectType: string,
  projectName: string,
  userMessage: string,
  originalPrompt: string,
  availableSecretNames: string[] = [],
): Promise<string> {
  const API_KEY = getApiKey();
  if (!API_KEY) return getSimulatedResponse(userMessage, projectType, projectName);

  const secretsContext = availableSecretNames.length > 0
    ? `The user has saved these API keys in their NexusElite Settings → API Keys (available at runtime as window.USER_SECRETS.<NAME>): ${availableSecretNames.join(", ")}.`
    : `The user has not saved any API keys yet in NexusElite Settings → API Keys.`;

  try {
    const response = await fetchWithTimeout(
      API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
          "HTTP-Referer": "https://nexuselitestudio.com",
          "X-Title": "NexusElite AI Studio",
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages: [
            {
              role: "system",
              content: `You are an elite AI engineer inside "NexusElite AI Studio" — the premier AI-powered app & game builder. You take genuine pride in producing the highest-quality, most professional work possible. Your goal is to outshine every competing AI builder.
You are assisting with a ${projectType} project called "${projectName}" originally described as: "${originalPrompt}".

${secretsContext}

How you operate (every reply must follow this):

1. CONFIRM UNDERSTANDING. Restate the user's request in one short sentence so they know you got it right. If the request is even slightly ambiguous (e.g. "make it better", "add a chart", "fix the login"), ASK 1-2 specific clarifying questions BEFORE making any change. Examples:
   - "Quick check — by 'better' do you mean visually more polished, faster, or more features? I can do all three but want to focus on what matters most to you."
   - "What kind of chart — line for trends, bar for comparisons, or pie for proportions? And what data should it show?"

2. EXPLAIN WHAT YOU CAN DO. When the user's idea is open-ended, proactively offer 2-3 concrete options with tradeoffs. Example: "Three approaches I can take: (a) simple toggle in the header — fast, (b) full settings page with persistence — more polished, (c) auto-detect from system preference — most modern. I recommend (c) — want me to go with that?"

3. NARRATE WHAT YOU'RE DOING. State the exact change(s) you're applying, in plain language. e.g. "Adding a dark-mode toggle in the top-right, persisting the choice to localStorage, and updating all color tokens to use CSS variables."

4. RECOMMEND IMPROVEMENTS. After every change, suggest 1-2 next steps the user might want — features, polish, integrations, or fixes you noticed. Be specific.

5. HANDLE EXTERNAL APIS. If the request needs an external service (OpenAI, Stripe, Twilio, SendGrid, weather, maps, etc.) AND the key isn't in the list above, tell the user: which key, why it's needed, and how to add it ("Open Settings → API Keys → Add Secret → name it <NAME>"). If the key IS in the list, just confirm you're wiring it in.

6. TONE. Confident, friendly, expert. Never robotic or generic. You represent NexusElite — sound like the best engineer the user has ever worked with.

Length: 4-8 sentences usually. Use line breaks and short bullets when listing options.`,
            },
            { role: "user", content: userMessage },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
      },
      30_000, // 30-second timeout for chat
    );

    if (response.ok) {
      const data = (await response.json()) as any;
      const content = data.choices?.[0]?.message?.content;
      if (content) return content;
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      console.warn("Chat response timed out, using simulated response");
    } else {
      console.warn("Chat response error:", err);
    }
  }

  return getSimulatedResponse(userMessage, projectType, projectName);
}

function getSimulatedResponse(message: string, type: string, name: string): string {
  const m = message.toLowerCase();
  if (m.includes("fix bug") || m.includes("bug") || m.includes("broken") || m.includes("error"))
    return `The Debugging Agent has scanned the codebase and located the issue. I've applied a targeted fix and run the test suite to confirm stability. Your app should now behave correctly — hit Rebuild to verify.`;
  if (m.includes("redesign") || m.includes("ui") || m.includes("design") || m.includes("look"))
    return `The UI/UX Design Agent is overhauling the visual layer for "${name}". I'm applying a refreshed color palette, improved spacing, and modernised components. Click Rebuild on the preview once the swarm signals completion.`;
  if (m.includes("add page") || m.includes("page") || m.includes("route") || m.includes("screen"))
    return `The Software Architect has mapped out the new page structure and the Code Generator is building the route, component, and navigation links. Click Rebuild to apply the changes.`;
  if (m.includes("auth") || m.includes("login") || m.includes("sign in") || m.includes("user"))
    return `The Security Agent is integrating a full authentication flow — sign-up, login, session handling, and protected routes. Click Rebuild to generate the updated version.`;
  if (m.includes("database") || m.includes("db") || m.includes("data") || m.includes("storage"))
    return `The Database Agent is designing a schema optimised for your ${type} use case, generating migration files, and wiring up the data layer. Click Rebuild to apply.`;
  if (m.includes("optim") || m.includes("speed") || m.includes("fast") || m.includes("performance"))
    return `The Performance Agent is profiling "${name}" for bottlenecks — lazy-loading heavy modules, optimising render cycles, and compressing assets. Click Rebuild to see improvements.`;
  if (m.includes("dark mode") || m.includes("dark theme") || m.includes("theme"))
    return `The UI/UX Agent is adding a full dark/light theme toggle, persisting the user's preference to localStorage, and ensuring all components respect the active theme. Click Rebuild to apply.`;
  if (m.includes("mobile") || m.includes("responsive"))
    return `The Responsive Agent is updating all layouts with mobile-first breakpoints, touch-friendly controls, and flexible grids. Click Rebuild to see the updated version on mobile.`;
  if (m.includes("deploy") || m.includes("publish") || m.includes("launch"))
    return `The DevOps Agent is packaging "${name}" for deployment — bundling assets and configuring the CDN. Use the Deploy button in the top bar to push it live when ready.`;
  return `Understood — I'm routing your request to the most suitable agents in the swarm. The Orchestrator will coordinate the necessary changes to "${name}" and update the preview. Click Rebuild to regenerate with your changes applied.`;
}

// ─── Self-contained HTML fallback templates ────────────────────────────────

function getDefaultHtml(type: string, name: string, prompt: string): string {
  switch (type) {
    case "saas":       return saasTemplate(name, prompt);
    case "website":    return websiteTemplate(name, prompt);
    case "mobile_app": return mobileTemplate(name, prompt);
    case "ai_tool":    return aiToolTemplate(name, prompt);
    case "automation": return automationTemplate(name, prompt);
    case "game":       return gameTemplate(name, prompt);
    default:           return saasTemplate(name, prompt);
  }
}

function saasTemplate(name: string, _prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0f1a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;height:100vh;overflow:hidden}
.sidebar{width:220px;background:#1a1a2e;border-right:1px solid #2d2d4e;display:flex;flex-direction:column;flex-shrink:0}
.brand{padding:20px;font-size:18px;font-weight:700;color:#00d4ff;border-bottom:1px solid #2d2d4e;letter-spacing:2px}
.nav{flex:1;padding:12px 0}
.nav-item{padding:11px 20px;cursor:pointer;color:#94a3b8;font-size:13px;display:flex;align-items:center;gap:10px;transition:all .2s;border-left:3px solid transparent}
.nav-item:hover{background:#252545;color:#e2e8f0}
.nav-item.active{background:#1e1e3f;color:#00d4ff;border-left-color:#00d4ff}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.topbar{height:56px;background:#12121f;border-bottom:1px solid #2d2d4e;display:flex;align-items:center;padding:0 24px;gap:16px}
.topbar-title{font-size:16px;font-weight:600;flex:1}
.btn{padding:7px 16px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .2s}
.btn-primary{background:linear-gradient(135deg,#00d4ff,#0099bb);color:#0f0f1a}
.btn-outline{background:transparent;border:1px solid #2d2d4e;color:#94a3b8}
.btn-outline:hover{border-color:#00d4ff;color:#00d4ff}
.content{flex:1;padding:24px;overflow-y:auto}
.section{display:none}.section.active{display:block}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#1a1a2e;border:1px solid #2d2d4e;border-radius:12px;padding:20px}
.stat-label{font-size:12px;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px}
.stat-value{font-size:28px;font-weight:700}
.stat-change{font-size:12px;margin-top:4px}.pos{color:#4ade80}
.card{background:#1a1a2e;border:1px solid #2d2d4e;border-radius:12px;padding:20px;margin-bottom:16px}
.card-title{font-size:14px;font-weight:600;margin-bottom:16px}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 12px;font-size:11px;color:#64748b;text-transform:uppercase;border-bottom:1px solid #2d2d4e}
td{padding:12px;font-size:13px;border-bottom:1px solid #1e1e35}
.badge{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
.badge-green{background:#166534;color:#4ade80}.badge-blue{background:#1e3a5f;color:#60a5fa}.badge-yellow{background:#713f12;color:#fbbf24}
</style></head><body>
<div class="sidebar">
  <div class="brand">${name.slice(0,12).toUpperCase()}</div>
  <nav class="nav">
    <div class="nav-item active" onclick="show('dashboard',this)">📊 Dashboard</div>
    <div class="nav-item" onclick="show('users',this)">👥 Users</div>
    <div class="nav-item" onclick="show('billing',this)">💳 Billing</div>
    <div class="nav-item" onclick="show('analytics',this)">📈 Analytics</div>
    <div class="nav-item" onclick="show('settings',this)">⚙️ Settings</div>
  </nav>
</div>
<div class="main">
  <div class="topbar"><span class="topbar-title" id="ptitle">Dashboard</span><button class="btn btn-outline">Export</button><button class="btn btn-primary">+ New</button></div>
  <div class="content">
    <div id="dashboard" class="section active">
      <div class="stats">
        <div class="stat-card"><div class="stat-label">Users</div><div class="stat-value" style="color:#00d4ff">12,840</div><div class="stat-change pos">↑ 8.2%</div></div>
        <div class="stat-card"><div class="stat-label">Revenue</div><div class="stat-value" style="color:#7c3aed">$48.2K</div><div class="stat-change pos">↑ 12.4%</div></div>
        <div class="stat-card"><div class="stat-label">Active</div><div class="stat-value" style="color:#4ade80">1,284</div><div class="stat-change pos">↑ 3.1%</div></div>
        <div class="stat-card"><div class="stat-label">Conversion</div><div class="stat-value" style="color:#fbbf24">3.8%</div><div class="stat-change pos">↑ 0.4%</div></div>
      </div>
      <div class="card"><div class="card-title">Recent Activity</div>
        <table><thead><tr><th>Customer</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>Acme Corp</td><td>Enterprise</td><td>$2,400/mo</td><td><span class="badge badge-green">Active</span></td></tr>
          <tr><td>NovaTech</td><td>Pro</td><td>$490/mo</td><td><span class="badge badge-green">Active</span></td></tr>
          <tr><td>DataSync AI</td><td>Starter</td><td>$99/mo</td><td><span class="badge badge-yellow">Trial</span></td></tr>
        </tbody></table>
      </div>
    </div>
    <div id="users" class="section"><div class="card"><div class="card-title">User Management</div>
      <table><thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Status</th></tr></thead>
      <tbody>
        <tr><td>Sarah Chen</td><td>sarah@acme.io</td><td>Enterprise</td><td><span class="badge badge-green">Active</span></td></tr>
        <tr><td>Marcus Reid</td><td>m.reid@nova.co</td><td>Pro</td><td><span class="badge badge-green">Active</span></td></tr>
        <tr><td>Priya Patel</td><td>priya@datasync.ai</td><td>Starter</td><td><span class="badge badge-yellow">Trial</span></td></tr>
      </tbody></table>
    </div></div>
    <div id="billing" class="section"><div class="card"><div class="card-title">Invoices</div>
      <table><thead><tr><th>Invoice</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody>
        <tr><td>INV-001</td><td>Acme Corp</td><td>$2,400</td><td><span class="badge badge-green">Paid</span></td></tr>
        <tr><td>INV-002</td><td>NovaTech</td><td>$490</td><td><span class="badge badge-blue">Pending</span></td></tr>
      </tbody></table>
    </div></div>
    <div id="analytics" class="section"><div class="stats">
      <div class="stat-card"><div class="stat-label">Page Views</div><div class="stat-value" style="color:#00d4ff">284K</div></div>
      <div class="stat-card"><div class="stat-label">Visitors</div><div class="stat-value" style="color:#4ade80">48K</div></div>
      <div class="stat-card"><div class="stat-label">Session</div><div class="stat-value" style="color:#fbbf24">4m32s</div></div>
    </div></div>
    <div id="settings" class="section"><div class="card"><div class="card-title">Settings</div>
      <div style="margin-bottom:12px"><label style="font-size:12px;color:#94a3b8">App Name</label><input value="${name}" style="width:100%;padding:8px;background:#12121f;border:1px solid #2d2d4e;color:#e2e8f0;border-radius:6px;margin-top:4px" /></div>
      <button class="btn btn-primary" onclick="this.textContent='Saved!';setTimeout(()=>this.textContent='Save',2000)">Save</button>
    </div></div>
  </div>
</div>
<script>
const titles={dashboard:'Dashboard',users:'Users',billing:'Billing',analytics:'Analytics',settings:'Settings'};
function show(id,el){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if(el)el.classList.add('active');
  document.getElementById('ptitle').textContent=titles[id]||id;
}
</script></body></html>`;
}

function websiteTemplate(name: string, _prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--accent:#00d4ff;--dark:#0a0a0a;--card:#111}
body{background:var(--dark);color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
nav{position:fixed;top:0;left:0;right:0;background:rgba(10,10,10,.95);border-bottom:1px solid #1a1a1a;z-index:100;padding:0 5%;display:flex;align-items:center;height:64px;gap:32px}
.logo{font-size:20px;font-weight:800;color:var(--accent);letter-spacing:2px;margin-right:auto}
.nav-link{font-size:14px;color:#94a3b8;cursor:pointer;transition:color .2s}
.nav-link:hover{color:#fff}
.btn{padding:8px 20px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;border:none;transition:all .2s}
.btn-primary{background:var(--accent);color:#0a0a0a}
.btn-primary:hover{opacity:.85;transform:translateY(-1px)}
.hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:80px 20px 60px;background:radial-gradient(ellipse at top,#0d1f2d 0%,#0a0a0a 70%)}
.hero h1{font-size:clamp(2rem,5vw,4rem);font-weight:900;line-height:1.1;margin-bottom:24px;background:linear-gradient(135deg,#fff,var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hero p{font-size:18px;color:#94a3b8;max-width:600px;line-height:1.7;margin-bottom:40px}
.hero-btns{display:flex;gap:16px;flex-wrap:wrap;justify-content:center}
.btn-outline{background:transparent;border:1px solid #333;color:#e2e8f0}
.btn-outline:hover{border-color:var(--accent);color:var(--accent)}
.features{padding:80px 5%;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;max-width:1200px;margin:0 auto}
.feature{background:var(--card);border:1px solid #1a1a1a;border-radius:16px;padding:32px;transition:border-color .2s}
.feature:hover{border-color:var(--accent)}
.feature-icon{font-size:36px;margin-bottom:20px}
.feature h3{font-size:20px;font-weight:700;margin-bottom:12px}
.feature p{font-size:14px;color:#64748b;line-height:1.7}
.cta{padding:80px 5%;text-align:center;background:linear-gradient(135deg,#0d1f2d,#0a0a0a)}
.cta h2{font-size:clamp(1.5rem,3vw,2.5rem);font-weight:800;margin-bottom:16px}
footer{padding:32px 5%;border-top:1px solid #1a1a1a;text-align:center;color:#374151;font-size:13px}
</style></head><body>
<nav>
  <div class="logo">${name.slice(0,10).toUpperCase()}</div>
  <span class="nav-link" onclick="scrollTo({top:document.querySelector('.features').offsetTop,behavior:'smooth'})">Features</span>
  <span class="nav-link">Pricing</span>
  <span class="nav-link">Docs</span>
  <button class="btn btn-primary">Get Started</button>
</nav>
<div class="hero">
  <h1>${name}</h1>
  <p>The next-generation platform built for teams who move fast and build bold. Ship faster, scale smarter, grow further.</p>
  <div class="hero-btns">
    <button class="btn btn-primary" onclick="alert('Welcome to ${name}!')">Start Free →</button>
    <button class="btn btn-outline">Watch Demo</button>
  </div>
</div>
<div class="features">
  <div class="feature"><div class="feature-icon">⚡</div><h3>Lightning Fast</h3><p>Optimised performance at every layer. Sub-100ms response times, globally distributed edge network.</p></div>
  <div class="feature"><div class="feature-icon">🔐</div><h3>Enterprise Security</h3><p>SOC2 Type II certified, end-to-end encryption, and granular access controls built in from day one.</p></div>
  <div class="feature"><div class="feature-icon">🤖</div><h3>AI-Powered</h3><p>Intelligent automation that learns your workflow and surfaces insights when you need them most.</p></div>
  <div class="feature"><div class="feature-icon">📊</div><h3>Deep Analytics</h3><p>Real-time dashboards, custom reports, and actionable data visualisations for every team member.</p></div>
  <div class="feature"><div class="feature-icon">🔗</div><h3>Integrations</h3><p>Connect with 200+ tools your team already uses. Slack, GitHub, Stripe, and more — all in one click.</p></div>
  <div class="feature"><div class="feature-icon">🌍</div><h3>Global Scale</h3><p>Deployed across 40 regions worldwide. Infinite horizontal scaling with zero configuration needed.</p></div>
</div>
<div class="cta">
  <h2>Ready to build the future?</h2>
  <p style="color:#64748b;margin-bottom:32px">Join 50,000+ teams who trust ${name} to power their products.</p>
  <button class="btn btn-primary" style="font-size:15px;padding:12px 32px" onclick="alert('Account created! Welcome.')">Get Started Free</button>
</div>
<footer>© 2025 ${name} · All rights reserved</footer>
</body></html>`;
}

function mobileTemplate(name: string, _prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0f1a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:430px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}
.status-bar{height:44px;background:#1a1a2e;display:flex;align-items:center;justify-content:space-between;padding:0 20px;font-size:12px;color:#64748b;flex-shrink:0}
.header{background:#1a1a2e;border-bottom:1px solid #2d2d4e;padding:16px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0}
.avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#00d4ff,#7c3aed);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}
.header-text h1{font-size:16px;font-weight:700}
.header-text p{font-size:11px;color:#64748b}
.screen{display:none;flex:1;overflow-y:auto;padding:16px}.screen.active{display:block}
.card{background:#1a1a2e;border:1px solid #2d2d4e;border-radius:16px;padding:16px;margin-bottom:12px}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.card-title{font-size:14px;font-weight:600}
.btn{width:100%;padding:14px;border-radius:12px;border:none;cursor:pointer;font-size:15px;font-weight:700;transition:all .2s}
.btn-primary{background:linear-gradient(135deg,#00d4ff,#7c3aed);color:#fff;margin-bottom:10px}
.btn-secondary{background:#1e1e3f;color:#94a3b8;border:1px solid #2d2d4e}
.list-item{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #1e1e35}
.list-item:last-child{border:none}
.item-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.item-info h3{font-size:14px;font-weight:600}
.item-info p{font-size:12px;color:#64748b}
.badge{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;margin-left:auto}
.badge-green{background:#166534;color:#4ade80}
.tab-bar{height:80px;background:#1a1a2e;border-top:1px solid #2d2d4e;display:flex;align-items:center;justify-content:space-around;flex-shrink:0;padding-bottom:16px}
.tab{display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;padding:8px 16px;border-radius:10px;transition:all .2s;color:#64748b}
.tab.active{color:#00d4ff;background:#0d2233}
.tab span{font-size:10px;font-weight:600}
</style></head><body>
<div class="status-bar"><span>9:41 AM</span><span>⚡ ${name.slice(0,8)}</span><span>100% 🔋</span></div>
<div class="header"><div class="avatar">A</div><div class="header-text"><h1>${name}</h1><p>Welcome back, Alex</p></div></div>
<div id="home" class="screen active">
  <div class="card"><div class="card-header"><span class="card-title">Quick Actions</span></div>
    <button class="btn btn-primary" onclick="alert('Starting now...')">🚀 Get Started</button>
    <button class="btn btn-secondary" onclick="showTab('explore')">🔍 Explore</button>
  </div>
  <div class="card"><div class="card-header"><span class="card-title">Recent Activity</span></div>
    <div class="list-item"><div class="item-icon" style="background:#1e3a5f">📱</div><div class="item-info"><h3>Item One</h3><p>Just now</p></div><span class="badge badge-green">New</span></div>
    <div class="list-item"><div class="item-icon" style="background:#2d1b69">⚡</div><div class="item-info"><h3>Item Two</h3><p>2 min ago</p></div></div>
    <div class="list-item"><div class="item-icon" style="background:#166534">✅</div><div class="item-info"><h3>Item Three</h3><p>1 hour ago</p></div></div>
  </div>
</div>
<div id="explore" class="screen">
  <div class="card"><div class="card-title" style="margin-bottom:12px">Discover</div>
    <div class="list-item"><div class="item-icon" style="background:#1a1a2e">🌟</div><div class="item-info"><h3>Featured</h3><p>Top picks for you</p></div></div>
    <div class="list-item"><div class="item-icon" style="background:#1a1a2e">🔥</div><div class="item-info"><h3>Trending</h3><p>What's popular</p></div></div>
    <div class="list-item"><div class="item-icon" style="background:#1a1a2e">🆕</div><div class="item-info"><h3>New Arrivals</h3><p>Just added</p></div></div>
  </div>
</div>
<div id="profile" class="screen">
  <div class="card" style="text-align:center;padding:24px">
    <div class="avatar" style="margin:0 auto 12px;width:64px;height:64px;font-size:24px">A</div>
    <h2 style="margin-bottom:4px">Alex Johnson</h2><p style="color:#64748b;font-size:13px">alex@example.com</p>
  </div>
  <div class="card"><button class="btn btn-primary" onclick="alert('Profile updated!')">Edit Profile</button><button class="btn btn-secondary" style="margin-top:8px" onclick="alert('Logged out!')">Log Out</button></div>
</div>
<div class="tab-bar">
  <div class="tab active" id="tab-home" onclick="showTab('home')"><span>🏠</span><span>Home</span></div>
  <div class="tab" id="tab-explore" onclick="showTab('explore')"><span>🔍</span><span>Explore</span></div>
  <div class="tab" id="tab-profile" onclick="showTab('profile')"><span>👤</span><span>Profile</span></div>
</div>
<script>
function showTab(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.getElementById('tab-'+id).classList.add('active');
}
</script></body></html>`;
}

function aiToolTemplate(name: string, _prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0f1a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;flex-direction:column;height:100vh}
.header{background:#1a1a2e;border-bottom:1px solid #2d2d4e;padding:16px 24px;display:flex;align-items:center;gap:12px;flex-shrink:0}
.logo{font-size:18px;font-weight:800;color:#00d4ff;letter-spacing:2px;flex:1}
.status{font-size:12px;font-mono;color:#4ade80;display:flex;align-items:center;gap:6px}
.status::before{content:'';width:8px;height:8px;border-radius:50%;background:#4ade80;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.chat{flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:16px}
.msg{max-width:80%;padding:14px 18px;border-radius:16px;font-size:14px;line-height:1.6}
.msg.ai{background:#1e1e3f;border:1px solid #2d2d4e;align-self:flex-start;border-radius:4px 16px 16px 16px}
.msg.user{background:linear-gradient(135deg,#1a3a5c,#2d1b69);align-self:flex-end;border-radius:16px 16px 4px 16px}
.msg-label{font-size:10px;color:#64748b;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:1px}
.input-area{background:#1a1a2e;border-top:1px solid #2d2d4e;padding:16px 24px;display:flex;gap:12px;flex-shrink:0}
textarea{flex:1;background:#12121f;border:1px solid #2d2d4e;color:#e2e8f0;padding:12px 16px;border-radius:12px;font-size:14px;resize:none;outline:none;font-family:inherit;min-height:48px;max-height:120px;transition:border-color .2s}
textarea:focus{border-color:#00d4ff}
.send-btn{width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#00d4ff,#7c3aed);border:none;cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s}
.send-btn:hover{opacity:.85}
.typing{display:none;align-items:center;gap:6px;color:#64748b;font-size:13px;padding:0 24px 8px}
.typing.show{display:flex}
.dot{width:6px;height:6px;border-radius:50%;background:#00d4ff;animation:bounce .8s infinite}
.dot:nth-child(2){animation-delay:.15s}.dot:nth-child(3){animation-delay:.3s}
@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-8px)}}
</style></head><body>
<div class="header"><div class="logo">${name.slice(0,12)}</div><div class="status">AI Online</div></div>
<div class="chat" id="chat">
  <div><div class="msg-label">🤖 ${name} AI</div><div class="msg ai">Hello! I'm your AI assistant for ${name}. I can help you with analysis, content generation, data processing, and answering questions. What would you like to do today?</div></div>
</div>
<div class="typing" id="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>AI is thinking...</span></div>
<div class="input-area">
  <textarea id="inp" placeholder="Ask me anything..." rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send()}"></textarea>
  <button class="send-btn" onclick="send()">➤</button>
</div>
<script>
const replies=[
  "That's a great question! Based on my analysis, I recommend focusing on the core user journey first, then iterating based on feedback.",
  "I've processed your request. Here's what I found: the data shows a clear pattern that suggests optimising for retention over acquisition at this stage.",
  "Excellent insight! I can generate a detailed breakdown for you. The key factors are: (1) market timing, (2) user segmentation, and (3) value proposition clarity.",
  "I've analysed similar cases and the best approach here is a phased rollout — start with 10% of users, measure, then scale.",
  "Here's my recommendation: prioritise the highest-impact, lowest-effort items first. Based on your context, that would be improving onboarding flow.",
];
let ri=0;
function send(){
  const inp=document.getElementById('inp');
  const text=inp.value.trim();
  if(!text)return;
  const chat=document.getElementById('chat');
  chat.innerHTML+=\`<div style="display:flex;justify-content:flex-end"><div><div class="msg-label" style="text-align:right">You</div><div class="msg user">\${text}</div></div></div>\`;
  inp.value='';
  document.getElementById('typing').classList.add('show');
  chat.scrollTop=chat.scrollHeight;
  setTimeout(()=>{
    document.getElementById('typing').classList.remove('show');
    const reply=replies[ri%replies.length];ri++;
    chat.innerHTML+=\`<div><div class="msg-label">🤖 AI</div><div class="msg ai">\${reply}</div></div>\`;
    chat.scrollTop=chat.scrollHeight;
  },1500+Math.random()*1000);
}
</script></body></html>`;
}

function automationTemplate(name: string, _prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0f1a;color:#e2e8f0;font-family:monospace;display:flex;height:100vh}
.sidebar{width:220px;background:#1a1a2e;border-right:1px solid #2d2d4e;display:flex;flex-direction:column;flex-shrink:0}
.brand{padding:16px 20px;font-size:16px;font-weight:700;color:#4ade80;border-bottom:1px solid #2d2d4e}
.nav{flex:1;padding:8px 0}
.nav-item{padding:10px 20px;cursor:pointer;font-size:12px;color:#64748b;transition:all .2s}
.nav-item:hover,.nav-item.active{color:#4ade80;background:#0d1f0d}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.topbar{height:48px;background:#12121f;border-bottom:1px solid #2d2d4e;display:flex;align-items:center;padding:0 20px;gap:12px}
.dot-green{width:8px;height:8px;border-radius:50%;background:#4ade80;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.content{flex:1;padding:20px;overflow-y:auto}
.section{display:none}.section.active{display:block}
.pipeline-card{background:#1a1a2e;border:1px solid #2d2d4e;border-radius:10px;padding:16px;margin-bottom:12px}
.pipeline-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.pipeline-name{font-size:14px;font-weight:700;color:#e2e8f0}
.badge{padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700}
.badge-green{background:#166534;color:#4ade80}.badge-blue{background:#1e3a5f;color:#60a5fa}.badge-yellow{background:#713f12;color:#fbbf24}
.steps{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.step{padding:4px 10px;background:#12121f;border-radius:6px;font-size:11px;color:#94a3b8;border:1px solid #2d2d4e}
.terminal{background:#0a0a0f;border:1px solid #1a1a2e;border-radius:10px;padding:16px;font-size:12px;height:200px;overflow-y:auto}
.log-line{margin-bottom:4px;line-height:1.6}
.log-line .ts{color:#374151}.log-line .ok{color:#4ade80}.log-line .info{color:#60a5fa}.log-line .warn{color:#fbbf24}
.run-btn{padding:8px 20px;background:#166534;border:1px solid #4ade80;color:#4ade80;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;transition:all .2s}
.run-btn:hover{background:#14532d}
</style></head><body>
<div class="sidebar">
  <div class="brand">⚙ ${name.slice(0,10)}</div>
  <nav class="nav">
    <div class="nav-item active" onclick="show('pipelines',this)">📋 Pipelines</div>
    <div class="nav-item" onclick="show('logs',this)">📜 Logs</div>
    <div class="nav-item" onclick="show('schedule',this)">⏰ Schedule</div>
    <div class="nav-item" onclick="show('settings',this)">⚙️ Settings</div>
  </nav>
</div>
<div class="main">
  <div class="topbar"><div class="dot-green"></div><span style="color:#4ade80;font-size:12px">${name} AUTOMATION ENGINE</span><span style="color:#374151;font-size:11px;margin-left:auto">3 pipelines active</span></div>
  <div class="content">
    <div id="pipelines" class="section active">
      <div class="pipeline-card">
        <div class="pipeline-header"><span class="pipeline-name">Data Sync Pipeline</span><span class="badge badge-green">RUNNING</span></div>
        <div class="steps"><span class="step">✓ Fetch</span><span class="step">✓ Transform</span><span class="step">⟳ Load</span><span class="step">○ Notify</span></div>
        <div style="margin-top:10px;display:flex;gap:8px"><button class="run-btn" onclick="runPipeline()">▶ Run Now</button></div>
      </div>
      <div class="pipeline-card">
        <div class="pipeline-header"><span class="pipeline-name">Report Generator</span><span class="badge badge-blue">SCHEDULED</span></div>
        <div class="steps"><span class="step">○ Query</span><span class="step">○ Format</span><span class="step">○ Send</span></div>
        <div style="margin-top:10px"><button class="run-btn" onclick="alert('Pipeline queued!')">▶ Run Now</button></div>
      </div>
      <div class="pipeline-card">
        <div class="pipeline-header"><span class="pipeline-name">Cleanup Job</span><span class="badge badge-yellow">IDLE</span></div>
        <div class="steps"><span class="step">○ Scan</span><span class="step">○ Delete</span><span class="step">○ Archive</span></div>
        <div style="margin-top:10px"><button class="run-btn" onclick="alert('Cleanup started!')">▶ Run Now</button></div>
      </div>
    </div>
    <div id="logs" class="section">
      <div class="terminal" id="terminal">
        <div class="log-line"><span class="ts">[09:41:00]</span> <span class="ok">[OK]</span> Pipeline started</div>
        <div class="log-line"><span class="ts">[09:41:01]</span> <span class="info">[INFO]</span> Connecting to data source...</div>
        <div class="log-line"><span class="ts">[09:41:02]</span> <span class="ok">[OK]</span> 1,284 records fetched</div>
        <div class="log-line"><span class="ts">[09:41:03]</span> <span class="info">[INFO]</span> Transforming data...</div>
        <div class="log-line"><span class="ts">[09:41:05]</span> <span class="ok">[OK]</span> Transform complete</div>
      </div>
    </div>
    <div id="schedule" class="section">
      <div class="pipeline-card"><div class="pipeline-name">Scheduled Tasks</div>
        <table style="width:100%;margin-top:12px;font-size:12px;border-collapse:collapse">
          <tr style="color:#64748b"><td style="padding:6px">Pipeline</td><td>Schedule</td><td>Next Run</td></tr>
          <tr><td style="padding:6px">Data Sync</td><td>Every 5min</td><td>09:45:00</td></tr>
          <tr><td style="padding:6px">Report Generator</td><td>Daily 06:00</td><td>Tomorrow</td></tr>
          <tr><td style="padding:6px">Cleanup Job</td><td>Weekly Sun</td><td>Sunday</td></tr>
        </table>
      </div>
    </div>
    <div id="settings" class="section"><div class="pipeline-card"><div class="pipeline-name">Configuration</div>
      <div style="margin-top:12px;font-size:12px"><div style="margin-bottom:8px;color:#64748b">API Endpoint</div><input value="https://api.example.com/v1" style="width:100%;padding:8px;background:#12121f;border:1px solid #2d2d4e;color:#4ade80;border-radius:6px;font-family:monospace;font-size:12px" /></div>
    </div></div>
  </div>
</div>
<script>
function show(id,el){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if(el)el.classList.add('active');
}
function runPipeline(){
  const t=document.getElementById('terminal');
  const msgs=['Fetching data...','Processing 1,284 records...','Applying transformations...','Validating output...','Pipeline complete ✓'];
  let i=0;
  const iv=setInterval(()=>{
    if(i>=msgs.length){clearInterval(iv);return}
    const now=new Date().toTimeString().slice(0,8);
    t.innerHTML+=\`<div class="log-line"><span class="ts">[\${now}]</span> <span class="\${i===msgs.length-1?'ok':'info'}">[\${i===msgs.length-1?'OK':'INFO'}]</span> \${msgs[i]}</div>\`;
    t.scrollTop=t.scrollHeight;i++;
  },600);
  show('logs',null);
  alert('Pipeline started! Check Logs tab.');
}
</script></body></html>`;
}

function gameTemplate(name: string, _prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden}
canvas{display:block;border:2px solid rgba(0,212,255,.3);box-shadow:0 0 40px rgba(0,212,255,.2)}
</style></head><body>
<canvas id="c"></canvas>
<script>
const c=document.getElementById('c'),ctx=c.getContext('2d');
c.width=Math.min(window.innerWidth,600);c.height=Math.min(window.innerHeight,500);
const W=c.width,H=c.height;
let score=0,lives=3,state='start',keys={},enemies=[],bullets=[],particles=[],lastEnemy=0;
const player={x:W/2,y:H-60,w:40,h:30,speed:5};

function spawnEnemy(){
  enemies.push({x:Math.random()*(W-40)+20,y:-20,w:30,h:25,speed:1.5+score/500,color:\`hsl(\${Math.random()*60+180},100%,60%)\`});
}
function spawnBullet(){
  bullets.push({x:player.x,y:player.y,speed:8});
}
function makeParticles(x,y,color){
  for(let i=0;i<8;i++)particles.push({x,y,vx:(Math.random()-0.5)*6,vy:(Math.random()-0.5)*6,life:1,color});
}
function rect(obj,col){
  ctx.fillStyle=col||'#00d4ff';
  ctx.beginPath();ctx.roundRect(obj.x-obj.w/2,obj.y-obj.h/2,obj.w,obj.h,4);ctx.fill();
}
function collide(a,b){return Math.abs(a.x-b.x)<(a.w+b.w)/2&&Math.abs(a.y-b.y)<(a.h+b.h)/2;}

let lastShot=0;
function update(t){
  if(state!=='play')return;
  if(keys['ArrowLeft']||keys['a'])player.x=Math.max(player.w/2,player.x-player.speed);
  if(keys['ArrowRight']||keys['d'])player.x=Math.min(W-player.w/2,player.x+player.speed);
  if((keys[' ']||keys['ArrowUp'])&&t-lastShot>250){spawnBullet();lastShot=t;}
  if(t-lastEnemy>900-Math.min(score*0.5,700)){spawnEnemy();lastEnemy=t;}
  bullets.forEach(b=>b.y-=b.speed);
  bullets=bullets.filter(b=>b.y>0);
  enemies.forEach(e=>e.y+=e.speed);
  for(let i=enemies.length-1;i>=0;i--){
    for(let j=bullets.length-1;j>=0;j--){
      if(collide(enemies[i],bullets[j])){makeParticles(enemies[i].x,enemies[i].y,enemies[i].color);enemies.splice(i,1);bullets.splice(j,1);score+=10;break;}
    }
  }
  for(let i=enemies.length-1;i>=0;i--){
    if(enemies[i].y>H+20){enemies.splice(i,1);lives--;if(lives<=0){state='over';}}
    else if(collide(enemies[i],player)){makeParticles(player.x,player.y,'#ff4444');enemies.splice(i,1);lives--;if(lives<=0){state='over';}}
  }
  particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.life-=0.05;p.vx*=0.95;p.vy*=0.95;});
  particles=particles.filter(p=>p.life>0);
}
function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#0a0a0f';ctx.fillRect(0,0,W,H);
  // stars
  ctx.fillStyle='rgba(255,255,255,.4)';
  for(let i=0;i<40;i++){const x=(i*137+Date.now()*0.01)%W,y=(i*89+Date.now()*0.005)%H;ctx.fillRect(x,y,1,1);}
  if(state==='start'){
    ctx.fillStyle='#00d4ff';ctx.font=\`bold \${W>400?42:28}px -apple-system,sans-serif\`;ctx.textAlign='center';
    ctx.shadowBlur=20;ctx.shadowColor='#00d4ff';
    ctx.fillText('${name.slice(0,14).toUpperCase()}',W/2,H/2-40);
    ctx.font=\`\${W>400?16:13}px -apple-system,sans-serif\`;ctx.fillStyle='#94a3b8';ctx.shadowBlur=0;
    ctx.fillText('Arrow keys / WASD to move • Space to shoot',W/2,H/2+10);
    ctx.fillStyle='rgba(0,212,255,.8)';ctx.font='bold 18px sans-serif';
    ctx.fillText('TAP OR PRESS SPACE TO START',W/2,H/2+50);
    return;
  }
  if(state==='over'){
    ctx.fillStyle='#ff4444';ctx.font='bold 40px sans-serif';ctx.textAlign='center';ctx.shadowBlur=20;ctx.shadowColor='#ff4444';
    ctx.fillText('GAME OVER',W/2,H/2-30);ctx.shadowBlur=0;
    ctx.fillStyle='#e2e8f0';ctx.font='24px sans-serif';
    ctx.fillText('Score: '+score,W/2,H/2+10);
    ctx.fillStyle='#00d4ff';ctx.font='18px sans-serif';
    ctx.fillText('Tap or Space to restart',W/2,H/2+50);
    return;
  }
  // player
  ctx.save();ctx.shadowBlur=12;ctx.shadowColor='#00d4ff';
  ctx.fillStyle='#00d4ff';ctx.beginPath();
  ctx.moveTo(player.x,player.y-player.h/2);ctx.lineTo(player.x-player.w/2,player.y+player.h/2);ctx.lineTo(player.x+player.w/2,player.y+player.h/2);ctx.closePath();ctx.fill();
  ctx.restore();
  // bullets
  bullets.forEach(b=>{ctx.fillStyle='#fff';ctx.shadowBlur=8;ctx.shadowColor='#00d4ff';ctx.fillRect(b.x-2,b.y-8,4,12);});
  // enemies
  ctx.shadowBlur=0;
  enemies.forEach(e=>{ctx.fillStyle=e.color;ctx.beginPath();ctx.moveTo(e.x,e.y+e.h/2);ctx.lineTo(e.x-e.w/2,e.y-e.h/2);ctx.lineTo(e.x+e.w/2,e.y-e.h/2);ctx.closePath();ctx.fill();});
  // particles
  particles.forEach(p=>{ctx.globalAlpha=p.life;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();});
  ctx.globalAlpha=1;
  // HUD
  ctx.fillStyle='rgba(0,0,0,.5)';ctx.fillRect(0,0,W,36);
  ctx.fillStyle='#e2e8f0';ctx.font='bold 14px sans-serif';ctx.textAlign='left';ctx.fillText('SCORE: '+score,12,22);
  ctx.textAlign='right';ctx.fillText('♥ '.repeat(lives),W-12,22);
}
document.addEventListener('keydown',e=>{keys[e.key]=true;if((e.key===' '||e.key==='ArrowUp')&&state!=='play'){startOrRestart();}e.preventDefault();});
document.addEventListener('keyup',e=>keys[e.key]=false);
c.addEventListener('click',startOrRestart);
c.addEventListener('touchstart',e=>{e.preventDefault();startOrRestart();},{passive:false});
function startOrRestart(){if(state==='start'||state==='over'){score=0;lives=3;enemies=[];bullets=[];particles=[];state='play';}}

let last=0;
function loop(t){requestAnimationFrame(loop);update(t);draw();last=t;}
requestAnimationFrame(loop);
</script></body></html>`;
}
