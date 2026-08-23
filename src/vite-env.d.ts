/// <reference types="vite/client" />

/** Optional build-time AI config (from .env) so the key can be set once, not in the Settings UI. */
interface ImportMetaEnv {
  readonly VITE_AI_PROVIDER?: string;      // "gemini" | "openai"
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_GEMINI_MODEL?: string;     // default gemini-flash-latest
  readonly VITE_OPENAI_MODEL?: string;     // default gpt-4o-mini
  readonly VITE_GEMINI_API_KEY_2?: string; // optional 2nd Gemini key (failover)
  readonly VITE_AI_AGENT?: string;         // "off" → legacy single-shot pipeline; else agent loop
  readonly VITE_AI_AGENT_MAX_STEPS?: string; // agent hop budget (default 7)
}

/** CSV imported as an asset URL (vite.config.ts → assetsInclude: ['**\/*.csv']). */
declare module "*.csv?url" {
  const value: string;
  export default value;
}
