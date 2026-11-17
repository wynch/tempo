// Bundles src/main.ts to dist/app.js and copies the static shell from web/.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const watch = process.argv.includes('--watch');
// The build id: a hash of every source file. It goes into the bundle (so the app knows what it is),
// into version.json (so a running copy can see that a newer build exists) and into the service worker's cache name.
const buildId = () => {
  const hash = createHash('sha256');
  for (const dir of ['src', 'web']) {
    for (const f of readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => e.parentPath + '/' + e.name).sort()) {
      hash.update(f); hash.update(readFileSync(f));
    }
  }
  return hash.digest('hex').slice(0, 12);
};
const copy = id => {
  mkdirSync('dist', { recursive: true }); cpSync('web', 'dist', { recursive: true });
  writeFileSync('dist/sw.js', readFileSync('web/sw.js', 'utf8').replaceAll('__VERSION__', id));
  writeFileSync('dist/version.json', JSON.stringify({ version: id }) + '\n');
};
const id = buildId();
const options = {
  entryPoints: ['src/main.ts'], outfile: 'dist/app.js', bundle: true, format: 'iife',
  target: ['safari16', 'es2022'], minify: !watch, sourcemap: true, legalComments: 'none', logLevel: 'info',
  define: { __BUILD__: JSON.stringify(id) },
  plugins: [{ name: 'copy-web', setup(b) { b.onEnd(() => copy(id)); } }],
};
if (watch) { const ctx = await context(options); await ctx.watch(); }
else await build(options);
