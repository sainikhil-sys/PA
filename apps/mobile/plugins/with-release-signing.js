// Signs release builds with the upload key in credentials/ (git-ignored) when it exists.
// Without it, release builds fall back to the debug key, which Google Play rejects, so a
// missing key can never be shipped by accident.
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// cowork-release-signing";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARK)) return cfg;
    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      `${MARK}
    def coworkKeyProps = new Properties()
    def coworkKeyFile = rootProject.file("../credentials/keystore.properties")
    if (coworkKeyFile.exists()) { coworkKeyFile.withInputStream { coworkKeyProps.load(it) } }
    signingConfigs {
        if (coworkKeyFile.exists()) {
            upload {
                storeFile file(coworkKeyProps["storeFile"])
                storePassword coworkKeyProps["storePassword"]
                keyAlias coworkKeyProps["keyAlias"]
                keyPassword coworkKeyProps["keyPassword"]
            }
        }`,
    );
    gradle = gradle.replace(
      /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig coworkKeyFile.exists() ? signingConfigs.upload : signingConfigs.debug`,
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
