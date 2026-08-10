/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Worker base URL. Defaults to the wrangler dev address. */
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
