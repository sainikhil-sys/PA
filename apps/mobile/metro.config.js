// Metro for the Cowork app.
//
// The repository root has a pnpm-workspace.yaml for the website, so Expo's default config treats
// the repo as a monorepo and makes Metro watch all of it: the website's node_modules and its .next
// build folders, hundreds of thousands of files. On Windows that crawl can keep Metro busy for many
// minutes before it serves anything (the app sits on its splash screen, then reports "Unable to load
// script"). The app is self-contained in apps/mobile (its own node_modules, src, modules, assets),
// so Metro watches and resolves only this folder.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.watchFolders = [__dirname];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
// Native build output and generated folders never hold app source.
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  /[\\/]android[\\/](app[\\/])?build[\\/].*/,
  /[\\/]modules[\\/][^\\/]+[\\/]android[\\/](build|\.gradle)[\\/].*/,
];

module.exports = config;
