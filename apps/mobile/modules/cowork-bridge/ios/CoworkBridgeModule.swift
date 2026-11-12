// UNVERIFIED: written on Windows without Xcode; never compiled or run. It follows the Expo Modules
// Swift API (expo-modules-core 58) and mirrors android/.../CoworkBridgeModule.kt. Build and test on a
// Mac before shipping.

import ExpoModulesCore
import Foundation

/// Cowork Connect's cross-platform transports (phase C6) for iPhone: join an Android hotspot, Bonjour
/// + TCP on the local network, and a Bluetooth LE text fallback. Moves opaque bytes between links
/// ("lan:..." and "ble:..."); identity and encryption (Noise XX) live in TypeScript above it.
public class CoworkBridgeModule: Module {
  private let lock = NSLock()
  private var lanBridge: LanBridge?
  private var bleBridge: BleBridge?

  private func lan() -> LanBridge {
    lock.lock()
    defer { lock.unlock() }
    if let l = lanBridge { return l }
    let l = LanBridge(emit: { [weak self] name, body in self?.sendEvent(name, body) })
    lanBridge = l
    return l
  }

  private func ble() -> BleBridge {
    lock.lock()
    defer { lock.unlock() }
    if let b = bleBridge { return b }
    let b = BleBridge(emit: { [weak self] name, body in self?.sendEvent(name, body) })
    bleBridge = b
    return b
  }

  public func definition() -> ModuleDefinition {
    Name("CoworkBridge")

    Events(
      "onLanFound", "onLanLost", "onLanRequest", "onLanConnected", "onLanDisconnected", "onLanPayload", "onLanHostStopped",
      "onBleFound", "onBleLost", "onBleRequest", "onBleConnected", "onBleDisconnected", "onBlePayload"
    )

    // MARK: Hotspot and LAN

    // iOS apps cannot create a hotspot: the iPhone joins the Android one instead.
    AsyncFunction("lanHostStart") { (_: String, promise: Promise) in
      promise.reject("ERR_BRIDGE_UNSUPPORTED", "An iPhone cannot host a hotspot. Join the Android phone's hotspot instead.")
    }
    Function("lanHostStop") {}

    AsyncFunction("joinHotspot") { (ssid: String, passphrase: String, promise: Promise) in
      self.lan().joinHotspot(ssid: ssid, passphrase: passphrase, promise: promise)
    }

    AsyncFunction("lanBrowseStart") { (name: String, promise: Promise) in
      self.lan().browseStart(name: name, promise: promise)
    }
    Function("lanBrowseStop") {
      if let l = self.lanBridge { l.browseStop() }
    }
    Function("lanBrowsePause") {
      if let l = self.lanBridge { l.browsePause() }
    }
    AsyncFunction("lanConnect") { (linkId: String, promise: Promise) in
      self.lan().connect(linkId: linkId, promise: promise)
    }
    AsyncFunction("lanConnectAddress") { (host: String, port: Int, promise: Promise) in
      self.lan().connectAddress(host: host, port: port, promise: promise)
    }
    AsyncFunction("lanAccept") { (linkId: String, promise: Promise) in
      self.lan().accept(linkId: linkId, promise: promise)
    }
    AsyncFunction("lanReject") { (linkId: String, promise: Promise) in
      self.lan().reject(linkId: linkId, promise: promise)
    }
    AsyncFunction("lanSend") { (linkId: String, base64: String, promise: Promise) in
      self.lan().send(linkId: linkId, base64: base64, promise: promise)
    }
    Function("lanDisconnect") { (linkId: String) in
      if let l = self.lanBridge { l.disconnect(linkId: linkId) }
    }

    // MARK: Bluetooth LE

    AsyncFunction("bleStart") { (name: String, promise: Promise) in
      self.ble().start(name: name, promise: promise)
    }
    Function("bleStop") {
      if let b = self.bleBridge { b.stop() }
    }
    Function("blePause") {
      if let b = self.bleBridge { b.pause() }
    }
    AsyncFunction("bleConnect") { (linkId: String, promise: Promise) in
      self.ble().connect(linkId: linkId, promise: promise)
    }
    AsyncFunction("bleAccept") { (linkId: String, promise: Promise) in
      self.ble().accept(linkId: linkId, promise: promise)
    }
    AsyncFunction("bleReject") { (linkId: String, promise: Promise) in
      self.ble().reject(linkId: linkId, promise: promise)
    }
    AsyncFunction("bleSend") { (linkId: String, base64: String, promise: Promise) in
      self.ble().send(linkId: linkId, base64: base64, promise: promise)
    }
    Function("bleDisconnect") { (linkId: String) in
      if let b = self.bleBridge { b.disconnect(linkId: linkId) }
    }

    OnDestroy {
      self.lanBridge?.destroy()
      self.bleBridge?.destroy()
    }
  }
}
