import AdmZip from 'adm-zip';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { inject } from 'postject';
import { extract } from 'tar';

/** Where downloaded Node.js binaries and intermediate files are kept */
export const cacheDir = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'xsea');

/** The current platform, named like a target */
export const host = (process.platform == 'win32' ? 'win' : process.platform) + '-' + process.arch;

/** The version of the running Node.js, e.g. `v26.12.1` */
export const currentNode = 'v' + process.versions.node;

const [major, minor] = process.versions.node.split('.').map(Number);

/** Whether the running Node.js can build and inject a SEA itself (v25.5.0+), instead of needing postject */
export const hasBuildSea = major > 25 || (major == 25 && minor >= 5);

/**
 * Node.js SEA configuration, except for `main` and `output`.
 * @see https://nodejs.org/api/single-executable-applications.html
 */
export interface SeaConfig {
	mainFormat?: 'commonjs' | 'module';
	disableExperimentalSEAWarning?: boolean;
	useSnapshot?: boolean;
	useCodeCache?: boolean;
	useVfs?: boolean;
	vfsArchive?: string;
	execArgv?: string[];
	execArgvExtension?: 'none' | 'env' | 'cli';
	/** Paths of files to embed, by their asset key */
	assets?: Record<string, string>;
	[key: string]: unknown;
}

export interface BuildOptions {
	/** The entry point */
	main: string;
	/** Prefix of the output paths, which end with the target (e.g. `dist/app-` makes `dist/app-linux-x64`) */
	prefix: string;
	/** The Node.js version to build for, which must be the running version. Defaults to the running version. */
	node?: string;
	/** Targets to build for, e.g. `linux-arm64` or `win-x64`. Defaults to the current platform. */
	targets?: string[];
	config?: SeaConfig;
	/** Keep downloaded archives and extracted directories */
	keep?: boolean;
	/** Hide progress and output from Node.js */
	quiet?: boolean;
	/** Receives detailed progress messages */
	debug?(...text: unknown[]): void;
}

/** Remove cached Node.js binaries and intermediate files. */
export function clean(): void {
	fs.rmSync(cacheDir, { recursive: true, force: true });
}

/**
 * Read a SEA configuration file, resolving asset paths relative to it so it works from any directory.
 */
export function readConfig(path: string): SeaConfig {
	const config: SeaConfig = JSON.parse(fs.readFileSync(path, 'utf8'));
	const configDir = dirname(resolve(path));
	for (const [key, asset] of Object.entries(config.assets ?? {})) config.assets![key] = resolve(configDir, asset);
	return config;
}

/**
 * Download the Node.js binary for a target, if it isn't cached already.
 * @returns the path to the binary
 */
export async function getNode(version: string, target: string, options: Pick<BuildOptions, 'keep' | 'debug'> = {}): Promise<string> {
	const archiveBase = `node-${version}-${target}`;
	const isWindows = target.startsWith('win');
	const archiveFile = archiveBase + '.' + (isWindows ? 'zip' : 'tar.gz');
	const archivePath = join(cacheDir, archiveFile);
	const executable = join(cacheDir, archiveBase);

	if (fs.existsSync(executable)) {
		options.debug?.('Found existing:', archiveBase);
		return executable;
	}

	fs.mkdirSync(join(cacheDir, 'node'), { recursive: true });

	if (fs.existsSync(archivePath)) {
		options.debug?.('Found existing archive:', archiveFile);
	} else {
		const url = `https://nodejs.org/dist/${version}/${archiveFile}`;
		options.debug?.('Fetching:', url);
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
		fs.writeFileSync(archivePath, new Uint8Array(await response.arrayBuffer()));
	}

	options.debug?.('Extracting:', archiveFile);
	if (isWindows) {
		const data = new AdmZip(archivePath).readFile(archiveBase + '/node.exe');
		if (!data) throw new Error('Missing node executable: ' + archiveBase);
		fs.writeFileSync(executable, data);
	} else {
		await extract({ file: archivePath, gzip: true, cwd: join(cacheDir, 'node') });
		const extracted = join(cacheDir, 'node', archiveBase);
		fs.copyFileSync(join(extracted, 'bin/node'), executable);
		if (!options.keep) {
			options.debug?.('Removing intermediate:', extracted);
			fs.rmSync(extracted, { recursive: true, force: true });
		}
	}

	if (!options.keep) {
		options.debug?.('Removing intermediate:', archivePath);
		fs.unlinkSync(archivePath);
	}

	return executable;
}

/**
 * Build a SEA for each target.
 * @returns the paths of the executables
 */
export async function build(options: BuildOptions): Promise<string[]> {
	const { main, prefix, node = currentNode, targets = [host], config = {} } = options;

	if ((config.useCodeCache || config.useSnapshot) && targets.some(target => target != host)) {
		throw new Error('useCodeCache and useSnapshot only work when building for the current platform: ' + host);
	}

	if (node != currentNode) {
		console.warn(`Warning: a SEA must be built by the same Node.js version it runs on, but ${node} was requested and this is ${currentNode}`);
	}

	fs.mkdirSync(cacheDir, { recursive: true });
	const name = main.replace(/^.*[\\/]|\.[^.]*$/g, '');
	const seaConfig = { disableExperimentalSEAWarning: true, ...config, main };

	let blob: Buffer | undefined;
	if (!hasBuildSea) {
		const configPath = join(cacheDir, name + '.json');
		const blobPath = join(cacheDir, name + '.blob');
		fs.writeFileSync(configPath, JSON.stringify({ ...seaConfig, output: blobPath }));
		execFileSync(process.execPath, ['--experimental-sea-config', configPath], {
			stdio: options.quiet ? 'pipe' : 'inherit',
		});
		blob = fs.readFileSync(blobPath);
	}

	const outputs: string[] = [];

	for (const target of targets) {
		if (!options.quiet) console.log('Creating SEA for:', target);
		const output = prefix + (target.startsWith('win') ? target + '.exe' : target);
		const executable = await getNode(node, target, options);
		const signsBinary = target == 'darwin-arm64' && process.platform == 'darwin';

		fs.mkdirSync(dirname(resolve(output)), { recursive: true });

		if (!blob) {
			const targetConfigPath = join(cacheDir, `${name}-${target}.json`);
			fs.writeFileSync(targetConfigPath, JSON.stringify({ ...seaConfig, executable, output: resolve(output) }));
			options.debug?.('Building:', output);
			execFileSync(process.execPath, ['--build-sea', targetConfigPath], {
				stdio: options.quiet ? 'pipe' : 'inherit',
			});
		} else {
			fs.copyFileSync(executable, output);

			if (signsBinary) {
				options.debug?.('Removing signature:', output);
				execFileSync('codesign', ['--remove-signature', output]);
			}

			options.debug?.('Injecting:', output);
			await inject(output, 'NODE_SEA_BLOB', blob, {
				machoSegmentName: 'NODE_SEA',
				sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
			});
		}

		if (signsBinary) {
			options.debug?.('Signing binary:', output);
			execFileSync('codesign', ['--sign', '-', output]);
		}

		outputs.push(output);
	}

	return outputs;
}
