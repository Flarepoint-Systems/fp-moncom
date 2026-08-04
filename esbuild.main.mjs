import { build } from 'esbuild';

// Bundle main process + preload, marking 'electron' as external
// so Electron's built-in module is used at runtime instead of the npm package.
await build({
  entryPoints: [
    'src/main/index.ts',
    'src/main/preload.ts',
    'src/main/zone-preload.ts',
    // Spawned as its own process (ELECTRON_RUN_AS_NODE), so it needs its own bundle.
    'src/main/recorder-host.ts',
  ],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outdir: 'dist/main',
  // 'electron' resolves to the runtime's built-in module; 'koffi' is a native
  // addon (loads a prebuilt .node) and must be required from node_modules, not bundled.
  external: ['electron', 'koffi'],
  format: 'cjs',
  sourcemap: true,
});

console.log('Main process built successfully.');
