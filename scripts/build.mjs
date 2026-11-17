// Bundles src/main.ts to dist/app.js and copies the static shell from web/.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const watch = process.argv.includes('--watch');
const copy = () => {
  mkdirSync('dist', { recursive: true }); cpSync('web', 'dist', { recursive: true });
  // stamp the service worker with a hash of what it serves, so every build gets its own cache
  const hash = createHash('sha256');
  ['app.js', 'styles.css', 'index.html'].forEach(f => hash.update(readFileSync('dist/' + f)));
  writeFileSync('dist/sw.js', readFileSync('web/sw.js', 'utf8').replaceAll('__VERSION__', hash.digest('hex').slice(0, 12)));
};
const options = {
  entryPoints: ['src/main.ts'], outfile: 'dist/app.js', bundle: true, format: 'iife',
  target: ['safari16', 'es2022'], minify: !watch, sourcemap: true, legalComments: 'none', logLevel: 'info',
  plugins: [{ name: 'copy-web', setup(b) { b.onEnd(copy); } }],
};
if (watch) { const ctx = await context(options); await ctx.watch(); }
else await build(options);
