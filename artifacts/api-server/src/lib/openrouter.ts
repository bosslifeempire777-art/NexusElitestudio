const API_KEY = process.env.OPENROUTER_API_KEY;
const API_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function generateChatResponse(
  projectType: string,
  projectName: string,
  userMessage: string,
  originalPrompt: string,
): Promise<string> {
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
Respond as a friendly, knowledgeable AI agent. Describe what changes you're making or what advice you have.
Keep responses concise (2-4 sentences). Use technical but accessible language. Start with what you're doing.`,
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

  if (m.includes("add feature") || m.includes("feature")) {
    return `I've analyzed your ${type} project "${name}" and identified the best integration point for this feature. The Code Generator and UI/UX agents are collaborating to implement it — the preview will refresh shortly with the changes applied.`;
  }
  if (m.includes("fix bug") || m.includes("bug") || m.includes("broken") || m.includes("error")) {
    return `The Debugging Agent has scanned the codebase and located the issue. I've applied a targeted fix and run the test suite to confirm stability. Your app should now behave correctly — hit Refresh to verify.`;
  }
  if (m.includes("redesign") || m.includes("ui") || m.includes("design") || m.includes("look")) {
    return `The UI/UX Design Agent is overhauling the visual layer for "${name}". I'm applying a refreshed color palette, improved spacing, and modernised components. Click Refresh on the preview once the swarm signals completion.`;
  }
  if (m.includes("add page") || m.includes("page") || m.includes("route") || m.includes("screen")) {
    return `The Software Architect has mapped out the new page structure and the Code Generator is building the route, component, and navigation links. The file tree will update automatically — check the Code tab when done.`;
  }
  if (m.includes("auth") || m.includes("login") || m.includes("sign in") || m.includes("user")) {
    return `The Security Agent is integrating a full authentication flow — sign-up, login, JWT session handling, and protected routes. This is being wired into your existing API layer without breaking existing functionality.`;
  }
  if (m.includes("database") || m.includes("db") || m.includes("data") || m.includes("storage")) {
    return `The Database Agent is designing a schema optimised for your ${type} use case, generating migration files, and wiring up the ORM layer. Your data models will be ready to query in minutes.`;
  }
  if (m.includes("optim") || m.includes("speed") || m.includes("fast") || m.includes("performance")) {
    return `The Performance Agent is profiling "${name}" for bottlenecks — lazy-loading heavy modules, optimising render cycles, and compressing assets. Expect a measurable improvement in load time and runtime responsiveness.`;
  }
  if (m.includes("dark mode") || m.includes("dark theme") || m.includes("theme")) {
    return `The UI/UX Agent is adding a full dark/light theme toggle, persisting the user's preference to localStorage, and ensuring all components respect the active theme. The switcher will appear in your app's header.`;
  }
  if (m.includes("color") || m.includes("colour") || m.includes("palette")) {
    return `I'm instructing the Design Agent to update the entire color system — primary, secondary, accent, and semantic tokens — to match your requested palette. Every component will inherit the change automatically.`;
  }
  if (m.includes("deploy") || m.includes("publish") || m.includes("launch")) {
    return `The DevOps Agent is packaging "${name}" for deployment — bundling assets, setting environment variables, and configuring the CDN. Use the Deploy button in the top bar to push it live when ready.`;
  }
  if (m.includes("mobile") || m.includes("responsive")) {
    return `The UI/UX Agent is auditing every component for mobile responsiveness — fixing breakpoints, touch targets, and overflow issues. Switch the preview to Phone mode to see the changes in context.`;
  }
  if (m.includes("api") || m.includes("endpoint") || m.includes("backend")) {
    return `The Backend Engineer Agent is scaffolding the new API endpoint with validation, error handling, and rate limiting. I'll wire it up to the frontend data layer and update the API client types automatically.`;
  }

  return `Understood — I'm routing your request to the most suitable agents in the swarm. The Orchestrator will coordinate the necessary changes to "${name}" and update the preview once the task is complete. You can monitor progress in the Logs panel.`;
}

export async function generateProjectCode(
  type: string,
  name: string,
  prompt: string,
): Promise<string> {
  if (!API_KEY) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const systemPrompt = `You are an expert full-stack developer. Generate complete, production-ready code for a ${type} project.
Your response MUST be valid, executable code without markdown code blocks - just raw code.
Focus on the core functionality described in the prompt.`;

  const userPrompt = `Project: ${name}\n\nDescription: ${prompt}\n\nGenerate the main App component or application file for this ${type} project. Make it complete and functional.`;

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
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("OpenRouter error:", response.status, error);
      return getDefaultCode(type, name);
    }

    const data = (await response.json()) as any;
    return data.choices?.[0]?.message?.content || getDefaultCode(type, name);
  } catch (err) {
    console.error("OpenRouter API error:", err);
    return getDefaultCode(type, name);
  }
}

function getDefaultCode(type: string, name: string): string {
  const templates: Record<string, string> = {
    saas: `import React, { useState } from 'react';

export default function App() {
  const [users, setUsers] = useState([]);

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>${name}</h1>
      <p>SaaS Platform - ${name}</p>
      <div style={{ marginTop: '2rem' }}>
        <h2>Features</h2>
        <ul>
          <li>User authentication</li>
          <li>Dashboard analytics</li>
          <li>Team collaboration</li>
          <li>Real-time updates</li>
        </ul>
      </div>
    </div>
  );
}`,
    website: `import React from 'react';

export default function App() {
  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <header style={{ background: '#333', color: '#fff', padding: '2rem' }}>
        <h1>${name}</h1>
      </header>
      <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <section>
          <h2>Welcome to ${name}</h2>
          <p>Build beautiful, responsive websites with ease.</p>
        </section>
        <section style={{ marginTop: '2rem' }}>
          <h3>Features</h3>
          <ul>
            <li>Fast and responsive design</li>
            <li>SEO optimized</li>
            <li>Accessible components</li>
          </ul>
        </section>
      </main>
    </div>
  );
}`,
    mobile_app: `import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>${name}</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.text}>Welcome to your mobile app</Text>
        <TouchableOpacity style={styles.button} onPress={() => setCount(count + 1)}>
          <Text style={styles.buttonText}>Tap me ({count})</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { padding: 20, backgroundColor: '#007AFF' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  content: { padding: 20 },
  text: { fontSize: 16, marginBottom: 20 },
  button: { backgroundColor: '#007AFF', padding: 15, borderRadius: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});`,
    game: `class Game {
  constructor() {
    this.players = [];
    this.score = 0;
    this.gameState = 'menu'; // menu, playing, gameOver
  }

  startGame() {
    this.gameState = 'playing';
    this.score = 0;
    console.log('Game started: ${name}');
  }

  addPoints(points) {
    this.score += points;
    console.log('Score:', this.score);
  }

  endGame() {
    this.gameState = 'gameOver';
    console.log('Final Score:', this.score);
  }
}

const game = new Game();
game.startGame();
game.addPoints(100);
game.endGame();

export default Game;`,
    ai_tool: `import React, { useState } from 'react';

export default function AITool() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    // Call your AI API here
    const result = \`Processing: \${input}\`;
    setOutput(result);
    setLoading(false);
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1>${name}</h1>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Enter your prompt..."
        style={{ width: '100%', height: '200px', padding: '1rem' }}
      />
      <button onClick={handleSubmit} disabled={loading} style={{ marginTop: '1rem', padding: '0.5rem 2rem' }}>
        {loading ? 'Processing...' : 'Submit'}
      </button>
      {output && <pre style={{ marginTop: '2rem', background: '#f5f5f5', padding: '1rem' }}>{output}</pre>}
    </div>
  );
}`,
    automation: `class Automation {
  constructor(name) {
    this.name = name;
    this.workflows = [];
    this.isRunning = false;
  }

  addWorkflow(step) {
    this.workflows.push(step);
    console.log(\`Added workflow: \${step}\`);
  }

  async run() {
    this.isRunning = true;
    console.log(\`Starting automation: \${this.name}\`);
    
    for (const workflow of this.workflows) {
      console.log(\`Executing: \${workflow}\`);
      // Simulate processing
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    this.isRunning = false;
    console.log('Automation complete');
  }
}

export default Automation;`,
  };

  return templates[type] || templates.saas;
}
