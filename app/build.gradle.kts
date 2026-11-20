plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.vyd02.rewindtv"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.vyd02.rewindtv"
        minSdk = 22
        targetSdk = 34
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    // Same key every build so new versions install right over old ones.
    signingConfigs {
        create("rewind") {
            storeFile = file("rewindtv.keystore")
            storePassword = "rewindtv"
            keyAlias = "rewindtv"
            keyPassword = "rewindtv"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("rewind")
        }
        debug { signingConfig = signingConfigs.getByName("rewind") }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
}
