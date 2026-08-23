import org.jetbrains.intellij.platform.gradle.tasks.RunIdeTask

plugins {
  id("java")
  id("org.jetbrains.kotlin.jvm") version "2.1.10"
  id("org.jetbrains.intellij.platform") version "2.18.1"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

kotlin {
  jvmToolchain(17)
}

repositories {
  mavenCentral()
  intellijPlatform {
    defaultRepositories()
  }
}

dependencies {
  intellijPlatform {
    webstorm(providers.gradleProperty("platformVersion"))
    bundledPlugin("JavaScript")
  }

  // Pure unit tests — no IntelliJ test framework (avoids JUnit5 launcher clashes).
  testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
  testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
  testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

intellijPlatform {
  pluginConfiguration {
    id = "com.i18ndoctor.jetbrains"
    name = providers.gradleProperty("pluginName")
    version = providers.gradleProperty("pluginVersion")

    ideaVersion {
      sinceBuild = providers.gradleProperty("pluginSinceBuild")
      untilBuild = provider { null }
    }

    vendor {
      name = "i18n-doctor"
      url = "https://github.com/taha-farzalizadeh/i18n-doctor"
    }
  }

  signing {
    certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
    privateKey = providers.environmentVariable("PRIVATE_KEY")
    password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
  }

  publishing {
    token = providers.environmentVariable("PUBLISH_TOKEN")
  }
}

tasks {
  withType<Test> {
    useJUnitPlatform()
  }

  // Open the demo project when launching a development IDE.
  named<RunIdeTask>("runIde") {
    val demo = layout.projectDirectory.dir("examples/demo-project").asFile.absolutePath
    args = listOf(demo)
  }

  // Ensure the Node language-server bundle exists before packaging / runIde.
  val ensureBundledServer by registering {
    description = "Verifies server/server.js was produced by scripts/bundle-server.mjs"
    doLast {
      val bundled = layout.projectDirectory.file("src/main/resources/server/server.js").asFile
      if (!bundled.isFile || bundled.length() < 1_000) {
        throw GradleException(
          "Missing bundled language server at ${bundled.path}.\n" +
            "Run: npm run build -w i18n-doctor-jetbrains\n" +
            "(or: node scripts/bundle-server.mjs)",
        )
      }
    }
  }

  named("prepareSandbox") {
    dependsOn(ensureBundledServer)
  }

  named("buildPlugin") {
    dependsOn(ensureBundledServer)
  }
}
