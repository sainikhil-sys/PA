package expo.modules.appicon

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Switches the launcher icon between the activity aliases that plugins/with-app-icons.js adds
 * (".CoworkIcon<Key>"). Exactly one alias stays enabled. The chosen one is enabled before the
 * others are disabled, so the app never has zero launcher entries.
 */
class AppIconModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React Application Context is null" }

  private fun component(key: String) =
    ComponentName(context.packageName, "${context.packageName}.CoworkIcon${key.replaceFirstChar { it.uppercase() }}")

  /** Whether the alias exists in this build (false on builds made without the config plugin). */
  private fun exists(key: String): Boolean = try {
    context.packageManager.getActivityInfo(component(key), PackageManager.MATCH_DISABLED_COMPONENTS)
    true
  } catch (_: PackageManager.NameNotFoundException) {
    false
  }

  private fun isEnabled(key: String): Boolean {
    val pm = context.packageManager
    return when (pm.getComponentEnabledSetting(component(key))) {
      PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
      PackageManager.COMPONENT_ENABLED_STATE_DEFAULT ->
        pm.getActivityInfo(component(key), PackageManager.MATCH_DISABLED_COMPONENTS).enabled
      else -> false
    }
  }

  override fun definition() = ModuleDefinition {
    Name("AppIcon")

    /** The enabled variant's key, or null when this build has no icon aliases. */
    Function("getIcon") { keys: List<String> ->
      if (keys.isEmpty() || !exists(keys[0])) return@Function null
      keys.firstOrNull { exists(it) && isEnabled(it) }
    }

    /** Enables `key` and disables the other variants. Returns the key that is enabled afterwards. */
    Function("setIcon") { key: String, keys: List<String> ->
      if (key !in keys || !exists(key)) {
        throw CodedException("ERR_APP_ICON_UNKNOWN", "This build doesn't include the \"$key\" icon", null)
      }
      val pm = context.packageManager
      pm.setComponentEnabledSetting(component(key), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
      for (other in keys) {
        if (other != key && exists(other)) {
          pm.setComponentEnabledSetting(component(other), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
        }
      }
      keys.firstOrNull { exists(it) && isEnabled(it) }
    }
  }
}
