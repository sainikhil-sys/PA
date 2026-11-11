# Builds the debug app, installs it on the connected phone and starts Expo's dev server.
# Builds through W:\mobile (W: mapped to the parent folder) because native C++ paths under the
# OneDrive folder exceed Windows' 260-character limit. Expo autolinking can't run from a drive root,
# hence the parent mapping.
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:ANDROID_HOME\platform-tools;$env:JAVA_HOME\bin;$env:Path"
if (Test-Path W:\package.json) { subst W: /D }
if (-not (Test-Path W:\mobile\package.json)) { subst W: (Split-Path $PSScriptRoot -Parent) }
Set-Location W:\mobile
# Stop leftover Gradle daemons and drop native build caches that recorded the long paths.
& .\android\gradlew.bat -p android --stop
Remove-Item -Recurse -Force node_modules\react-native-worklets\android\.cxx, node_modules\react-native-reanimated\android\.cxx, android\app\.cxx -ErrorAction SilentlyContinue
npx expo run:android --device UC8HGQJJAYIZKZ7D --port 8082
