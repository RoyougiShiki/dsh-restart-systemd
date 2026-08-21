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
 * Two identical artifacts are emitted:
 *  - `lib/client/index.js` — what `exports["./client"]` points at; the
 *    artifact the running webserver actually serves.
 *  - `lib/client.js`       — the injector toolchain's tsdown convention
 *    (`dsh.client` ⇒ single-file bundle at lib/client.js); dev_reload_package's
 *    freshness precheck blocks without it.
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

const shared = {
  entryPoints: [fileURLToPath(new URL('../src/client/index.ts', import.meta.url))],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  sourcemap: true,
  target: 'es2022',
  banner: { js: banner },
  footer: { js: footer },
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
}

for (const outfile of ['../lib/client/index.js', '../lib/client.js']) {
  await build({ ...shared, outfile: fileURLToPath(new URL(outfile, import.meta.url)) })
  console.log(`[build-client] wrote ${outfile.replace('../', '')} (${ID})`)
}
