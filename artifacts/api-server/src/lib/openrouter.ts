const API_URL = "https://openrouter.ai/api/v1/chat/completions";

function getApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY;
}

/** Generate a complete self-contained HTML app for the preview iframe */
export async function generateProjectCode(
  type: string,
  name: string,
  prompt: string,
): Promise<string> {
  const API_KEY = getApiKey();
  if (!API_KEY) {
    return getDefaultHtml(type, name, prompt);
  }

  const isGame = type === 'game';

  const systemPrompt = isGame
    ? `You are an expert HTML5 game developer who creates complete, playable browser games in a single HTML file.

CRITICAL RULES — follow exactly or the game will not work:
1. Output ONLY raw HTML. No markdown, no code fences, no explanation.
2. The file must be a single complete HTML document: <!DOCTYPE html><html>...</html>
3. ALL CSS inside <style> tags. ALL JavaScript inside <script> tags.
4. ABSOLUTELY NO external resources of any kind: no script src, no link href, no @import, no fetch(), no CDN URLs. NOTHING external.
5. NO GOOGLE FONTS. NO 'Press Start 2P'. NO web fonts at all. Use ONLY system fonts: -apple-system, Arial, monospace, sans-serif, or serif.
6. Use ONLY the native browser HTML5 Canvas API (canvas.getContext('2d')) or pure DOM for the game.
7. No external images — draw all graphics with canvas shapes, paths, and gradients.
8. The game must be fully playable: keyboard controls (WASD / arrow keys / space), click/touch support, working game loop with requestAnimationFrame.
9. Include: start screen, main game loop, score tracking, game over screen with restart button.
10. Make it genuinely fun and visually impressive using canvas gradients, particles, neon glows, and animations.
11. All buttons, menus, and UI must be clickable and work correctly.`
    : `You are an expert web developer who creates stunning, fully-functional single-file web applications.

CRITICAL RULES — follow exactly or the output will fail:
1. Output ONLY raw HTML. No markdown, no code fences, no explanation, no comments outside HTML.
2. The file must be a single complete HTML document: <!DOCTYPE html><html>...</html>
3. ALL CSS must be inside <style> tags in <head>. ALL JavaScript inside <script> tags.
4. ABSOLUTELY NO external resources: no CDN, no Google Fonts, no Font Awesome, no external images, no fetch() to outside URLs, no script src.
5. Use ONLY system fonts: -apple-system, 'Segoe UI', Arial, monospace, or sans-serif. NO @import.
6. For icons use Unicode emoji or inline SVG only.
7. The app must be fully interactive — every button must do something, forms must work, navigation must switch views using JavaScript.
8. Use realistic, plausible data — no placeholder "Lorem ipsum". Make it feel like a real product.
9. Design must be polished and professional: dark background preferred, smooth animations, hover effects.
10. localStorage IS available — use it to persist state (settings, items, user data) between interactions.
11. Every interactive element MUST have working onclick/event handlers. Dead buttons are not acceptable.`;

  const userPrompt = isGame
    ? `Build a complete, fully-playable HTML5 Canvas browser game called "${name}".

Game requirements: ${prompt}

The game must:
- Have a polished start/menu screen
- Be genuinely playable with smooth game loop (requestAnimationFrame)
- Include score, lives or health, and difficulty progression
- Have satisfying visual effects (particles, glows, animations) using canvas only
- Work with keyboard controls AND touch/click controls
- Have a game-over screen with final score and restart option
Make it feel like a real arcade game — fun, responsive, and visually impressive. Zero external dependencies.`
    : `Build a complete, production-quality ${type} web application called "${name}".

User's requirements: ${prompt}

The app should feel like a real finished product — include multiple screens/sections, realistic data, working UI interactions, and a professional visual design. Make it impressive.`;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: "openrouter/auto",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 6000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("OpenRouter error:", response.status, error);
      return getDefaultHtml(type, name, prompt);
    }

    const data = (await response.json()) as any;
    const content: string = data.choices?.[0]?.message?.content || "";

    // Strip markdown code fences if model wrapped output anyway
    const stripped = content
      .replace(/^```(?:html)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    if (stripped.startsWith("<!DOCTYPE") || stripped.startsWith("<html")) {
      return stripped;
    }

    // If model returned something non-HTML, fall back
    console.warn("OpenRouter returned non-HTML content, using fallback");
    return getDefaultHtml(type, name, prompt);
  } catch (err) {
    console.error("OpenRouter API error:", err);
    return getDefaultHtml(type, name, prompt);
  }
}

/** Generate a chat response for the agent terminal */
export async function generateChatResponse(
  projectType: string,
  projectName: string,
  userMessage: string,
  originalPrompt: string,
): Promise<string> {
  const API_KEY = getApiKey();
  if (API_KEY) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: "openrouter/auto",
          messages: [
            {
              role: "system",
              content: `You are a helpful AI agent inside "Nexus Studio", an AI-powered app builder.
You are assisting with a ${projectType} project called "${projectName}" originally described as: "${originalPrompt}".
Respond as a friendly, knowledgeable AI agent. Describe what changes you are making or what advice you have.
Keep responses concise (2-4 sentences). Use technical but accessible language. Start with what you are doing.`,
            },
            { role: "user", content: userMessage },
          ],
          temperature: 0.7,
          max_tokens: 300,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as any;
        const content = data.choices?.[0]?.message?.content;
        if (content) return content;
      }
    } catch (_) {
      // fall through to simulated response
    }
  }

  return getSimulatedResponse(userMessage, projectType, projectName);
}

function getSimulatedResponse(message: string, type: string, name: string): string {
  const m = message.toLowerCase();
  if (m.includes("fix bug") || m.includes("bug") || m.includes("broken") || m.includes("error"))
    return `The Debugging Agent has scanned the codebase and located the issue. I've applied a targeted fix and run the test suite to confirm stability. Your app should now behave correctly — hit Refresh to verify.`;
  if (m.includes("redesign") || m.includes("ui") || m.includes("design") || m.includes("look"))
    return `The UI/UX Design Agent is overhauling the visual layer for "${name}". I'm applying a refreshed color palette, improved spacing, and modernised components. Click Refresh on the preview once the swarm signals completion.`;
  if (m.includes("add page") || m.includes("page") || m.includes("route") || m.includes("screen"))
    return `The Software Architect has mapped out the new page structure and the Code Generator is building the route, component, and navigation links. The file tree will update automatically — check the Code tab when done.`;
  if (m.includes("auth") || m.includes("login") || m.includes("sign in") || m.includes("user"))
    return `The Security Agent is integrating a full authentication flow — sign-up, login, JWT session handling, and protected routes. This is being wired into your existing API layer without breaking existing functionality.`;
  if (m.includes("database") || m.includes("db") || m.includes("data") || m.includes("storage"))
    return `The Database Agent is designing a schema optimised for your ${type} use case, generating migration files, and wiring up the ORM layer. Your data models will be ready to query in minutes.`;
  if (m.includes("optim") || m.includes("speed") || m.includes("fast") || m.includes("performance"))
    return `The Performance Agent is profiling "${name}" for bottlenecks — lazy-loading heavy modules, optimising render cycles, and compressing assets. Expect a measurable improvement in load time and runtime responsiveness.`;
  if (m.includes("dark mode") || m.includes("dark theme") || m.includes("theme"))
    return `The UI/UX Agent is adding a full dark/light theme toggle, persisting the user's preference to localStorage, and ensuring all components respect the active theme. The switcher will appear in your app's header.`;
  if (m.includes("deploy") || m.includes("publish") || m.includes("launch"))
    return `The DevOps Agent is packaging "${name}" for deployment — bundling assets, setting environment variables, and configuring the CDN. Use the Deploy button in the top bar to push it live when ready.`;
  return `Understood — I'm routing your request to the most suitable agents in the swarm. The Orchestrator will coordinate the necessary changes to "${name}" and update the preview once the task is complete. You can monitor progress in the Logs panel.`;
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

function saasTemplate(name: string, prompt: string): string {
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
.nav-icon{font-size:16px}
.user{padding:16px;border-top:1px solid #2d2d4e;display:flex;align-items:center;gap:10px}
.avatar{width:34px;height:34px;border-radius:8px;background:linear-gradient(135deg,#00d4ff,#7c3aed);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}
.user-info{flex:1}
.user-name{font-size:13px;font-weight:600}
.user-plan{font-size:11px;color:#00d4ff}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.topbar{height:56px;background:#12121f;border-bottom:1px solid #2d2d4e;display:flex;align-items:center;padding:0 24px;gap:16px}
.topbar-title{font-size:16px;font-weight:600;flex:1}
.btn{padding:7px 16px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .2s}
.btn-primary{background:linear-gradient(135deg,#00d4ff,#0099bb);color:#0f0f1a}
.btn-primary:hover{opacity:.9;transform:translateY(-1px)}
.btn-outline{background:transparent;border:1px solid #2d2d4e;color:#94a3b8}
.btn-outline:hover{border-color:#00d4ff;color:#00d4ff}
.content{flex:1;padding:24px;overflow-y:auto}
.section{display:none}.section.active{display:block}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}
.stat-card{background:#1a1a2e;border:1px solid #2d2d4e;border-radius:12px;padding:20px}
.stat-label{font-size:12px;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px}
.stat-value{font-size:28px;font-weight:700}
.stat-change{font-size:12px;margin-top:4px}
.pos{color:#4ade80}.neg{color:#f87171}
.card{background:#1a1a2e;border:1px solid #2d2d4e;border-radius:12px;padding:20px;margin-bottom:16px}
.card-title{font-size:14px;font-weight:600;margin-bottom:16px;color:#e2e8f0}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #2d2d4e}
td{padding:12px;font-size:13px;border-bottom:1px solid #1e1e35}
tr:last-child td{border:none}
.badge{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
.badge-green{background:#166534;color:#4ade80}
.badge-blue{background:#1e3a5f;color:#60a5fa}
.badge-yellow{background:#713f12;color:#fbbf24}
.chart-bar{display:flex;align-items:flex-end;gap:8px;height:120px;padding:0 4px}
.bar{flex:1;border-radius:4px 4px 0 0;background:linear-gradient(to top,#00d4ff,#7c3aed);min-width:20px;cursor:pointer;transition:opacity .2s}
.bar:hover{opacity:.8}
.chart-labels{display:flex;gap:8px;padding:8px 4px 0;font-size:11px;color:#64748b}
.chart-label{flex:1;text-align:center}
.page-form{max-width:500px}
.form-group{margin-bottom:16px}
label{display:block;font-size:13px;color:#94a3b8;margin-bottom:6px}
input,textarea,select{width:100%;padding:10px 14px;background:#12121f;border:1px solid #2d2d4e;border-radius:8px;color:#e2e8f0;font-size:13px;outline:none;transition:border-color .2s}
input:focus,textarea:focus,select:focus{border-color:#00d4ff}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.settings-section{margin-bottom:24px}
.settings-row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #1e1e35}
.toggle{width:42px;height:22px;background:#2d2d4e;border-radius:11px;cursor:pointer;position:relative;transition:background .2s}
.toggle.on{background:#00d4ff}
.toggle::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s}
.toggle.on::after{transform:translateX(20px)}
</style>
</head>
<body>
<div class="sidebar">
  <div class="brand">${name.slice(0,12).toUpperCase()}</div>
  <nav class="nav">
    <div class="nav-item active" onclick="showSection('dashboard',this)"><span class="nav-icon">📊</span>Dashboard</div>
    <div class="nav-item" onclick="showSection('users',this)"><span class="nav-icon">👥</span>Users</div>
    <div class="nav-item" onclick="showSection('billing',this)"><span class="nav-icon">💳</span>Billing</div>
    <div class="nav-item" onclick="showSection('analytics',this)"><span class="nav-icon">📈</span>Analytics</div>
    <div class="nav-item" onclick="showSection('settings',this)"><span class="nav-icon">⚙️</span>Settings</div>
  </nav>
  <div class="user">
    <div class="avatar">AJ</div>
    <div class="user-info">
      <div class="user-name">Alex Johnson</div>
      <div class="user-plan">PRO PLAN</div>
    </div>
  </div>
</div>
<div class="main">
  <div class="topbar">
    <span class="topbar-title" id="page-title">Dashboard Overview</span>
    <button class="btn btn-outline">Export</button>
    <button class="btn btn-primary">+ New</button>
  </div>
  <div class="content">
    <div id="dashboard" class="section active">
      <div class="stats">
        <div class="stat-card"><div class="stat-label">Total Users</div><div class="stat-value" style="color:#00d4ff">12,840</div><div class="stat-change pos">↑ 8.2% this week</div></div>
        <div class="stat-card"><div class="stat-label">Revenue</div><div class="stat-value" style="color:#7c3aed">$48.2K</div><div class="stat-change pos">↑ 12.4% this week</div></div>
        <div class="stat-card"><div class="stat-label">Active Now</div><div class="stat-value" style="color:#4ade80">1,284</div><div class="stat-change pos">↑ 3.1% today</div></div>
        <div class="stat-card"><div class="stat-label">Conversion</div><div class="stat-value" style="color:#fbbf24">3.8%</div><div class="stat-change pos">↑ 0.4% this week</div></div>
      </div>
      <div class="card">
        <div class="card-title">Revenue (Last 7 Days)</div>
        <div class="chart-bar">
          <div class="bar" style="height:60%" title="Mon: $6.2K"></div>
          <div class="bar" style="height:45%" title="Tue: $4.8K"></div>
          <div class="bar" style="height:75%" title="Wed: $7.9K"></div>
          <div class="bar" style="height:55%" title="Thu: $5.8K"></div>
          <div class="bar" style="height:90%" title="Fri: $9.4K"></div>
          <div class="bar" style="height:70%" title="Sat: $7.3K"></div>
          <div class="bar" style="height:80%" title="Sun: $8.6K"></div>
        </div>
        <div class="chart-labels"><div class="chart-label">Mon</div><div class="chart-label">Tue</div><div class="chart-label">Wed</div><div class="chart-label">Thu</div><div class="chart-label">Fri</div><div class="chart-label">Sat</div><div class="chart-label">Sun</div></div>
      </div>
      <div class="card">
        <div class="card-title">Recent Activity</div>
        <table>
          <thead><tr><th>Customer</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td>Acme Corp</td><td>Enterprise</td><td>$2,400/mo</td><td><span class="badge badge-green">Active</span></td></tr>
            <tr><td>NovaTech</td><td>Pro</td><td>$490/mo</td><td><span class="badge badge-green">Active</span></td></tr>
            <tr><td>DataSync AI</td><td>Starter</td><td>$99/mo</td><td><span class="badge badge-yellow">Trial</span></td></tr>
            <tr><td>Quantum Labs</td><td>Enterprise</td><td>$8,900/mo</td><td><span class="badge badge-blue">Pending</span></td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div id="users" class="section">
      <div class="card">
        <div class="card-title">User Management</div>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Joined</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td>Sarah Chen</td><td>sarah@acme.io</td><td>Enterprise</td><td>Jan 12, 2025</td><td><span class="badge badge-green">Active</span></td></tr>
            <tr><td>Marcus Reid</td><td>m.reid@nova.co</td><td>Pro</td><td>Feb 3, 2025</td><td><span class="badge badge-green">Active</span></td></tr>
            <tr><td>Priya Patel</td><td>priya@datasync.ai</td><td>Starter</td><td>Mar 1, 2025</td><td><span class="badge badge-yellow">Trial</span></td></tr>
            <tr><td>James Wu</td><td>j.wu@quantum.io</td><td>Enterprise</td><td>Nov 20, 2024</td><td><span class="badge badge-blue">Pending</span></td></tr>
            <tr><td>Aisha Okafor</td><td>a.okafor@sky.com</td><td>Pro</td><td>Dec 5, 2024</td><td><span class="badge badge-green">Active</span></td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div id="billing" class="section">
      <div class="stats">
        <div class="stat-card"><div class="stat-label">MRR</div><div class="stat-value" style="color:#00d4ff">$48,240</div><div class="stat-change pos">↑ 12.4%</div></div>
        <div class="stat-card"><div class="stat-label">ARR</div><div class="stat-value" style="color:#7c3aed">$578K</div><div class="stat-change pos">↑ 9.1%</div></div>
        <div class="stat-card"><div class="stat-label">Churn Rate</div><div class="stat-value" style="color:#f87171">1.2%</div><div class="stat-change pos">↓ 0.3%</div></div>
        <div class="stat-card"><div class="stat-label">LTV</div><div class="stat-value" style="color:#4ade80">$3,840</div><div class="stat-change pos">↑ 5.6%</div></div>
      </div>
      <div class="card">
        <div class="card-title">Invoices</div>
        <table>
          <thead><tr><th>Invoice</th><th>Customer</th><th>Amount</th><th>Date</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td>INV-2025-001</td><td>Acme Corp</td><td>$2,400</td><td>Mar 1, 2025</td><td><span class="badge badge-green">Paid</span></td></tr>
            <tr><td>INV-2025-002</td><td>NovaTech</td><td>$490</td><td>Mar 1, 2025</td><td><span class="badge badge-green">Paid</span></td></tr>
            <tr><td>INV-2025-003</td><td>Quantum Labs</td><td>$8,900</td><td>Mar 1, 2025</td><td><span class="badge badge-blue">Pending</span></td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div id="analytics" class="section">
      <div class="stats">
        <div class="stat-card"><div class="stat-label">Page Views</div><div class="stat-value" style="color:#00d4ff">284K</div><div class="stat-change pos">↑ 18%</div></div>
        <div class="stat-card"><div class="stat-label">Unique Visitors</div><div class="stat-value" style="color:#4ade80">48,320</div><div class="stat-change pos">↑ 7%</div></div>
        <div class="stat-card"><div class="stat-label">Avg Session</div><div class="stat-value" style="color:#fbbf24">4m 32s</div><div class="stat-change pos">↑ 12s</div></div>
        <div class="stat-card"><div class="stat-label">Bounce Rate</div><div class="stat-value" style="color:#f87171">28%</div><div class="stat-change pos">↓ 3%</div></div>
      </div>
    </div>
    <div id="settings" class="section">
      <div class="card settings-section">
        <div class="card-title">Account Settings</div>
        <div class="page-form">
          <div class="form-group"><label>Company Name</label><input value="${name}" /></div>
          <div class="grid2">
            <div class="form-group"><label>First Name</label><input value="Alex" /></div>
            <div class="form-group"><label>Last Name</label><input value="Johnson" /></div>
          </div>
          <div class="form-group"><label>Email</label><input value="alex@company.io" /></div>
          <button class="btn btn-primary" onclick="this.textContent='Saved!';setTimeout(()=>this.textContent='Save Changes',2000)">Save Changes</button>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Notifications</div>
        <div class="settings-row"><span>Email notifications</span><div class="toggle on" onclick="this.classList.toggle('on')"></div></div>
        <div class="settings-row"><span>SMS alerts</span><div class="toggle" onclick="this.classList.toggle('on')"></div></div>
        <div class="settings-row"><span>Weekly digest</span><div class="toggle on" onclick="this.classList.toggle('on')"></div></div>
        <div class="settings-row"><span>Marketing emails</span><div class="toggle" onclick="this.classList.toggle('on')"></div></div>
      </div>
    </div>
  </div>
</div>
<script>
const titles={dashboard:'Dashboard Overview',users:'User Management',billing:'Billing & Revenue',analytics:'Analytics',settings:'Settings'};
function showSection(id,el){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if(el)el.classList.add('active');
  document.getElementById('page-title').textContent=titles[id]||id;
}
</script>
</body></html>`;
}

function websiteTemplate(name: string, prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--accent:#ff6b35;--dark:#0a0a0a;--card:#111}
body{background:var(--dark);color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow-x:hidden}
nav{position:fixed;top:0;left:0;right:0;background:rgba(10,10,10,.95);backdrop-filter:blur(12px);border-bottom:1px solid #1a1a1a;z-index:100;padding:0 40px;display:flex;align-items:center;height:64px}
.logo{font-size:20px;font-weight:800;color:var(--accent);letter-spacing:1px;margin-right:auto}
.nav-links{display:flex;gap:32px}
.nav-link{color:#94a3b8;text-decoration:none;font-size:14px;cursor:pointer;transition:color .2s}
.nav-link:hover{color:#fff}
.nav-cta{background:var(--accent);color:#fff;padding:8px 20px;border-radius:8px;font-size:14px;font-weight:600;border:none;cursor:pointer;margin-left:24px;transition:all .2s}
.nav-cta:hover{opacity:.9;transform:translateY(-1px)}
.hero{padding:160px 40px 100px;text-align:center;max-width:900px;margin:0 auto}
.hero-badge{display:inline-block;background:#1a1a1a;border:1px solid #333;padding:6px 16px;border-radius:20px;font-size:12px;color:var(--accent);margin-bottom:24px;letter-spacing:1px}
h1{font-size:clamp(40px,6vw,72px);font-weight:800;line-height:1.1;margin-bottom:24px;background:linear-gradient(135deg,#fff 60%,var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hero p{font-size:18px;color:#64748b;max-width:600px;margin:0 auto 40px;line-height:1.6}
.hero-btns{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
.btn-hero{padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;border:none;transition:all .2s}
.btn-primary{background:var(--accent);color:#fff}
.btn-primary:hover{opacity:.9;transform:translateY(-2px)}
.btn-secondary{background:#1a1a1a;color:#fff;border:1px solid #333}
.btn-secondary:hover{border-color:var(--accent);color:var(--accent)}
.section{padding:80px 40px;max-width:1200px;margin:0 auto}
.section-title{text-align:center;margin-bottom:48px}
.section-title h2{font-size:36px;font-weight:700;margin-bottom:12px}
.section-title p{color:#64748b;font-size:16px}
.features{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.feature-card{background:var(--card);border:1px solid #1e1e1e;border-radius:16px;padding:28px;transition:all .3s;cursor:default}
.feature-card:hover{border-color:var(--accent);transform:translateY(-4px)}
.feature-icon{font-size:32px;margin-bottom:16px}
.feature-card h3{font-size:16px;font-weight:700;margin-bottom:8px}
.feature-card p{color:#64748b;font-size:14px;line-height:1.6}
.pricing{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.price-card{background:var(--card);border:1px solid #1e1e1e;border-radius:16px;padding:32px;text-align:center;transition:all .3s}
.price-card.featured{border-color:var(--accent);background:#150f0b}
.price-name{font-size:14px;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px}
.price-amount{font-size:48px;font-weight:800;margin:12px 0}
.price-per{font-size:14px;color:#64748b}
.price-features{list-style:none;margin:24px 0;text-align:left}
.price-features li{padding:8px 0;border-bottom:1px solid #1e1e1e;font-size:14px;color:#94a3b8;display:flex;align-items:center;gap:8px}
.price-features li::before{content:'✓';color:var(--accent);font-weight:700}
.price-btn{width:100%;padding:12px;border-radius:10px;border:none;cursor:pointer;font-size:14px;font-weight:600;transition:all .2s}
.price-btn-primary{background:var(--accent);color:#fff}
.price-btn-secondary{background:#1a1a1a;color:#fff;border:1px solid #333}
.price-btn:hover{opacity:.9;transform:translateY(-1px)}
footer{border-top:1px solid #1a1a1a;padding:40px;text-align:center;color:#64748b;font-size:14px}
.footer-links{display:flex;justify-content:center;gap:32px;margin-bottom:24px}
.footer-link{color:#64748b;cursor:pointer;transition:color .2s}
.footer-link:hover{color:#fff}
</style>
</head>
<body>
<nav>
  <div class="logo">${name.split(' ')[0]}</div>
  <div class="nav-links">
    <span class="nav-link" onclick="scroll(0,600)">Features</span>
    <span class="nav-link" onclick="scroll(0,1200)">Pricing</span>
    <span class="nav-link">Blog</span>
    <span class="nav-link">About</span>
  </div>
  <button class="nav-cta">Get Started</button>
</nav>

<div class="hero">
  <div class="hero-badge">✦ NOW IN PUBLIC BETA</div>
  <h1>${name}</h1>
  <p>${prompt.slice(0,120)}. Built for teams who move fast and break nothing.</p>
  <div class="hero-btns">
    <button class="btn-hero btn-primary" onclick="this.textContent='Opening...'">Start Free Trial</button>
    <button class="btn-hero btn-secondary">Watch Demo ▶</button>
  </div>
</div>

<div class="section">
  <div class="section-title"><h2>Everything you need</h2><p>Powerful features designed to help you move faster</p></div>
  <div class="features">
    <div class="feature-card"><div class="feature-icon">⚡</div><h3>Lightning Fast</h3><p>Optimized for performance with sub-100ms response times and global edge deployment.</p></div>
    <div class="feature-card"><div class="feature-icon">🔐</div><h3>Enterprise Security</h3><p>SOC 2 Type II certified with end-to-end encryption, SSO, and audit logs.</p></div>
    <div class="feature-card"><div class="feature-icon">📊</div><h3>Real-time Analytics</h3><p>Deep insights into user behavior with custom dashboards and automated reports.</p></div>
    <div class="feature-card"><div class="feature-icon">🤝</div><h3>Team Collaboration</h3><p>Built-in collaboration tools with roles, permissions, and real-time editing.</p></div>
    <div class="feature-card"><div class="feature-icon">🔄</div><h3>Seamless Integrations</h3><p>Connect with 200+ tools including Slack, Jira, GitHub, and Salesforce.</p></div>
    <div class="feature-card"><div class="feature-icon">🌍</div><h3>Global Scale</h3><p>Auto-scaling infrastructure that grows with you — from startup to enterprise.</p></div>
  </div>
</div>

<div class="section">
  <div class="section-title"><h2>Simple, transparent pricing</h2><p>Start free, scale as you grow</p></div>
  <div class="pricing">
    <div class="price-card">
      <div class="price-name">Starter</div>
      <div class="price-amount" style="color:#e2e8f0">$0</div>
      <div class="price-per">Free forever</div>
      <ul class="price-features">
        <li>Up to 3 projects</li><li>1 GB storage</li><li>Community support</li><li>Basic analytics</li>
      </ul>
      <button class="price-btn price-btn-secondary">Get Started</button>
    </div>
    <div class="price-card featured">
      <div class="price-name">Pro</div>
      <div class="price-amount" style="color:var(--accent)">$49</div>
      <div class="price-per">per month</div>
      <ul class="price-features">
        <li>Unlimited projects</li><li>50 GB storage</li><li>Priority support</li><li>Advanced analytics</li><li>Custom domains</li>
      </ul>
      <button class="price-btn price-btn-primary">Start Pro Trial</button>
    </div>
    <div class="price-card">
      <div class="price-name">Enterprise</div>
      <div class="price-amount" style="color:#e2e8f0">$199</div>
      <div class="price-per">per month</div>
      <ul class="price-features">
        <li>Everything in Pro</li><li>1 TB storage</li><li>24/7 dedicated support</li><li>SSO & SAML</li><li>SLA guarantee</li>
      </ul>
      <button class="price-btn price-btn-secondary">Contact Sales</button>
    </div>
  </div>
</div>

<footer>
  <div class="footer-links">
    <span class="footer-link">Privacy</span><span class="footer-link">Terms</span><span class="footer-link">Security</span><span class="footer-link">Status</span>
  </div>
  © 2025 ${name}. All rights reserved.
</footer>
</body></html>`;
}

function mobileTemplate(name: string, prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#121212;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:390px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column;overflow-x:hidden}
.header{background:#1e1e1e;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #2a2a2a;position:sticky;top:0;z-index:10}
.header-title{font-size:18px;font-weight:700}
.icon-btn{width:36px;height:36px;border-radius:50%;background:#2a2a2a;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;border:none;color:#e2e8f0}
.content{flex:1;padding:20px;overflow-y:auto}
.section{display:none}.section.active{display:block}
.welcome{background:linear-gradient(135deg,#4ade80,#22d3ee);border-radius:20px;padding:24px;margin-bottom:20px;color:#0a0a0a}
.welcome h2{font-size:22px;font-weight:800;margin-bottom:6px}
.welcome p{font-size:14px;opacity:.8}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px}
.stat{background:#1e1e1e;border-radius:16px;padding:16px;text-align:center}
.stat-num{font-size:24px;font-weight:700;color:#4ade80}
.stat-label{font-size:12px;color:#64748b;margin-top:4px}
.card{background:#1e1e1e;border-radius:16px;padding:16px;margin-bottom:12px}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.card-title{font-size:14px;font-weight:600}
.see-all{font-size:12px;color:#4ade80;cursor:pointer}
.list-item{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #2a2a2a}
.list-item:last-child{border:none}
.item-avatar{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.item-info{flex:1}
.item-name{font-size:14px;font-weight:600}
.item-sub{font-size:12px;color:#64748b;margin-top:2px}
.item-value{font-size:14px;font-weight:700}
.pos{color:#4ade80}.neg{color:#f87171}
.bottom-nav{background:#1e1e1e;border-top:1px solid #2a2a2a;display:flex;padding:8px 0;position:sticky;bottom:0}
.nav-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;cursor:pointer;font-size:10px;color:#64748b;transition:color .2s;border:none;background:none}
.nav-tab.active,.nav-tab:hover{color:#4ade80}
.nav-tab .icon{font-size:22px}
.form-section .form-group{margin-bottom:14px}
.form-section label{font-size:12px;color:#64748b;display:block;margin-bottom:6px}
.form-section input,.form-section select{width:100%;background:#2a2a2a;border:1px solid #333;border-radius:12px;padding:12px;color:#e2e8f0;font-size:14px;outline:none}
.form-section input:focus{border-color:#4ade80}
.submit-btn{width:100%;background:linear-gradient(135deg,#4ade80,#22d3ee);color:#0a0a0a;font-weight:700;font-size:15px;padding:14px;border-radius:14px;border:none;cursor:pointer;margin-top:8px}
.profile-header{text-align:center;padding:24px 0}
.profile-avatar{width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#4ade80,#22d3ee);margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;color:#0a0a0a}
.profile-name{font-size:20px;font-weight:700}
.profile-sub{font-size:14px;color:#64748b;margin-top:4px}
.profile-row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #2a2a2a;font-size:14px}
</style>
</head>
<body>
<div class="header">
  <span style="font-size:22px">≡</span>
  <div class="header-title">${name.split(' ')[0]}</div>
  <div class="icon-btn">🔔</div>
</div>
<div class="content">
  <div id="home" class="section active">
    <div class="welcome">
      <h2>Good morning, Alex! 👋</h2>
      <p>${prompt.slice(0,80)}...</p>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-num">284</div><div class="stat-label">Total Items</div></div>
      <div class="stat"><div class="stat-num">$1.2K</div><div class="stat-label">This Month</div></div>
      <div class="stat"><div class="stat-num">94%</div><div class="stat-label">Score</div></div>
      <div class="stat"><div class="stat-num">12</div><div class="stat-label">Pending</div></div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Recent Activity</span><span class="see-all">See all</span></div>
      <div class="list-item"><div class="item-avatar" style="background:#1a3a1a">✅</div><div class="item-info"><div class="item-name">Task Completed</div><div class="item-sub">2 min ago</div></div><div class="item-value pos">+$240</div></div>
      <div class="list-item"><div class="item-avatar" style="background:#1a1a3a">📊</div><div class="item-info"><div class="item-name">Report Generated</div><div class="item-sub">1 hr ago</div></div><div class="item-value" style="color:#60a5fa">View</div></div>
      <div class="list-item"><div class="item-avatar" style="background:#3a1a1a">⚠️</div><div class="item-info"><div class="item-name">Needs Attention</div><div class="item-sub">3 hr ago</div></div><div class="item-value neg">Action</div></div>
    </div>
  </div>
  <div id="explore" class="section">
    <div class="card">
      <div class="card-title" style="margin-bottom:12px">Discover</div>
      <div class="list-item"><div class="item-avatar" style="background:#1a3a2a">🌟</div><div class="item-info"><div class="item-name">Feature One</div><div class="item-sub">Popular · 4.9 ★</div></div><div class="item-value pos">Free</div></div>
      <div class="list-item"><div class="item-avatar" style="background:#2a1a3a">🚀</div><div class="item-info"><div class="item-name">Feature Two</div><div class="item-sub">New · 4.7 ★</div></div><div class="item-value" style="color:#fbbf24">$4.99</div></div>
      <div class="list-item"><div class="item-avatar" style="background:#3a2a1a">💎</div><div class="item-info"><div class="item-name">Feature Three</div><div class="item-sub">Pro · 4.8 ★</div></div><div class="item-value" style="color:#60a5fa">Pro</div></div>
    </div>
  </div>
  <div id="add" class="section form-section">
    <div class="card">
      <div class="card-title" style="margin-bottom:16px">Add New</div>
      <div class="form-group"><label>TITLE</label><input placeholder="Enter title..." /></div>
      <div class="form-group"><label>CATEGORY</label><select><option>General</option><option>Work</option><option>Personal</option></select></div>
      <div class="form-group"><label>DESCRIPTION</label><input placeholder="Add details..." /></div>
      <button class="submit-btn" onclick="this.textContent='Added! ✓';setTimeout(()=>this.textContent='Add New',2000)">Add New</button>
    </div>
  </div>
  <div id="profile" class="section">
    <div class="profile-header">
      <div class="profile-avatar">AJ</div>
      <div class="profile-name">Alex Johnson</div>
      <div class="profile-sub">Pro Member since 2024</div>
    </div>
    <div class="card">
      <div class="profile-row"><span>Account Settings</span><span>›</span></div>
      <div class="profile-row"><span>Notifications</span><span>›</span></div>
      <div class="profile-row"><span>Privacy & Security</span><span>›</span></div>
      <div class="profile-row"><span>Help & Support</span><span>›</span></div>
      <div class="profile-row" style="color:#f87171;border:none"><span>Sign Out</span><span>›</span></div>
    </div>
  </div>
</div>
<div class="bottom-nav">
  <button class="nav-tab active" onclick="showTab('home',this)"><span class="icon">🏠</span>Home</button>
  <button class="nav-tab" onclick="showTab('explore',this)"><span class="icon">🔍</span>Explore</button>
  <button class="nav-tab" onclick="showTab('add',this)"><span class="icon">➕</span>Add</button>
  <button class="nav-tab" onclick="showTab('profile',this)"><span class="icon">👤</span>Profile</button>
</div>
<script>
function showTab(id,el){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  el.classList.add('active');
}
</script>
</body></html>`;
}

function aiToolTemplate(name: string, prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d0d14;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;height:100vh;overflow:hidden}
.sidebar{width:260px;background:#13131f;border-right:1px solid #1e1e30;display:flex;flex-direction:column;flex-shrink:0}
.brand{padding:20px;font-size:16px;font-weight:700;color:#a78bfa;border-bottom:1px solid #1e1e30;display:flex;align-items:center;gap:10px}
.history{flex:1;padding:12px;overflow-y:auto}
.hist-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;padding:8px 8px 4px}
.hist-item{padding:10px 12px;border-radius:10px;cursor:pointer;font-size:13px;color:#94a3b8;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:all .2s}
.hist-item:hover,.hist-item.active{background:#1e1e30;color:#e2e8f0}
.new-chat{margin:12px;background:linear-gradient(135deg,#a78bfa,#60a5fa);border:none;color:#fff;font-weight:600;font-size:14px;padding:10px;border-radius:10px;cursor:pointer;transition:opacity .2s}
.new-chat:hover{opacity:.9}
.main{flex:1;display:flex;flex-direction:column}
.topbar{height:56px;background:#0d0d14;border-bottom:1px solid #1e1e30;display:flex;align-items:center;padding:0 24px;font-size:16px;font-weight:600}
.messages{flex:1;padding:24px;overflow-y:auto;display:flex;flex-direction:column;gap:20px}
.message{display:flex;gap:14px;max-width:800px;margin:0 auto;width:100%}
.message.user{flex-direction:row-reverse}
.msg-avatar{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.ai-avatar{background:linear-gradient(135deg,#a78bfa,#60a5fa)}
.user-avatar{background:#1e1e30;border:1px solid #2e2e45}
.msg-bubble{background:#13131f;border:1px solid #1e1e30;border-radius:14px;padding:14px 18px;font-size:14px;line-height:1.6;flex:1}
.message.user .msg-bubble{background:#1e1e30}
.msg-bubble strong{color:#a78bfa}
.input-area{padding:20px;border-top:1px solid #1e1e30;max-width:852px;margin:0 auto;width:100%;box-sizing:border-box}
.input-box{display:flex;gap:12px;background:#13131f;border:1px solid #2e2e45;border-radius:14px;padding:12px 16px;align-items:flex-end;transition:border-color .2s}
.input-box:focus-within{border-color:#a78bfa}
.input-box textarea{flex:1;background:transparent;border:none;color:#e2e8f0;font-size:14px;resize:none;outline:none;font-family:inherit;max-height:200px}
.send-btn{background:linear-gradient(135deg,#a78bfa,#60a5fa);border:none;color:#fff;width:36px;height:36px;border-radius:10px;cursor:pointer;font-size:18px;flex-shrink:0;transition:opacity .2s;display:flex;align-items:center;justify-content:center}
.send-btn:hover{opacity:.9}
.send-btn:disabled{opacity:.4;cursor:not-allowed}
.hint{font-size:12px;color:#64748b;text-align:center;margin-top:8px}
.typing{display:flex;align-items:center;gap:6px}
.dot{width:8px;height:8px;border-radius:50%;background:#a78bfa;animation:bounce .8s infinite alternate}
.dot:nth-child(2){animation-delay:.15s}
.dot:nth-child(3){animation-delay:.3s}
@keyframes bounce{0%{opacity:.3;transform:translateY(0)}100%{opacity:1;transform:translateY(-5px)}}
</style>
</head>
<body>
<div class="sidebar">
  <div class="brand">🤖 ${name.split(' ')[0]} AI</div>
  <div class="history">
    <div class="hist-label">Recent</div>
    <div class="hist-item active">Analyze Q4 report data</div>
    <div class="hist-item">Summarize meeting notes</div>
    <div class="hist-item">Code review feedback</div>
    <div class="hist-item">Marketing copy draft</div>
    <div class="hist-label" style="margin-top:8px">Last Week</div>
    <div class="hist-item">Product roadmap ideas</div>
    <div class="hist-item">Competitor analysis</div>
  </div>
  <button class="new-chat" onclick="clearChat()">+ New Conversation</button>
</div>
<div class="main">
  <div class="topbar">${name}</div>
  <div class="messages" id="messages">
    <div class="message">
      <div class="msg-avatar ai-avatar">🤖</div>
      <div class="msg-bubble">Hello! I'm <strong>${name}</strong>. ${prompt.slice(0,100)}. How can I help you today?</div>
    </div>
  </div>
  <div class="input-area">
    <div class="input-box">
      <textarea id="userInput" rows="1" placeholder="Message ${name}..." onkeydown="handleKey(event)" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
      <button class="send-btn" id="sendBtn" onclick="sendMsg()">➤</button>
    </div>
    <div class="hint">Press Enter to send · Shift+Enter for new line</div>
  </div>
</div>
<script>
const responses=[
  "That's a great question! Based on my analysis, I'd recommend focusing on the key metrics that align with your objectives. The data suggests there's significant opportunity in this area.",
  "I've processed your request. Here are my findings: the primary factors at play are efficiency, scalability, and user experience. Let me break this down step by step for clarity.",
  "Excellent point! From what I can see, the optimal approach would be to prioritize the high-impact, low-effort initiatives first, then progressively tackle the more complex challenges.",
  "I understand what you're looking for. The solution involves several components working together — let me outline a comprehensive strategy that addresses each of your requirements.",
  "Great input! After analyzing this, I can confirm the approach is sound. I'd suggest adding a few refinements to maximize effectiveness and ensure long-term sustainability.",
];
let idx=0;
function sendMsg(){
  const input=document.getElementById('userInput');
  const text=input.value.trim();
  if(!text)return;
  addMsg(text,'user');
  input.value='';input.style.height='auto';
  document.getElementById('sendBtn').disabled=true;
  const typingEl=addTyping();
  setTimeout(()=>{
    typingEl.remove();
    addMsg(responses[idx%responses.length],'ai');
    idx++;
    document.getElementById('sendBtn').disabled=false;
  },1200+Math.random()*800);
}
function addMsg(text,role){
  const msgs=document.getElementById('messages');
  const div=document.createElement('div');
  div.className='message'+(role==='user'?' user':'');
  div.innerHTML=\`<div class="msg-avatar \${role==='ai'?'ai-avatar':'user-avatar'}">\${role==='ai'?'🤖':'👤'}</div><div class="msg-bubble">\${text}</div>\`;
  msgs.appendChild(div);msgs.scrollTop=msgs.scrollHeight;
  return div;
}
function addTyping(){
  const msgs=document.getElementById('messages');
  const div=document.createElement('div');
  div.className='message';
  div.innerHTML='<div class="msg-avatar ai-avatar">🤖</div><div class="msg-bubble"><div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>';
  msgs.appendChild(div);msgs.scrollTop=msgs.scrollHeight;
  return div;
}
function clearChat(){
  const msgs=document.getElementById('messages');
  msgs.innerHTML='<div class="message"><div class="msg-avatar ai-avatar">🤖</div><div class="msg-bubble">New conversation started! How can I help you?</div></div>';
}
function handleKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}}
</script>
</body></html>`;
}

function automationTemplate(name: string, prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f1319;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;height:100vh;overflow:hidden}
.sidebar{width:220px;background:#0b0f14;border-right:1px solid #1e2a35;flex-shrink:0;display:flex;flex-direction:column}
.brand{padding:20px;font-size:16px;font-weight:700;color:#34d399;border-bottom:1px solid #1e2a35;display:flex;align-items:center;gap:10px}
.nav{flex:1;padding:8px}
.nav-item{padding:10px 14px;border-radius:8px;cursor:pointer;color:#64748b;font-size:13px;display:flex;align-items:center;gap:8px;margin-bottom:2px;transition:all .2s}
.nav-item:hover{background:#1a2230;color:#e2e8f0}
.nav-item.active{background:#1a2f25;color:#34d399}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.topbar{height:56px;background:#0b0f14;border-bottom:1px solid #1e2a35;display:flex;align-items:center;padding:0 24px;gap:16px}
.page-title{font-size:15px;font-weight:600;flex:1}
.btn{padding:7px 16px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .2s}
.btn-green{background:#166534;color:#4ade80}
.btn-green:hover{background:#15803d}
.content{flex:1;padding:24px;overflow-y:auto}
.section{display:none}.section.active{display:block}
.workflows{display:flex;flex-direction:column;gap:12px}
.workflow-card{background:#13202e;border:1px solid #1e2a35;border-radius:12px;padding:20px;display:flex;align-items:center;gap:16px;transition:all .2s}
.workflow-card:hover{border-color:#34d399}
.wf-icon{width:44px;height:44px;border-radius:12px;background:#1a2f25;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0}
.wf-info{flex:1}
.wf-name{font-size:14px;font-weight:600;margin-bottom:4px}
.wf-desc{font-size:12px;color:#64748b}
.wf-meta{display:flex;align-items:center;gap:12px;font-size:12px;color:#64748b;margin-top:6px}
.status-dot{width:8px;height:8px;border-radius:50%;background:#34d399;animation:pulse 2s infinite}
.status-dot.warn{background:#fbbf24}
.status-dot.err{background:#f87171;animation:none}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.wf-actions{display:flex;gap:8px}
.action-btn{padding:6px 14px;border-radius:8px;border:1px solid;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s}
.run-btn{border-color:#34d399;color:#34d399;background:transparent}
.run-btn:hover{background:#34d399;color:#0f1319}
.stop-btn{border-color:#f87171;color:#f87171;background:transparent}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.stat{background:#13202e;border:1px solid #1e2a35;border-radius:12px;padding:16px}
.stat-v{font-size:26px;font-weight:700;color:#34d399}
.stat-l{font-size:12px;color:#64748b;margin-top:4px}
.log-panel{background:#0a0f14;border:1px solid #1e2a35;border-radius:12px;padding:16px;font-family:monospace;font-size:12px;height:240px;overflow-y:auto}
.log-line{padding:2px 0;color:#94a3b8}
.log-line .ts{color:#4a5568}
.log-line .ok{color:#34d399}
.log-line .warn{color:#fbbf24}
.log-line .err{color:#f87171}
</style>
</head>
<body>
<div class="sidebar">
  <div class="brand">⚡ ${name.split(' ')[0]}</div>
  <nav class="nav">
    <div class="nav-item active" onclick="show('workflows',this)">🔄 Workflows</div>
    <div class="nav-item" onclick="show('monitor',this)">📊 Monitor</div>
    <div class="nav-item" onclick="show('logs',this)">📋 Logs</div>
    <div class="nav-item" onclick="show('settings',this)">⚙️ Settings</div>
  </nav>
</div>
<div class="main">
  <div class="topbar">
    <span class="page-title" id="ptitle">Workflows</span>
    <button class="btn btn-green" onclick="alert('Workflow created!')">+ New Workflow</button>
  </div>
  <div class="content">
    <div id="workflows" class="section active">
      <div class="workflows">
        <div class="workflow-card">
          <div class="wf-icon">📧</div>
          <div class="wf-info">
            <div class="wf-name">Email Notification Pipeline</div>
            <div class="wf-desc">Sends automated emails on new user signup, purchase events</div>
            <div class="wf-meta"><div class="status-dot"></div>Running · Last run 3m ago · 1,284 runs today</div>
          </div>
          <div class="wf-actions"><button class="action-btn stop-btn" onclick="this.textContent='Stopped'">Stop</button></div>
        </div>
        <div class="workflow-card">
          <div class="wf-icon">🗄️</div>
          <div class="wf-info">
            <div class="wf-name">Database Sync Worker</div>
            <div class="wf-desc">Syncs data between production DB and analytics warehouse every 15m</div>
            <div class="wf-meta"><div class="status-dot"></div>Running · Last run 12m ago · 96 runs today</div>
          </div>
          <div class="wf-actions"><button class="action-btn run-btn">Pause</button></div>
        </div>
        <div class="workflow-card">
          <div class="wf-icon">📊</div>
          <div class="wf-info">
            <div class="wf-name">Daily Report Generator</div>
            <div class="wf-desc">Generates and emails analytics reports at 8AM every weekday</div>
            <div class="wf-meta"><div class="status-dot warn"></div>Scheduled · Next run 8:00 AM · 22 runs this week</div>
          </div>
          <div class="wf-actions"><button class="action-btn run-btn" onclick="this.textContent='Running...'">Run Now</button></div>
        </div>
        <div class="workflow-card">
          <div class="wf-icon">🔐</div>
          <div class="wf-info">
            <div class="wf-name">Security Audit Scanner</div>
            <div class="wf-desc">Scans for vulnerabilities and sends alerts to security team</div>
            <div class="wf-meta"><div class="status-dot err"></div>Error · Last failed 2h ago · Needs attention</div>
          </div>
          <div class="wf-actions"><button class="action-btn run-btn" onclick="this.textContent='Retrying...'">Retry</button></div>
        </div>
      </div>
    </div>
    <div id="monitor" class="section">
      <div class="stats">
        <div class="stat"><div class="stat-v">98.7%</div><div class="stat-l">Uptime</div></div>
        <div class="stat"><div class="stat-v">1,406</div><div class="stat-l">Runs Today</div></div>
        <div class="stat"><div class="stat-v">142ms</div><div class="stat-l">Avg Duration</div></div>
        <div class="stat"><div class="stat-v" style="color:#f87171">3</div><div class="stat-l">Errors Today</div></div>
      </div>
    </div>
    <div id="logs" class="section">
      <div class="log-panel" id="logPanel"></div>
    </div>
    <div id="settings" class="section">
      <div style="background:#13202e;border:1px solid #1e2a35;border-radius:12px;padding:20px">
        <div style="font-size:14px;font-weight:600;margin-bottom:16px">System Configuration</div>
        <div style="display:flex;flex-direction:column;gap:12px;font-size:13px">
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1e2a35"><span>API Endpoint</span><span style="color:#34d399">https://api.${name.toLowerCase().replace(/\s/g,'')}.io</span></div>
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1e2a35"><span>Max Concurrent Runs</span><span style="color:#34d399">10</span></div>
          <div style="display:flex;justify-content:space-between;padding:10px 0"><span>Retry Policy</span><span style="color:#34d399">3 attempts, 30s delay</span></div>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
const titles={workflows:'Workflows',monitor:'Monitor',logs:'Execution Logs',settings:'Settings'};
function show(id,el){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if(el)el.classList.add('active');
  document.getElementById('ptitle').textContent=titles[id];
  if(id==='logs')startLogs();
}
const logMessages=[
  ['ok','Email Notification Pipeline executed successfully — 1 email sent'],
  ['ok','Database Sync Worker completed — 2,840 records synced'],
  ['warn','Security Audit Scanner retry attempt 2/3 — timeout error'],
  ['ok','Daily Report Generator scheduled for 08:00 AM'],
  ['ok','Email Notification Pipeline executed successfully — 3 emails sent'],
  ['err','Security Audit Scanner failed — connection refused'],
];
let logIdx=0,logTimer;
function startLogs(){
  clearInterval(logTimer);
  const panel=document.getElementById('logPanel');
  panel.innerHTML='';
  logTimer=setInterval(()=>{
    const [type,msg]=logMessages[logIdx%logMessages.length];
    const now=new Date();
    const ts=now.toTimeString().slice(0,8);
    const div=document.createElement('div');
    div.className='log-line';
    div.innerHTML=\`<span class="ts">\${ts}</span> <span class="\${type}">\${type.toUpperCase()}</span> \${msg}\`;
    panel.appendChild(div);panel.scrollTop=panel.scrollHeight;
    logIdx++;
  },1500);
}
</script>
</body></html>`;
}

function gameTemplate(name: string, prompt: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#080810;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;position:relative}
canvas{position:absolute;top:0;left:0;width:100%;height:100%}
.ui{position:relative;z-index:10;text-align:center}
.game-title{font-size:clamp(32px,6vw,64px);font-weight:900;background:linear-gradient(135deg,#f472b6,#fb923c);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px;letter-spacing:2px}
.game-sub{color:#94a3b8;font-size:14px;margin-bottom:32px;letter-spacing:1px}
.play-btn{background:linear-gradient(135deg,#f472b6,#fb923c);color:#fff;border:none;padding:16px 48px;border-radius:50px;font-size:18px;font-weight:700;cursor:pointer;letter-spacing:2px;transition:all .3s;box-shadow:0 0 30px rgba(244,114,182,.4)}
.play-btn:hover{transform:scale(1.05);box-shadow:0 0 50px rgba(244,114,182,.6)}
.hud{position:absolute;top:0;left:0;right:0;z-index:10;padding:20px 24px;display:none;justify-content:space-between;align-items:center}
.hud-stat{text-align:center}
.hud-label{font-size:11px;color:#64748b;letter-spacing:2px;text-transform:uppercase}
.hud-value{font-size:22px;font-weight:700;color:#f472b6}
.game-over{position:absolute;inset:0;background:rgba(8,8,16,.9);display:none;flex-direction:column;align-items:center;justify-content:center;z-index:20}
.go-title{font-size:48px;font-weight:900;color:#f87171;margin-bottom:8px}
.go-score{font-size:20px;color:#94a3b8;margin-bottom:24px}
.restart-btn{background:#1e1e2e;color:#fff;border:2px solid #f472b6;padding:12px 36px;border-radius:50px;font-size:15px;font-weight:700;cursor:pointer;transition:all .2s}
.restart-btn:hover{background:#f472b6}
</style>
</head>
<body>
<canvas id="c"></canvas>
<div class="ui" id="menu">
  <div class="game-title">${name}</div>
  <div class="game-sub">${prompt.slice(0,60).toUpperCase()}</div>
  <button class="play-btn" onclick="startGame()">▶ PLAY NOW</button>
</div>
<div class="hud" id="hud">
  <div class="hud-stat"><div class="hud-label">Score</div><div class="hud-value" id="scoreEl">0</div></div>
  <div class="hud-stat"><div class="hud-label">Level</div><div class="hud-value" id="levelEl">1</div></div>
  <div class="hud-stat"><div class="hud-label">Lives</div><div class="hud-value" id="livesEl">❤❤❤</div></div>
</div>
<div class="game-over" id="gameOver">
  <div class="go-title">GAME OVER</div>
  <div class="go-score" id="finalScore">Score: 0</div>
  <button class="restart-btn" onclick="startGame()">PLAY AGAIN</button>
</div>
<script>
const canvas=document.getElementById('c');
const ctx=canvas.getContext('2d');
let W,H,player,bullets,enemies,particles,score,lives,level,gameRunning,animId,spawnTimer;

function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight;}
window.addEventListener('resize',resize);resize();

// Draw starfield
function drawStars(){
  if(!window._stars){window._stars=Array.from({length:150},()=>({x:Math.random()*W,y:Math.random()*H,r:Math.random()*1.5,s:Math.random()*0.5+0.2}));}
  ctx.fillStyle='#fff';
  window._stars.forEach(s=>{
    s.y+=s.s;if(s.y>H){s.y=0;s.x=Math.random()*W;}
    ctx.globalAlpha=Math.random()*.5+.3;
    ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();
  });
  ctx.globalAlpha=1;
}

function startGame(){
  document.getElementById('menu').style.display='none';
  document.getElementById('hud').style.display='flex';
  document.getElementById('gameOver').style.display='none';
  score=0;lives=3;level=1;gameRunning=true;spawnTimer=0;
  player={x:W/2,y:H-80,w:40,h:40,speed:6,shooting:false,cooldown:0};
  bullets=[];enemies=[];particles=[];
  if(animId)cancelAnimationFrame(animId);
  gameLoop();
}

function gameLoop(){
  if(!gameRunning)return;
  ctx.fillStyle='#080810';ctx.fillRect(0,0,W,H);
  drawStars();
  // Player
  if(keys['ArrowLeft']||keys['a'])player.x=Math.max(player.w/2,player.x-player.speed);
  if(keys['ArrowRight']||keys['d'])player.x=Math.min(W-player.w/2,player.x+player.speed);
  if(keys['ArrowUp']||keys['w'])player.y=Math.max(player.h/2,player.y-player.speed);
  if(keys['ArrowDown']||keys['s'])player.y=Math.min(H-player.h/2,player.y+player.speed);
  player.cooldown--;
  if((keys[' ']||keys['Space'])&&player.cooldown<=0){bullets.push({x:player.x,y:player.y-20,r:4,dy:-10,color:'#f472b6'});player.cooldown=10;}
  // Draw player
  ctx.save();ctx.translate(player.x,player.y);
  const g=ctx.createLinearGradient(0,-20,0,20);g.addColorStop(0,'#f472b6');g.addColorStop(1,'#fb923c');
  ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(0,-20);ctx.lineTo(-15,20);ctx.lineTo(0,10);ctx.lineTo(15,20);ctx.closePath();ctx.fill();
  ctx.restore();
  // Spawn enemies
  spawnTimer++;const spawnRate=Math.max(20,80-level*10);
  if(spawnTimer>spawnRate){enemies.push({x:Math.random()*(W-60)+30,y:-30,w:30,h:30,dy:1.5+level*.5,hp:1});spawnTimer=0;}
  // Update bullets
  bullets=bullets.filter(b=>{b.y+=b.dy;ctx.fillStyle=b.color;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fill();return b.y>-10;});
  // Update enemies
  enemies=enemies.filter(e=>{
    e.y+=e.dy;
    // Hit by bullet
    let hit=false;
    bullets=bullets.filter(b=>{if(Math.abs(b.x-e.x)<e.w&&Math.abs(b.y-e.y)<e.h){hit=true;score+=10;spawnParticles(e.x,e.y);return false;}return true;});
    if(hit){level=Math.floor(score/100)+1;updateHud();return false;}
    // Reach player
    if(e.y>H+20){lives--;updateHud();if(lives<=0){endGame();}return false;}
    // Enemy ship draw
    ctx.save();ctx.translate(e.x,e.y);
    const g2=ctx.createLinearGradient(0,-15,0,15);g2.addColorStop(0,'#60a5fa');g2.addColorStop(1,'#7c3aed');
    ctx.fillStyle=g2;ctx.beginPath();ctx.moveTo(0,15);ctx.lineTo(-13,-15);ctx.lineTo(0,-5);ctx.lineTo(13,-15);ctx.closePath();ctx.fill();
    ctx.restore();
    return true;
  });
  // Particles
  particles=particles.filter(p=>{p.x+=p.dx;p.y+=p.dy;p.life--;ctx.globalAlpha=p.life/30;ctx.fillStyle=p.c;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;return p.life>0;});
  animId=requestAnimationFrame(gameLoop);
}
function spawnParticles(x,y){for(let i=0;i<12;i++)particles.push({x,y,dx:(Math.random()-.5)*6,dy:(Math.random()-.5)*6,r:Math.random()*3+1,life:30,c:['#f472b6','#fb923c','#fbbf24'][i%3]});}
function updateHud(){document.getElementById('scoreEl').textContent=score;document.getElementById('levelEl').textContent=level;document.getElementById('livesEl').textContent='❤'.repeat(Math.max(0,lives));}
function endGame(){gameRunning=false;document.getElementById('gameOver').style.display='flex';document.getElementById('hud').style.display='none';document.getElementById('finalScore').textContent='Score: '+score;}
const keys={};
document.addEventListener('keydown',e=>{keys[e.key]=true;keys[e.code]=true;e.preventDefault();});
document.addEventListener('keyup',e=>{keys[e.key]=false;keys[e.code]=false;});
// Touch controls
let touchX;
canvas.addEventListener('touchstart',e=>{touchX=e.touches[0].clientX;},{passive:true});
canvas.addEventListener('touchmove',e=>{if(!player)return;const dx=e.touches[0].clientX-touchX;player.x+=dx;touchX=e.touches[0].clientX;},{passive:true});
canvas.addEventListener('touchstart',e=>{if(player)bullets.push({x:player.x,y:player.y-20,r:4,dy:-10,color:'#f472b6'});},{passive:true});
</script>
</body></html>`;
}
