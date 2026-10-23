import { createHash } from 'node:crypto';
import { globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { build, cacheDir, type BuildOptions } from './lib.js';

/** The prefix of asset keys holding an embedded app's files */
export const appAssetPrefix = 'xsea-app/';

/** Describes an embedded app to the launcher */
export interface AppManifest {
	/** Name of the app's directory in the user's cache */
	name: string;
	/** Identifies the embedded files, so a new build extracts again */
	hash: string;
	/** The entry point, relative to the app's root */
	main: string;
}

export interface AppOptions extends Omit<BuildOptions, 'main'>, AppManifest {
	/** Directory with the app's files, including its `node_modules` */
	root: string;
}

/**
 * Build a SEA that embeds a whole directory, for apps that can't be bundled into one script, such as those with native addons.
 * The files are extracted to the user's cache on first run, and the entry point is imported from there.
 * @returns the paths of the executables
 */
export async function buildApp(options: Omit<AppOptions, 'hash'>): Promise<string[]> {
	const { root, name, main, config = {} } = options;

	const files = globSync('**/*', { cwd: root, withFileTypes: true })
		.filter(entry => entry.isFile())
		.map(entry => relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
		.sort();

	const hash = createHash('sha256');
	for (const file of files) hash.update(file).update(readFileSync(join(root, file)));

	const manifest: AppManifest = { name, main, hash: hash.digest('hex').slice(0, 16) };
	mkdirSync(cacheDir, { recursive: true });
	const manifestPath = join(cacheDir, `${name}.xsea-app.json`);
	writeFileSync(manifestPath, JSON.stringify(manifest));

	const assets: Record<string, string> = { ...config.assets, 'xsea-app.json': manifestPath };
	for (const file of files) assets[appAssetPrefix + file] = join(root, file);

	return await build({
		...options,
		main: join(import.meta.dirname, 'launcher.js'),
		config: { ...config, mainFormat: 'module', assets },
	});
}
