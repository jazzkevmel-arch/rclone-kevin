// Repasa for Android: a Trusted Web Activity (Chrome shows the web app full screen, no address bar).
// Web app: https://jazzkevmel-arch.github.io/rclone-kevin/repasa/
// Full screen needs https://jazzkevmel-arch.github.io/.well-known/assetlinks.json with this key's SHA-256.
plugins {
    id("com.android.application")
}

android {
    namespace = "io.github.jazzkevmelarch.repasa"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.github.jazzkevmelarch.repasa"
        minSdk = 21
        targetSdk = 34
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    // Same release key as the TV app (GitHub secrets TV_KEYSTORE_B64 / TV_KEYSTORE_PASSWORD),
    // so new versions install over old ones and assetlinks.json stays valid.
    signingConfigs {
        create("release") {
            val ks = System.getenv("KEYSTORE_FILE")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEYSTORE_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (System.getenv("KEYSTORE_FILE") != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
}
