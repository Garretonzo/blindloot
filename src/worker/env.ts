export interface Env {
  DB: D1Database;
  SESSION: DurableObjectNamespace;
  PRESENCE: DurableObjectNamespace;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  SUPER_ADMIN_PASSWORD?: string;
}
