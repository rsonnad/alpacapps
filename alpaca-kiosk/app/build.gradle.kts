plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Auto-version: YYMMDD as versionCode, vYYMMDD.HHmm as versionName
import java.text.SimpleDateFormat
import java.util.Date

val now = Date()
val buildDate: String = SimpleDateFormat("yyMMdd").format(now)
val buildTime: String = SimpleDateFormat("HHmm").format(now)
val autoVersionCode: Int = buildDate.toInt()
val autoVersionName: String = "v${buildDate}.${buildTime}"

android {
    namespace = "com.alpacaplayhouse.kiosk"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.alpacaplayhouse.kiosk"
        minSdk = 26
        targetSdk = 36
        versionCode = autoVersionCode
        versionName = autoVersionName
        buildConfigField("String", "BUILD_VERSION", "\"${autoVersionName}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.nanohttpd:nanohttpd:2.3.1")

    // Phase 2: CameraX for photo booth
    implementation("androidx.camera:camera-core:1.4.1")
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")

    // Phase 2: Guest book uses raw HTTP (GuestBookManager.kt) — no SDK needed
}
