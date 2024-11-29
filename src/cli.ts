import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { parseArgs } from 'node:util';
import { inject } from 'postject';
import { extract } from 'tar';

const { values: options, positionals } = parseArgs({
	options: {
		help: { short: 'h', type: 'boolean', default: false },
		quiet: { short: 'q', type: 'boolean', default: false },
		verbose: { short: 'w', type: 'boolean', default: false },
		output: { short: 'o', type: 'string' },
		clean: { type: 'boolean', default: false },
		node: { short: 'N', type: 'string', default: 'v' + process.versions.node },
	},
	allowPositionals: true,
});

const tempDir = '/tmp/xsea';

const _log = (...text: any[]) => options.verbose && console.log('[debug]', ...text);

if (options.help) {
	console.log(`Usage: xsea [...options] <entry point>

Options:
    --help,-h               Show this help message
    --quiet,-q              Hide non-error output
    --verbose,-w            Show all output
    --output, -o <prefix>   The output prefix
	--tempd                 Temporary files directory, 
`);
	process.exit(0);
}

if (options.verbose && options.quiet) {
	console.error('Can not use both --verbose and --quiet');
	process.exit(1);
}

if (positionals.length != 1) {
	console.error('Incorrect number of positional arguments, expected 1');
	process.exit(1);
}

const prefix = options.output ?? parse(positionals[0]).name;

if (options.clean) {
	_log('Removing temporary files...');
	fs.rmSync(tempDir, { recursive: true });
}
fs.mkdirSync(tempDir, { recursive: true });

const configPath = join(tempDir, 'sea.json'),
	blobPath = join(tempDir, 'server.blob');

fs.writeFileSync(
	configPath,
	JSON.stringify({
		main: positionals[0],
		output: blobPath,
		disableExperimentalSEAWarning: true,
	})
);
execSync(process.execPath + ' --experimental-sea-config ' + configPath, { stdio: 'inherit' });

const blob = fs.readFileSync(blobPath);

fs.mkdirSync(prefix.endsWith('/') ? prefix : dirname(prefix), { recursive: true });

/**
 * Builds a SEA for a target (e.g. win-x64, linux-arm64)
 */
async function buildSEA(target: string) {
	!options.quiet && console.log('Creating SEA for:', target);
	const isWindows = target.startsWith('win');

	const seaPath = join(prefix, isWindows ? target + '.exe' : target);

	const archiveFile = `node-${options.node}-${target}.${isWindows ? 'zip' : 'tar.gz'}`;
	const archivePath = join(tempDir, archiveFile);
	try {
		const url = `https://nodejs.org/dist/${options.node}/${archiveFile}`;
		_log('Fetching:', url);
		const response = await fetch(url);
		fs.writeFileSync(archivePath, new Uint8Array(await response.arrayBuffer()));
	} catch {
		console.error(`Failed to download Node v${options.node} for ${target}`);
		return;
	}

	const extractedDir = join(tempDir, target);
	fs.mkdirSync(extractedDir, { recursive: true });

	_log('Extracting:', archivePath);
	if (isWindows) {
	} else {
		await extract({
			file: archivePath,
			gzip: true,
			cwd: extractedDir,
		});
	}

	fs.mkdirSync(dirname(seaPath), { recursive: true });
	fs.copyFileSync(join(extractedDir, isWindows ? 'node.exe' : 'node'), seaPath);
	_log('Injecting:', seaPath);
	inject(seaPath, 'NODE_SEA_BLOB', blob, {
		machoSegmentName: 'NODE_SEA',
		sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
	});
}
