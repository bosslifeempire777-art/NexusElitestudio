# NexusElite AI Studio — Android bootstrap patch

This patch is intended for a separate branch, not `main`. It wraps the existing React/Vite site in Capacitor and adds a GitHub Actions workflow that builds a **debug APK for testing**.

## Files
- `mobile-build/package.json` — Capacitor Android dependencies
- `mobile-build/capacitor.config.ts` — existing Android package ID
- `mobile-build/.gitignore` — ignores generated native/build files
- `.github/workflows/android-test-apk.yml` — builds and uploads a test APK

## Apply safely
1. Create a new branch named `android-capacitor-bootstrap` from `main`.
2. Copy these files into the matching paths in that branch.
3. Check the existing `mobile-build/package.json` and `mobile-build/app.json` before replacing anything; preserve the app name, package ID, and EAS metadata you still need.
4. Commit and push the branch.
5. In GitHub, open **Actions → Android test APK → Run workflow** (or push a commit to the branch).
6. Download the `nexuselite-ai-studio-debug-apk` artifact from the completed workflow run and install it for testing.

## Important limitations
- This creates a **debug/test APK**, not a Play Store-ready signed AAB.
- The workflow points `VITE_API_URL` to the currently working Railway service. This is temporary. It does not fix custom-domain hosting or guarantee that Railway will remain available for free.
- Confirm the backend's CORS policy allows requests from the Capacitor app (`https://localhost` on Android) before expecting API/auth flows to work.
- Check the source for any hard-coded `/api` calls; only calls that honor `VITE_API_URL` will use the remote backend.
- Do not place API provider keys, database passwords, or service-role keys in the Android app.
- Do not change Cloudflare DNS or delete/migrate the Railway database as part of this build.
- Before Google Play submission, review current Play target-API requirements, privacy policy/data safety disclosures, signing, and the Google Play account requirements.
