// UNVERIFIED: written on Windows without a Swift compiler, CocoaPods or an iPhone. Nothing in ios/ has been
// compiled or run. Build and test it on a Mac with two iPhones before shipping (steps in ios/README.md).
//
// Cowork Connect's iOS transport, exposed to JavaScript as the same `CoworkConnect` module as Android
// (docs/connect/NATIVE_CONTRACT.md). It only moves opaque bytes between phones. Identity, the Noise XX
// session and message meaning live in TypeScript above it. Native code never chooses keys: file and
// audio keys arrive from JS as base64 and are only applied here.
//
// iPhone to iPhone only: Apple's Network framework over peer-to-peer Wi-Fi (ConnectCore.swift). It does
// not talk to Android's Nearby Connections. Mixed groups need the CoworkBridge module (phase C6).
//
// iOS has no foreground service. Connect works only while the app is open: iOS stops peer-to-peer
// advertising, browsing and connections soon after the app leaves the screen.

import ExpoModulesCore

public class CoworkConnectModule: Module {
  private lazy var core = ConnectCore { [weak self] name, body in
    self?.sendEvent(name, body)
  }

  public func definition() -> ModuleDefinition {
    Name("CoworkConnect")

    Events(
      "onEndpointFound",
      "onEndpointLost",
      "onConnectionInitiated",
      "onConnectionResult",
      "onDisconnected",
      "onPayload",
      "onTransferUpdate",
      "onFileReceived",
      "onAudioLevel",
      "onAudioState",
      "onCallAction" // Never sent on iOS (no incoming-call notification); declared so JS can subscribe on both platforms.
    )

    OnCreate {
      _ = self.core // Create the core once, on one thread, before any call arrives.
    }

    OnDestroy {
      self.core.shutdown()
    }

    OnAppEntersForeground {
      self.core.appDidBecomeActive()
    }

    // MARK: Discovery and connections (C1)

    AsyncFunction("startAdvertising") { (name: String, promise: Promise) in
      self.core.startAdvertising(name: name, done: CoworkConnectModule.settle(promise))
    }

    AsyncFunction("startDiscovery") { (promise: Promise) in
      self.core.startDiscovery(done: CoworkConnectModule.settle(promise))
    }

    Function("stopAdvertising") {
      self.core.stopAdvertising()
    }

    Function("stopDiscovery") {
      self.core.stopDiscovery()
    }

    /// Stops advertising and discovery and drops every connection.
    Function("stopAll") {
      self.core.stopAll()
    }

    AsyncFunction("requestConnection") { (name: String, endpointId: String, promise: Promise) in
      self.core.requestConnection(name: name, endpointId: endpointId, done: CoworkConnectModule.settle(promise))
    }

    AsyncFunction("acceptConnection") { (endpointId: String, promise: Promise) in
      self.core.acceptConnection(endpointId, done: CoworkConnectModule.settle(promise))
    }

    AsyncFunction("rejectConnection") { (endpointId: String, promise: Promise) in
      self.core.rejectConnection(endpointId, done: CoworkConnectModule.settle(promise))
    }

    AsyncFunction("sendBytes") { (endpointId: String, base64: String, promise: Promise) in
      self.core.sendBytes(endpointId, base64: base64, done: CoworkConnectModule.settle(promise))
    }

    Function("disconnect") { (endpointId: String) in
      self.core.disconnect(endpointId)
    }

    // MARK: Files (C2)

    AsyncFunction("sha256File") { (uri: String, promise: Promise) in
      self.core.files.sha256File(uri: uri, done: CoworkConnectModule.settleString(promise))
    }

    AsyncFunction("sendFile") { (endpointId: String, uri: String, keyB64: String, promise: Promise) in
      self.core.files.sendFile(endpointId: endpointId, uri: uri, keyB64: keyB64, done: CoworkConnectModule.settleString(promise))
    }

    Function("cancelPayload") { (payloadId: String) in
      self.core.files.cancelPayload(payloadId)
    }

    AsyncFunction("decryptFile") { (path: String, keyB64: String, fileName: String, promise: Promise) in
      self.core.files.decryptFile(path: path, keyB64: keyB64, fileName: fileName) { result in
        switch result {
        // `as Any?` picks Expo's dynamic resolve path for a [String: Any] dictionary.
        case .success(let value): promise.resolve(value as Any?)
        case .failure(let failure): promise.reject(failure.code, failure.message)
        }
      }
    }

    /// Returns whether a file was deleted, as on Android.
    Function("deleteFile") { (uri: String) throws -> Bool in
      do {
        return try FileTransfers.deleteFile(uri: uri)
      } catch let failure as ConnectFailure {
        throw Exception(name: failure.code, description: failure.message, code: failure.code)
      }
    }

    // MARK: Audio (C3 Walkie, C4 calls)

    AsyncFunction("audioStart") { (options: AudioStartOptions, promise: Promise) in
      self.core.audio.start(
        sendKey: options.sendKey,
        peers: options.peers.map { ($0.endpointId, $0.recvKey) },
        mode: options.mode,
        done: CoworkConnectModule.settle(promise)
      )
    }

    AsyncFunction("audioAddPeer") { (endpointId: String, recvKey: String, promise: Promise) in
      guard let key = Wire.key(recvKey) else {
        return promise.reject(ConnectFailure.badKey.code, ConnectFailure.badKey.message)
      }
      self.core.audio.addPeer(endpointId, key: key, done: CoworkConnectModule.settle(promise))
    }

    AsyncFunction("audioRemovePeer") { (endpointId: String) in
      self.core.audio.removePeer(endpointId)
    }

    /// Resolves true, or false when microphone permission is off (an onAudioState error follows), as on
    /// Android. The first call may show the system permission prompt.
    AsyncFunction("audioTransmit") { (on: Bool, promise: Promise) in
      self.core.audio.transmit(on) { result in
        switch result {
        case .success(let changed): promise.resolve(changed)
        case .failure(let failure): promise.reject(failure.code, failure.message)
        }
      }
    }

    AsyncFunction("audioSetMuted") { (muted: Bool) in
      self.core.audio.setMuted(muted)
    }

    AsyncFunction("audioSetSpeaker") { (on: Bool) in
      self.core.audio.setSpeaker(on)
    }

    AsyncFunction("audioStop") {
      self.core.audio.stop()
    }

    // MARK: Foreground service and incoming calls (Android only)

    /// iOS has no foreground service. Resolves without doing anything so the same JS flow runs while
    /// the app is open; audio and links still stop when iOS suspends the app.
    AsyncFunction("startService") { (_: ServiceOptions, promise: Promise) in
      promise.resolve()
    }

    Function("stopService") {}

    /// iOS has no offline incoming-call notification (CallKit needs a VoIP push from a server).
    /// Resolves false, meaning "not shown" (index.ts types this as Promise<boolean>): show the call in the app.
    AsyncFunction("showIncomingCall") { (_: IncomingCallOptions, promise: Promise) in
      promise.resolve(false)
    }

    Function("clearIncomingCall") { (_: String) in }
  }

  private static func settle(_ promise: Promise) -> (ConnectFailure?) -> Void {
    return { failure in
      if let failure {
        promise.reject(failure.code, failure.message)
      } else {
        promise.resolve()
      }
    }
  }

  private static func settleString(_ promise: Promise) -> (Result<String, ConnectFailure>) -> Void {
    return { result in
      switch result {
      case .success(let value): promise.resolve(value)
      case .failure(let failure): promise.reject(failure.code, failure.message)
      }
    }
  }
}

struct AudioPeerOptions: Record {
  @Field var endpointId: String = ""
  @Field var recvKey: String = ""
}

struct AudioStartOptions: Record {
  @Field var sendKey: String = ""
  @Field var peers: [AudioPeerOptions] = []
  @Field var mode: String = "walkie"
}

struct ServiceOptions: Record {
  @Field var kind: String = "walkie"
  @Field var title: String = ""
  @Field var body: String = ""
}

struct IncomingCallOptions: Record {
  @Field var callId: String = ""
  @Field var name: String = ""
}
