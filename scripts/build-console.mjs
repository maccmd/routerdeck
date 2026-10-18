// Build RouterDeck Console into its OpenWrt package. The router receives only
// static files; Node and esbuild are build-time tools.
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const outdir = root + 'routerdeck-console/htdocs/routerdeck';
const pkg = JSON.parse(await readFile(root + 'package.json', 'utf8'));

export const buildOptions = {
 entryPoints: { app: root + 'console/src/main.jsx' },
 outdir,
 bundle: true,
 format: 'iife',
 target: ['chrome109', 'firefox115', 'safari15.6'],
 jsx: 'automatic',
 jsxImportSource: 'preact',
 minify: true,
 legalComments: 'none',
 define: { __VERSION__: JSON.stringify(pkg.version) },
 logLevel: 'warning'
};

// Bundled third-party code keeps its MIT notices next to the bundle.
const licenses = [
 ['preact', 'node_modules/preact/LICENSE'],
 ['@preact/signals', 'node_modules/@preact/signals/LICENSE'],
 ['@preact/signals-core', 'node_modules/@preact/signals-core/LICENSE']
];

export async function writeStatic() {
 const app = await readFile(outdir + '/app.js');
 const css = await readFile(outdir + '/app.css');
 const version = createHash('sha256').update(app).update(css).digest('hex').slice(0, 12);
 const html = (await readFile(root + 'console/index.html', 'utf8')).replaceAll('__ASSET_VERSION__', version);
 await writeFile(outdir + '/index.html', html);
 await copyFile(root + 'luci-theme-routerdeck/htdocs/luci-static/routerdeck/mark.svg', outdir + '/mark.svg');
 const notices = await Promise.all(licenses.map(async ([name, file]) => `${name}\n${'-'.repeat(name.length)}\n${(await readFile(root + file, 'utf8')).trim()}\n`));
 await writeFile(outdir + '/licenses.txt', `RouterDeck Console bundles the following MIT-licensed packages.\n\n${notices.join('\n')}`);
 return version;
}

export async function buildConsole() {
 await rm(outdir, { recursive: true, force: true });
 await mkdir(outdir, { recursive: true });
 await esbuild.build(buildOptions);
 return writeStatic();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
 const version = await buildConsole();
 const size = (await readFile(outdir + '/app.js')).length;
 console.log(`Built RouterDeck Console ${pkg.version} (${version}, app.js ${Math.round(size / 1024)} KiB) in routerdeck-console/htdocs/routerdeck.`);
}
