// Expo's recommended lint rules for this app (the web app at the repo root has its own config).
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([expoConfig, { ignores: ["dist/*", "android/*", "modules/*/android/*", "plugins/*"] }]);
