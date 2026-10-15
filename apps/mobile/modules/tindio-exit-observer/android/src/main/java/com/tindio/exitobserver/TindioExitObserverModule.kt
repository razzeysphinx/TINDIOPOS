package com.tindio.exitobserver

import android.app.ActivityManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.system.Os
import android.system.OsConstants
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private class CertificationTriggerUnavailableException : CodedException(
  "A45 crash and ANR triggers are available only in a debuggable Android build."
)

class TindioExitObserverModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun certificationAvailable(): Boolean =
    context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

  private fun requireCertificationBuild() {
    if (!certificationAvailable()) throw CertificationTriggerUnavailableException()
  }

  override fun definition() = ModuleDefinition {
    Name("TindioExitObserver")

    Function("isCertificationAvailable") {
      certificationAvailable()
    }

    AsyncFunction("getHistoricalExitEventsAsync") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
        return@AsyncFunction emptyList<Map<String, Any>>()
      }

      val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      activityManager
        .getHistoricalProcessExitReasons(context.packageName, 0, 32)
        .mapNotNull { exit ->
          val type = when (exit.reason) {
            android.app.ApplicationExitInfo.REASON_CRASH_NATIVE -> "NATIVE_CRASH"
            android.app.ApplicationExitInfo.REASON_CRASH -> "JAVA_CRASH"
            android.app.ApplicationExitInfo.REASON_ANR -> "ANR"
            else -> null
          } ?: return@mapNotNull null

          mapOf(
            "type" to type,
            "timestampMs" to exit.timestamp.toDouble()
          )
        }
    }

    Function("triggerNativeCrashForCertification") {
      requireCertificationBuild()
      Os.kill(Process.myPid(), OsConstants.SIGSEGV)
    }

    Function("triggerAnrForCertification") {
      requireCertificationBuild()
      Handler(Looper.getMainLooper()).post {
        Thread.sleep(45_000)
      }
    }
  }
}
