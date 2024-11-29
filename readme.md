# XSEA: Cross-Platform Single Executable Applications

XSEA is a utility for generating Node.js Single Executable Applications (SEAs) cross-platform. At the moment, there is only a CLI, not an API.

### Installation

```sh
npm install --global xsea
```

## CLI

Here is the output of `xsea --help`:

```
Usage: xsea [...options] <entry point>

Options:
    --help,-h               Show this help message
    --quiet,-q              Hide non-error output
    --verbose,-w            Show all output
    --output,-o <prefix>    The output prefix
    --clean                 Remove temporary files
    --node,-N <version>     Specify the Node version
    --target,-t <target>    Specify which targets(s) to build for (e.g. linux-arm64, win-x64)
```

#### Examples

Generate x64 executables for Linux, Windows, and MacOS:

```sh
xsea src/my-program.js -o dist/my-program -t linux-x64 -t win-x64 -t darwin-x64
```

Generate executables for Windows on x64 and Arm:

```sh
xsea src/my-program.js -o dist/my-program -t win-arm64 -t win-x64
```

Generate a SEA for the Iron LTS version:

```sh
xsea src/my-program.js -o dist/my-program -t linux-x64 -N v20.18.1
```

## Limitations

The platform and version resolution are dumb, if you mis-type the version (e.g. `20.18.1` instead of `v20.18.1`), it will not work, and has no support for resolving it (e.g. `v20` will not resolve the minor/patch and fails). Likewise for platform resolution.

### Postject warnings

You may see a bunch of `warning: ...`, you can safely ignore `warning: The signature seems corrupted!` and `warning: Can't find string offset for section name '...'`.
