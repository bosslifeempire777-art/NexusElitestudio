import { callLLM } from "./openrouter.js";

export interface ExpoFiles {
  [path: string]: string;
}

const EXPO_OWNER = "Nexuselitestudio";

const APP_JSON_TEMPLATE = (name: string, slug: string) => {
  // Bundle identifiers must contain only alphanumerics and dots (no hyphens)
  const bundleId = slug.replace(/-/g, "");
  return JSON.stringify({
    expo: {
      name,
      slug,
      owner: EXPO_OWNER,
      version: "1.0.0",
      orientation: "portrait",
      icon: "./assets/icon.png",
      userInterfaceStyle: "dark",
      splash: { image: "./assets/splash.png", resizeMode: "contain", backgroundColor: "#0a0a0f" },
      ios:     { supportsTablet: true, bundleIdentifier: `com.nexuselite.${bundleId}` },
      android: { adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#0a0a0f" }, package: `com.nexuselite.${bundleId}` },
      web:     { favicon: "./assets/favicon.png" },
    },
  }, null, 2);
};

const EAS_JSON = JSON.stringify({
  cli:   { version: ">= 5.9.0" },
  build: {
    development: { developmentClient: true, distribution: "internal" },
    preview:     { distribution: "internal", android: { buildType: "apk" } },
    production:  {},
  },
  submit: { production: {} },
}, null, 2);

const PACKAGE_JSON = (slug: string) => JSON.stringify({
  name:    slug,
  version: "1.0.0",
  main:    "expo-router/entry",
  scripts: {
    start:   "expo start",
    android: "expo start --android",
    ios:     "expo start --ios",
    web:     "expo start --web",
    build:   "eas build",
  },
  dependencies: {
    "expo":                      "~51.0.0",
    "expo-router":               "~3.5.0",
    "expo-status-bar":           "~1.12.1",
    "react":                     "18.2.0",
    "react-native":              "0.74.5",
    "react-native-safe-area-context": "4.10.5",
    "react-native-screens":      "~3.31.1",
    "@expo/vector-icons":        "^14.0.2",
    "expo-font":                 "~12.0.9",
    "expo-splash-screen":        "~0.27.5",
    "@react-native-async-storage/async-storage": "1.23.1",
  },
  devDependencies: {
    "@babel/core":        "^7.24.0",
    "@types/react":       "~18.2.79",
    "typescript":         "^5.3.3",
  },
}, null, 2);

const TSCONFIG = JSON.stringify({
  extends:         "expo/tsconfig.base",
  compilerOptions: { strict: true },
}, null, 2);

const BABEL_CONFIG = `module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
`;

const PLACEHOLDER_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export async function generateMobileCode(
  name: string,
  prompt: string,
  nexusApiBase: string,
  projectId: string,
): Promise<ExpoFiles> {
  // Canonical slug matches projectEasSlug() in projects.ts — both must use this format
  const slug = `nexus-mobile-${projectId}`.slice(0, 60);

  const system = `You are an expert React Native / Expo developer who builds polished, production-ready mobile apps.

CRITICAL RULES:
1. Output ONLY a JSON object where each key is a file path and the value is the complete file content as a string.
2. No markdown, no code fences, no explanation — ONLY the raw JSON object.
3. The JSON must be parseable by JSON.parse().
4. Build a COMPLETE, FULLY FUNCTIONAL app with real screens and navigation.
5. Use Expo Router (file-based routing in app/ directory).
6. Dark cyberpunk aesthetic: background #0a0a0f, accent #00d4ff, text #e2e8f0.
7. Use @expo/vector-icons (Ionicons) for icons — never import from react-native-vector-icons.
8. Use @react-native-async-storage/async-storage for local state.
9. For backend data: use fetch() with NEXUS_API constant (already defined in constants/api.ts).
10. Every button must have a visible onPress handler with try/catch and Alert.alert for errors.
11. Build every screen end-to-end — no placeholder "coming soon" content.
12. Use StyleSheet.create() for ALL styles, never inline style objects.
13. Escape all JSON string values properly (use \\n not actual newlines inside strings).

NEXUS BACKEND (pre-configured in constants/api.ts):
  const NEXUS_API = "${nexusApiBase}";
  listRecords(col)       → GET  NEXUS_API/col
  createRecord(col,data) → POST NEXUS_API/col  body: JSON
  updateRecord(col,id,d) → PUT  NEXUS_API/col/id body: JSON
  deleteRecord(col,id)   → DELETE NEXUS_API/col/id

FILES TO GENERATE (include ALL of these):
- app/_layout.tsx        (root layout with Stack navigator, dark theme)
- app/index.tsx          (home/main screen)
- app/(tabs)/_layout.tsx (tab bar layout if app needs tabs)
- app/(tabs)/index.tsx   (first tab screen)
- Additional screens as needed for the app features
- components/            (reusable components)
- constants/api.ts       (exports NEXUS_API and fetch helpers)
- constants/theme.ts     (colors, typography, spacing constants)

OUTPUT EXAMPLE FORMAT (shortened — generate real content):
{
  "app/_layout.tsx": "import { Stack } from 'expo-router';\\nexport default function RootLayout() { return <Stack screenOptions={{headerStyle:{backgroundColor:'#0a0a0f'}}} />; }",
  "constants/api.ts": "export const NEXUS_API = '${nexusApiBase}';\\nexport async function listRecords(col: string) { const r = await fetch(NEXUS_API+'/'+col); return r.json(); }"
}`;

  const userMsg = `Build a complete React Native / Expo mobile app called "${name}".

Requirements: ${prompt}

Generate all screens, components, navigation, and data fetching needed to fully implement this app.
Remember: output ONLY the JSON object with file paths as keys and complete file content as values.`;

  let raw = "";
  try {
    raw = await callLLM(userMsg, {
      system,
      tier:        "coding",
      maxTokens:   12_000,
      temperature: 0.5,
      agentName:   "MobileCodegen",
      agentIds:    ["code-generator"],
    });
  } catch (err: any) {
    console.error("[MobileCodegen] LLM call failed:", err?.message ?? err);
    return buildFallbackFiles(name, slug, prompt, nexusApiBase);
  }

  const jsonStr = raw
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  let appFiles: Record<string, string>;
  try {
    appFiles = JSON.parse(jsonStr);
    if (typeof appFiles !== "object" || Array.isArray(appFiles)) throw new Error("Not an object");
    console.log(`[MobileCodegen] Generated ${Object.keys(appFiles).length} files`);
  } catch (err: any) {
    console.error("[MobileCodegen] JSON parse failed:", err?.message);
    appFiles = buildFallbackFiles(name, slug, prompt, nexusApiBase);
  }

  const result: ExpoFiles = {
    "app.json":      APP_JSON_TEMPLATE(name, slug),
    "eas.json":      EAS_JSON,
    "package.json":  PACKAGE_JSON(slug),
    "tsconfig.json": TSCONFIG,
    "babel.config.js": BABEL_CONFIG,
    "assets/icon.png":          PLACEHOLDER_PNG_B64,
    "assets/splash.png":        PLACEHOLDER_PNG_B64,
    "assets/adaptive-icon.png": PLACEHOLDER_PNG_B64,
    "assets/favicon.png":       PLACEHOLDER_PNG_B64,
    ...appFiles,
  };

  return result;
}

function buildFallbackFiles(name: string, slug: string, prompt: string, nexusApiBase: string): Record<string, string> {
  return {
    "constants/api.ts": `export const NEXUS_API = '${nexusApiBase}';

export async function listRecords(col: string): Promise<any[]> {
  try {
    const r = await fetch(NEXUS_API + '/' + col);
    return r.json();
  } catch { return []; }
}

export async function createRecord(col: string, data: object): Promise<any> {
  const r = await fetch(NEXUS_API + '/' + col, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function updateRecord(col: string, id: string, data: object): Promise<any> {
  const r = await fetch(NEXUS_API + '/' + col + '/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function deleteRecord(col: string, id: string): Promise<void> {
  await fetch(NEXUS_API + '/' + col + '/' + id, { method: 'DELETE' });
}
`,

    "constants/theme.ts": `export const COLORS = {
  background:  '#0a0a0f',
  card:        '#111118',
  border:      '#1e1e2e',
  primary:     '#00d4ff',
  primaryDim:  '#00d4ff33',
  text:        '#e2e8f0',
  textMuted:   '#64748b',
  accent:      '#8b5cf6',
  error:       '#ef4444',
  success:     '#22c55e',
};

export const FONTS = {
  mono:    'Courier New',
  display: 'System',
};
`,

    "app/_layout.tsx": `import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle:            { backgroundColor: '#0a0a0f' },
          headerTintColor:        '#00d4ff',
          headerTitleStyle:       { color: '#e2e8f0', fontFamily: 'Courier New' },
          contentStyle:           { backgroundColor: '#0a0a0f' },
          headerBackTitle:        'Back',
        }}
      />
    </>
  );
}
`,

    "app/index.tsx": `import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { COLORS } from '../constants/theme';
import { listRecords, createRecord } from '../constants/api';
import { useState, useEffect } from 'react';

export default function HomeScreen() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadItems();
  }, []);

  async function loadItems() {
    try {
      setLoading(true);
      const data = await listRecords('items');
      setItems(data);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function addItem() {
    try {
      const created = await createRecord('items', { name: 'New Item ' + Date.now(), createdAt: new Date().toISOString() });
      setItems(prev => [created, ...prev]);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to create');
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>${name}</Text>
      <Text style={styles.subtitle}>${prompt.slice(0, 80)}</Text>
      <TouchableOpacity style={styles.button} onPress={addItem}>
        <Text style={styles.buttonText}>+ Add Item</Text>
      </TouchableOpacity>
      {loading ? (
        <Text style={styles.muted}>Loading...</Text>
      ) : items.length === 0 ? (
        <Text style={styles.muted}>No items yet. Tap + Add Item to get started.</Text>
      ) : (
        items.map((item, i) => (
          <View key={item.id ?? i} style={styles.card}>
            <Text style={styles.cardText}>{item.name ?? JSON.stringify(item)}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: COLORS.background },
  content:     { padding: 16, paddingBottom: 40 },
  title:       { fontSize: 28, fontWeight: 'bold', color: COLORS.primary, fontFamily: 'Courier New', marginBottom: 4 },
  subtitle:    { fontSize: 13, color: COLORS.textMuted, fontFamily: 'Courier New', marginBottom: 24, lineHeight: 18 },
  button:      { backgroundColor: COLORS.primaryDim, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 8, padding: 14, alignItems: 'center', marginBottom: 20 },
  buttonText:  { color: COLORS.primary, fontFamily: 'Courier New', fontSize: 14, fontWeight: '600' },
  card:        { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 14, marginBottom: 10 },
  cardText:    { color: COLORS.text, fontFamily: 'Courier New', fontSize: 13 },
  muted:       { color: COLORS.textMuted, fontFamily: 'Courier New', fontSize: 13, textAlign: 'center', marginTop: 40 },
});
`,
  };
}
