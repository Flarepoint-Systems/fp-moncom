import type { MonCOMAPI } from '../shared/api';

declare global {
  // Injected at build time via Vite/esbuild `define` from package.json version.
  // Must live inside `declare global` because this file is a module (it imports
  // types), so a bare top-level `declare const` would be module-scoped, not global.
  const __APP_VERSION__: string;
  interface Window {
    moncom: MonCOMAPI;
  }
}
