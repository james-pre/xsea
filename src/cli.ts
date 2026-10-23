#!/usr/bin/env node
import { parse } from 'node:path';
import { parseArgs } from 'node:util';
import { build, clean, currentNode, host, readConfig } from './lib.js';

const { values: options, positionals } = parseArgs({
	options: {
		help: { short: 'h', type: 'boolean', default: false },
		quiet: { short: 'q', type: 'boolean', default: false },
		verbose: { short: 'w', type: 'boolean', default: false },
		output: { short: 'o', type: 'string' },
		config: { short: 'c', type: 'string' },
		clean: { type: 'boolean', default: false },
		keep: { type: 'boolean', default: false },
		node: { short: 'N', type: 'string', default: currentNode },
		target: { short: 't', type: 'string', multiple: true, default: [host] },
	},
	allowPositionals: true,
});

const debug = (...text: unknown[]) => options.verbose && console.log('[debug]', ...text);

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
	debug('Removing cached files...');
	clean();
}

if (positionals.length != 1) {
	if (options.clean) process.exit(0);
	console.error('Incorrect number of positional arguments, expected 1');
	process.exit(1);
}

let prefix = options.output ?? parse(positionals[0]).name;
if (/\w$/.test(prefix)) prefix += '-';
debug('Prefix:', prefix);

try {
	await build({
		main: positionals[0],
		prefix,
		node: options.node,
		targets: options.target,
		config: options.config ? readConfig(options.config) : {},
		keep: options.keep,
		quiet: options.quiet,
		debug,
	});
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
