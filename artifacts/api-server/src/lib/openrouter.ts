const API_KEY = process.env.OPENROUTER_API_KEY;
const API_URL = "https://openrouter.ai/api/v1/chat/completions";

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
