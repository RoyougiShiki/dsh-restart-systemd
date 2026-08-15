/**
 * Build the browser client bundle for dsh-restart-systemd.
 *
 * DSH's client-modules loader serves `/plugins/<id>/client.js` and requires
 * the file to self-register via `window.__ModuleLoader__.load({ id, factory })`
 * — the same artifact shape the official packages emit from their shared
 * tsdown preset (packages/client/tsdown.client.ts). We reproduce it with
 * esbuild: bundle the client half to CJS (free `require`/`module`/`exports`
 * resolved by the loader's module table), then wrap it in the load handoff.
 *
 * Externals are exactly the loader's platform seed words that this client
 * imports at runtime: react / react-dom / react/jsx-runtime. Everything
 * else in src/client is either bundled in or an `import type` (erased).
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const ID = 'dsh-restart-systemd'

const banner = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
`

const footer = `
\t\treturn module.exports;
\t}
});
`

await build({
  entryPoints: [fileURLToPath(new URL('../src/client/index.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../lib/client/index.js', import.meta.url)),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  sourcemap: true,
  target: 'es2022',
  banner: { js: banner },
  footer: { js: footer },
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
})

console.log(`[build-client] wrote lib/client/index.js (${ID})`)
