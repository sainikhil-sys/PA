# Builds the debug app, installs it on the connected phone and starts Expo's dev server.
# Run from anywhere; it works in apps/mobile. Run only one build at a time.
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:ANDROID_HOME\platform-tools;$env:JAVA_HOME\bin;$env:Path"
Set-Location $PSScriptRoot
# Extra arguments pass through, e.g. .\run-android.ps1 --no-bundler when Metro is already running.
npx expo run:android --device UC8HGQJJAYIZKZ7D --port 8082 @args
