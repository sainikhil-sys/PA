// Windows has a 260-character path limit, and React Native's generated C++ object paths exceed it
// (codegen for gesture-handler, react-native-worklets and friends, especially under a deep folder
// such as OneDrive). CMAKE_OBJECT_PATH_MAX makes CMake replace long object directories with short
// hashes. Applied to the app and to every native library module. Harmless on macOS and Linux.
const { withAppBuildGradle, withGradleProperties, withProjectBuildGradle } = require("expo/config-plugins");

const MARK = "// cowork-short-native-paths";
const ARG = "-DCMAKE_OBJECT_PATH_MAX=240";

const LIBRARIES = `
${MARK}
subprojects { sub ->
  sub.plugins.withId("com.android.library") {
    sub.android.defaultConfig.externalNativeBuild.cmake.arguments("${ARG}")
    // Windows: keep native build folders short (C:\\cw-cxx\\<module>) so object paths stay under 260 characters.
    if (System.getProperty("os.name").toLowerCase().contains("windows")) {
      sub.android.externalNativeBuild.cmake.buildStagingDirectory = new File("\${System.getenv('SystemDrive') ?: 'C:'}/cw-cxx/\${sub.name}")
    }
  }
}
`;

function withAppPaths(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARK)) return cfg;
    gradle = gradle.replace(
      /^android\s*\{/m,
      `android {
    // cowork-short-native-staging
    if (System.getProperty("os.name").toLowerCase().contains("windows")) {
        externalNativeBuild {
            cmake {
                buildStagingDirectory = new File("\${System.getenv('SystemDrive') ?: 'C:'}/cw-cxx/app")
            }
        }
    }`,
    );
    gradle = gradle.replace(
      /defaultConfig\s*\{/,
      `defaultConfig {
        ${MARK}
        externalNativeBuild {
            cmake {
                arguments "${ARG}"
            }
        }`,
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
}

function withLibraryPaths(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARK)) cfg.modResults.contents += LIBRARIES;
    return cfg;
  });
}

// Expo sets CMAKE_OBJECT_PATH_MAX=1024 for every module, which turns hashing off; its documented
// property sets 240 everywhere: low enough that CMake hashes long object paths below 260 characters, high enough that the hashed names fit.
function withObjectPathProperty(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter((p) => !(p.type === "property" && p.key === "expo.android.cmakeObjectPathMax"));
    cfg.modResults.push({ type: "property", key: "expo.android.cmakeObjectPathMax", value: "240" });
    return cfg;
  });
}

module.exports = function withShortNativePaths(config) {
  return withObjectPathProperty(withLibraryPaths(withAppPaths(config)));
};
