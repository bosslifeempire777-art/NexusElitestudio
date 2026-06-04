---
name: OpenRouter model ID audit
description: Dead model IDs that caused 400-error storms in the worker swarm, and their confirmed replacements.
---

## Rule
Always verify model IDs against the live OpenRouter endpoint before adding them to MODEL_TIERS:
```
curl https://openrouter.ai/api/v1/models -H "Authorization: Bearer $OPENROUTER_API_KEY"
```

## Confirmed-dead IDs and replacements (as of 2026-06-04)
| Dead ID | Replacement |
|---------|------------|
| `qwen/qwen3.6-coder` | `qwen/qwen3-coder` |
| `deepseek/deepseek-chat-v4` | `deepseek/deepseek-chat` |
| `deepseek/deepseek-v4` | `deepseek/deepseek-chat` |
| `google/gemini-3.5-pro` | `google/gemini-2.5-pro` |
| `google/gemini-2.0-flash-001` | `google/gemini-2.5-flash` (the 2.0 line is absent from OR entirely) |

**Why:** The swarm config accumulated speculative/future model IDs that OpenRouter never activated. Each one ends up at the front of a fallback chain, causing every worker to burn one HTTP 400 round-trip before reaching a working model.

**How to apply:** When editing `openrouter.ts` or `hydraSwarm.ts` MODEL_TIERS, run the verification curl above and check all new IDs before committing.
