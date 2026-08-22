export interface Env {
  DB: D1Database;
  SESSION: DurableObjectNamespace;
  PRESENCE: DurableObjectNamespace;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  SUPER_ADMIN_PASSWORD?: string;
  /** Password everyone must enter before using the site. Unset = no gate. */
  SITE_PASSWORD?: string;
}
