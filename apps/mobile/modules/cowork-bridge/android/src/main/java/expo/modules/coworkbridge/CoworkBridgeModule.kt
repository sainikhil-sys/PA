package expo.modules.coworkbridge

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Cowork Connect's cross-platform transports (phase C6): LocalOnlyHotspot + TCP/NSD on the local
 * network, and a Bluetooth LE text fallback. Both move opaque bytes between links ("lan:..." and
 * "ble:..."); identity, encryption (Noise XX) and message meaning live in TypeScript above them.
 * Nothing here logs or inspects payloads.
 */
class CoworkBridgeModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }

  private var lanBridge: LanBridge? = null
  private var bleBridge: BleBridge? = null

  private fun emit(name: String, body: Map<String, Any?>) = sendEvent(name, body)

  private fun lan(): LanBridge = lanBridge ?: synchronized(this) {
    lanBridge ?: LanBridge(context.applicationContext, ::emit).also { lanBridge = it }
  }

  private fun ble(): BleBridge = bleBridge ?: synchronized(this) {
    bleBridge ?: BleBridge(context.applicationContext, ::emit).also { bleBridge = it }
  }

  override fun definition() = ModuleDefinition {
    Name("CoworkBridge")

    Events(
      "onLanFound", "onLanLost", "onLanRequest", "onLanConnected", "onLanDisconnected", "onLanPayload", "onLanHostStopped",
      "onBleFound", "onBleLost", "onBleRequest", "onBleConnected", "onBleDisconnected", "onBlePayload",
    )

    // ---------- Hotspot and LAN ----------

    AsyncFunction("lanHostStart") { name: String, promise: Promise -> lan().hostStart(name, promise) }
    Function("lanHostStop") { lanBridge?.hostStop(); Unit }
    AsyncFunction("lanBrowseStart") { name: String, promise: Promise -> lan().browseStart(name, promise) }
    Function("lanBrowseStop") { lanBridge?.browseStop(); Unit }
    Function("lanBrowsePause") { lanBridge?.browsePause(); Unit }
    AsyncFunction("lanConnect") { linkId: String, promise: Promise -> lan().connect(linkId, promise) }
    AsyncFunction("lanConnectAddress") { host: String, port: Int, promise: Promise -> lan().connectAddress(host, port, promise) }
    AsyncFunction("lanAccept") { linkId: String, promise: Promise -> lan().accept(linkId, promise) }
    AsyncFunction("lanReject") { linkId: String, promise: Promise -> lan().reject(linkId, promise) }
    AsyncFunction("lanSend") { linkId: String, base64: String, promise: Promise -> lan().send(linkId, base64, promise) }
    Function("lanDisconnect") { linkId: String -> lanBridge?.disconnect(linkId); Unit }

    // ---------- Bluetooth LE ----------

    AsyncFunction("bleStart") { name: String, promise: Promise -> ble().start(name, promise) }
    Function("bleStop") { bleBridge?.stop(); Unit }
    Function("blePause") { bleBridge?.pause(); Unit }
    AsyncFunction("bleConnect") { linkId: String, promise: Promise -> ble().connect(linkId, promise) }
    AsyncFunction("bleAccept") { linkId: String, promise: Promise -> ble().accept(linkId, promise) }
    AsyncFunction("bleReject") { linkId: String, promise: Promise -> ble().reject(linkId, promise) }
    AsyncFunction("bleSend") { linkId: String, base64: String, promise: Promise -> ble().send(linkId, base64, promise) }
    Function("bleDisconnect") { linkId: String -> bleBridge?.disconnect(linkId); Unit }

    OnDestroy {
      lanBridge?.destroy()
      bleBridge?.destroy()
      lanBridge = null
      bleBridge = null
    }
  }
}
