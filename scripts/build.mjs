import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
// Emit runtime bundles beside the root manifest, so the original project folder
// remains loadable with Chrome's Load unpacked button.
await build({ entryPoints: ['src/dashboard.js', 'src/background.js'], bundle: true, outdir: '.', format: 'esm', target: 'chrome111', sourcemap: false, legalComments: 'eof' });
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const path of ['manifest.json', 'dashboard.html', 'dashboard.js', 'background.js', 'styles.css', 'assets']) await cp(path, `dist/${path}`, { recursive: true });
console.log('Built extension. Load this project folder or dist/ in chrome://extensions.');
