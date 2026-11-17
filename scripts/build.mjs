// Bundles src/main.ts to dist/app.js and copies the static shell from web/.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const copy = () => { mkdirSync('dist', { recursive: true }); cpSync('web', 'dist', { recursive: true }); };
const options = {
  entryPoints: ['src/main.ts'], outfile: 'dist/app.js', bundle: true, format: 'iife',
  target: ['safari16', 'es2022'], minify: !watch, sourcemap: true, legalComments: 'none', logLevel: 'info',
  plugins: [{ name: 'copy-web', setup(b) { b.onEnd(copy); } }],
};
if (watch) { const ctx = await context(options); await ctx.watch(); }
else await build(options);
