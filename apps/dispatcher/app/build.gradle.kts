plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.topup.dispatcher"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.topup.dispatcher"
        minSdk = 26          // sendUssdRequest era; also the floor for modern job APIs
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    testImplementation("junit:junit:4.13.2")
    // android.jar stubs org.json for local unit tests — every method throws
    // "not mocked". The real implementation on the test classpath lets the
    // script parser be tested on a laptop instead of only on a handset.
    testImplementation("org.json:json:20240303")
}
