#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { inject } from 'postject';
import { extract } from 'tar';
import AdmZip from 'adm-zip';
import { homedir } from 'node:os';

/** The current platform, named like a target */
const host = (process.platform == 'win32' ? 'win' : process.platform) + '-' + process.arch;

const { values: options, positionals } = parseArgs({
	options: {
		help: { short: 'h', type: 'boolean', default: false },
		quiet: { short: 'q', type: 'boolean', default: false },
		verbose: { short: 'w', type: 'boolean', default: false },
		output: { short: 'o', type: 'string' },
		config: { short: 'c', type: 'string' },
		clean: { type: 'boolean', default: false },
		keep: { type: 'boolean', default: false },
		node: { short: 'N', type: 'string', default: 'v' + process.versions.node },
		target: { short: 't', type: 'string', multiple: true, default: [host] },
	},
	allowPositionals: true,
});

const tempDir = join(homedir(), '.cache/xsea');

const _log = (...text: any[]) => options.verbose && console.log('[debug]', ...text);

if (options.help) {
	console.log(`Usage: xsea [...options] <entry point>

Options:
    --help,-h               Show this help message
    --quiet,-q              Hide non-error output
    --verbose,-w            Show all output
    --output,-o <prefix>    The output prefix
    --config,-c <path>      A SEA configuration to merge in (e.g. assets, mainFormat, execArgv)
    --clean                 Remove cached files
	--keep                  Keep intermediate files
    --node,-N <version>     Specify the Node version
    --target,-t <target>    Specify which targets(s) to build for (e.g. linux-arm64, win-x64)
`);
	process.exit(0);
}

if (options.verbose && options.quiet) {
	console.error('Can not use both --verbose and --quiet');
	process.exit(1);
}

if (options.clean) {
	_log('Removing temporary files...');
	fs.rmSync(tempDir, { recursive: true, force: true });
}

if (positionals.length != 1) {
	if (options.clean) process.exit(0);
	console.error('Incorrect number of positional arguments, expected 1');
	process.exit(1);
}

const entryName = parse(positionals[0]).name;

let prefix = options.output ?? entryName;

if (/\w$/.test(prefix)) {
	prefix += '-';
}

_log('Prefix:', prefix);

fs.mkdirSync(join(tempDir, 'node'), { recursive: true });

const configPath = join(tempDir, entryName + '.json'),
	blobPath = join(tempDir, entryName + '.blob');

const userConfig: Record<string, any> = options.config ? JSON.parse(fs.readFileSync(options.config, 'utf8')) : {};

// Asset paths are relative to the configuration file, so it works from any directory.
if (options.config && userConfig.assets) {
	const configDir = dirname(resolve(options.config));
	for (const [key, path] of Object.entries<string>(userConfig.assets)) {
		userConfig.assets[key] = resolve(configDir, path);
	}
}

if ((userConfig.useCodeCache || userConfig.useSnapshot) && options.target.some(target => target != host)) {
	console.error('useCodeCache and useSnapshot only work when building for the current platform:', host);
	process.exit(1);
}

if (options.node != 'v' + process.versions.node) {
	console.warn(`Warning: a SEA must be built by the same Node.js version it runs on, but ${options.node} was requested and this is v${process.versions.node}`);
}

const [major, minor] = process.versions.node.split('.').map(Number);

/** Whether this Node.js can build and inject a SEA itself (v25.5.0+), instead of needing postject */
const hasBuildSea = major > 25 || (major == 25 && minor >= 5);

const seaConfig = { disableExperimentalSEAWarning: true, ...userConfig, main: positionals[0] };

let blob: Buffer | undefined;
if (!hasBuildSea) {
	fs.writeFileSync(configPath, JSON.stringify({ ...seaConfig, output: blobPath }));
	execFileSync(process.execPath, ['--experimental-sea-config', configPath], { stdio: 'inherit' });
	blob = fs.readFileSync(blobPath);
}

fs.mkdirSync(prefix.endsWith('/') ? prefix : dirname(prefix), { recursive: true });

async function getNode(archiveBase: string) {
	const isWindows = archiveBase.includes('-win');

	const archiveFile = archiveBase + '.' + (isWindows ? 'zip' : 'tar.gz');
	const archivePath = join(tempDir, archiveFile);
	const execName = join(tempDir, archiveBase);

	if (fs.existsSync(execName)) {
		_log('Found existing:', archiveBase);
		return;
	}

	if (fs.existsSync(archivePath)) {
		_log('Found existing archive:', archiveFile);
	} else {
		try {
			const url = `https://nodejs.org/dist/${options.node}/${archiveFile}`;
			_log('Fetching:', url);
			const response = await fetch(url);
			fs.writeFileSync(archivePath, new Uint8Array(await response.arrayBuffer()));
		} catch {
			throw ['Failed to download:', archiveBase];
		}
	}

	_log('Extracting:', archiveFile);
	if (isWindows) {
		const zip = new AdmZip(archivePath);
		const data = zip.readFile(archiveBase + '/node.exe');
		if (!data) {
			throw ['Missing node executable:', archiveBase];
		}

		fs.writeFileSync(execName, data);
	} else {
		await extract({
			file: archivePath,
			gzip: true,
			cwd: join(tempDir, 'node'),
		});
		const extracted = join(tempDir, 'node', archiveBase);
		fs.copyFileSync(join(extracted, isWindows ? 'node.exe' : 'bin/node'), execName);
		if (!options.keep) {
			_log('Removing intermediate:', extracted);
			fs.rmSync(extracted, { recursive: true, force: true });
		}
	}

	if (!options.keep) {
		_log('Removing intermediate:', archivePath);
		fs.unlinkSync(archivePath);
	}
}

/**
 * Builds a SEA for a target (e.g. win-x64, linux-arm64)
 */
async function buildSEA(target: string) {
	!options.quiet && console.log('Creating SEA for:', target);
	const isWindows = target.startsWith('win');

	const seaPath = prefix + (isWindows ? target + '.exe' : target);

	const archiveBase = `node-${options.node}-${target}`;

	try {
		await getNode(archiveBase);
	} catch (e: any) {
		console.error(...(Array.isArray(e) ? e : [e]));
		return;
	}

	fs.mkdirSync(dirname(seaPath), { recursive: true });
	const signsBinary = target == 'darwin-arm64' && process.platform == 'darwin';

	if (!blob) {
		const targetConfigPath = join(tempDir, `${entryName}-${target}.json`);
		fs.writeFileSync(targetConfigPath, JSON.stringify({ ...seaConfig, executable: join(tempDir, archiveBase), output: resolve(seaPath) }));
		_log('Building:', seaPath);
		execFileSync(process.execPath, ['--build-sea', targetConfigPath], { stdio: options.quiet ? 'pipe' : 'inherit' });
	} else {
		fs.copyFileSync(join(tempDir, archiveBase), seaPath);

		if (signsBinary) {
			_log('Removing signature:', seaPath);
			execFileSync('codesign', ['--remove-signature', seaPath]);
		}

		_log('Injecting:', seaPath);
		await inject(seaPath, 'NODE_SEA_BLOB', blob, {
			machoSegmentName: 'NODE_SEA',
			sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
		});
	}

	if (signsBinary) {
		_log('Signing binary:', seaPath);
		execFileSync('codesign', ['--sign', '-', seaPath]);
	}
}

for (const target of options.target) {
	await buildSEA(target);
}
