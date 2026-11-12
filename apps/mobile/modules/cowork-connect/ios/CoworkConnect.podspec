require 'json'

# UNVERIFIED: written on Windows without CocoaPods or Xcode. See ios/README.md for the Mac build steps.
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'CoworkConnect'
  s.version        = package['version']
  s.summary        = 'Cowork Connect offline transport for iOS (Network framework peer-to-peer Wi-Fi)'
  s.description    = 'Local Expo module: Bonjour discovery and TCP links over peer-to-peer Wi-Fi, encrypted file chunks and audio frames with CryptoKit.'
  s.license        = 'UNLICENSED'
  s.author         = 'Cowork'
  s.homepage       = 'https://example.invalid/cowork-connect'
  s.platforms      = { :ios => '16.4' }
  # Swift 5 language mode on purpose: Swift 6 strict concurrency would turn the queue-confined
  # state in this module into errors. The code keeps all mutable state on one serial queue.
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Network', 'CryptoKit', 'AVFAudio', 'AVFoundation'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
