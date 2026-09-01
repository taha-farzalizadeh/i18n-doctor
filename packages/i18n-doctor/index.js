/**
 * i18n-doctor — programmatic entry point.
 *
 * The CLI is exposed through the `i18n-doctor` binary; this module exposes the
 * typed configuration API so `i18n-doctor.config.ts` can import it:
 *
 * ```ts
 * import { defineConfig } from "i18n-doctor";
 *
 * export default defineConfig({
 *   ignoreKeys: ["SERVER_*", "BACKEND_*"],
 * });
 * ```
 */
export {
  defineConfig,
  loadConfig,
  createConfigLoader,
  createEffectiveConfigResolver,
  createIgnoreEngine,
} from "@i18n-doctor/config";
