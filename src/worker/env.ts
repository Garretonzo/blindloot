export interface Env {
  DB: D1Database;
  SESSION: DurableObjectNamespace;
  PRESENCE: DurableObjectNamespace;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  SUPER_ADMIN_PASSWORD?: string;
  /** Password everyone must enter before using the site. Unset = no gate. */
  SITE_PASSWORD?: string;
  /** Dev-only (.dev.vars): log D1 rows_read per request and per DO query. See d1-meter.ts. */
  D1_METER?: string;
}

/** Hono environment shared by every router, so contexts are interchangeable across helpers. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** Raider id resolved from the login token by the public identity middleware; null when not logged in. */
    authedRaiderId: number | null;
  };
};
