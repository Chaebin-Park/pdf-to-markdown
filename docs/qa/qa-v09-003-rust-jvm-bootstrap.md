# QA-v09-003 Rust JVM bootstrap verification

Date: 2026-07-20

## Scope

This verification locks the Tauri-side command arguments used to launch the bundled Ktor server. It covers the JVM module/native-access options required by the PDFBox runtime, their position before `-jar`, and preservation of a JAR path containing spaces or Unicode characters as one operating-system argument.

The tests construct arguments only. They do not spawn Java or start Ktor.

## Acceptance criteria

- The command contains both required `--add-opens` options, the required `--add-exports` option, and `--enable-native-access=ALL-UNNAMED` in the expected order.
- JVM options precede `-jar` and the server JAR path.
- A path containing spaces and Korean characters remains one `OsString` argument.
- Production launch code consumes the same argument builder exercised by the tests.
- `cargo test`, `cargo check`, and `git diff --check` pass.

## Commands and evidence

The Tauri build requires the configured server JAR resource, so it was generated first:

```text
$ (cd server && ./gradlew :app:shadowJar)
BUILD SUCCESSFUL in 23s
3 actionable tasks: 3 executed
```

```text
$ cargo test --manifest-path src-tauri/Cargo.toml
running 3 tests
test tests::ktor_jvm_args_preserve_pdfbox_module_access_contract ... ok
test tests::ktor_server_args_put_jvm_options_before_jar_target ... ok
test tests::ktor_server_args_preserve_unicode_jar_path_as_one_argument ... ok
test result: ok. 3 passed; 0 failed; 0 ignored
```

```text
$ cargo check --manifest-path src-tauri/Cargo.toml
Finished `dev` profile [unoptimized + debuginfo] target(s) in 19.35s
```

```text
$ git diff --check
(no output; exit 0)
```

## Residual risks

- These unit tests do not prove that a particular installed or bundled Java version accepts the options.
- They do not exercise resource resolution, JRE extraction, process spawning, Ktor readiness, PDF conversion, or shutdown behavior.
- Windows extended-length path normalization is platform-gated and is not exercised by this macOS run.
