/**
 * The entry point of SEAs built with `buildApp`.
 * Embedded files are extracted to a cache on first run, since native addons can only be loaded from real files.
 * Only built-in modules can be imported here.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getAsset, getAssetKeys, getRawAsset } from 'node:sea';
import type { AppManifest } from './app.js';

/** Same as `appAssetPrefix` in app.ts */
const appAssetPrefix = 'xsea-app/';

const { name, hash, main } = JSON.parse(getAsset('xsea-app.json', 'utf8')) as AppManifest;

const cacheRoot = process.platform == 'win32' ? process.env.LOCALAPPDATA || join(homedir(), 'AppData/Local') : process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
const cache = join(cacheRoot, name);
const root = join(cache, hash);
const shim = join(root, '.xsea-launch.cjs');
const extracted = join(root, '.xsea-extracted');

if (!existsSync(extracted)) {
	rmSync(cache, { recursive: true, force: true });
	for (const key of getAssetKeys()) {
		if (!key.startsWith(appAssetPrefix)) continue;
		const path = join(root, key.slice(appAssetPrefix.length));
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, new Uint8Array(getRawAsset(key)));
	}
	// The SEA's own import() only loads built-in modules, but modules loaded from disk can import anything.
	writeFileSync(shim, `module.exports = import(require('node:url').pathToFileURL(require('node:path').join(__dirname, ${JSON.stringify(main)})).href);\n`);
	writeFileSync(extracted, '');
}

await createRequire(shim)(shim);
