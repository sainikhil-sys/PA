// Windows has a 260-character path limit, and React Native's generated C++ object paths exceed it
// (codegen for gesture-handler and friends). CMAKE_OBJECT_PATH_MAX makes CMake replace long object
// directories with short hashes. Harmless on macOS and Linux.
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// cowork-short-native-paths";

module.exports = function withShortNativePaths(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARK)) return cfg;
    gradle = gradle.replace(
      /defaultConfig\s*\{/,
      `defaultConfig {
        ${MARK}
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_OBJECT_PATH_MAX=128"
            }
        }`,
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
