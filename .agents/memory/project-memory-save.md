---
name: Project memory save pattern
description: Why memory wasn't persisting and how the two-path fix works
---

## The rule
Project memory has two distinct code paths in `routes/projects.ts` — both must save memory AND signal the frontend.

## !hasCode path (chat-only, no generated code)
- Memory IS saved to DB inside `setImmediate`, but `updating: false` is returned
- Frontend sets `pendingBuildRef.current = false` → `onBuildComplete` never fires → `refetch()` never called
- **Fix**: after `db.update({ memory })` in the !hasCode branch, emit `emitLog(project.id, "__MEMORY_UPDATED__")`
- Frontend SSE handler catches `__MEMORY_UPDATED__` → calls `onMemoryUpdated?.()` → parent calls `refetch()`
- `AgentTerminal` now has `onMemoryUpdated?: () => void` prop

## hasCode outer-catch path (code generation threw)
- When `generateUpdatedCode` (or any prior step in the try block) throws, the outer catch handles it
- Old code: delivered reply + reset status, but **skipped** `updateProjectMemory` entirely
- **Fix**: added `updateProjectMemory` call inside the outer catch block (same pattern as success path)

## hasCode success path
- Memory IS saved before code/status update → `completeBuild` → `__DONE__` → `onBuildComplete` → `refetch()`
- This path was already working correctly

**Why:** DB query confirmed `memory: {}` for projects with many chat turns; only one project ever showed filled memory, proving the !hasCode UI-refresh gap and the outer-catch skip were the root causes.
