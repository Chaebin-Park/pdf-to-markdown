use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::{sync::mpsc, thread};

use tauri::{Emitter, Manager};

/// Ktor 로컬 서버의 포트 상태.
///
/// 앱 전체에서 공유되며 [tauri::Builder::manage]로 등록된다.
/// 프로세스 핸들은 `run()` 클로저와 공유해야 하므로 별도 [Arc]로 관리한다.
struct ServerState {
    /// 서버가 수신 중인 포트. 기동 완료 전에는 `None`.
    port: Mutex<Option<u16>>,
}

/// docling-serve 프로세스의 포트 상태.
///
/// 하이브리드 모드가 활성화된 경우에만 사용된다.
/// 프로세스 핸들은 `run()` 클로저와 공유해야 하므로 별도 [Arc]로 관리한다.
struct DoclingState {
    /// docling-serve가 수신 중인 포트. 기동 완료 전에는 `None`.
    port: Mutex<Option<u16>>,
}

/// docling-serve 프로세스 핸들을 Tauri 상태로 공유하기 위한 래퍼.
///
/// [start_docling_serve] command와 [tauri::RunEvent::Exit] 핸들러 양쪽에서 접근한다.
struct DoclingHandle(Arc<Mutex<Option<Child>>>);

/// WebView에서 Ktor 서버 포트를 조회하는 Tauri command.
///
/// 서버 기동 전에는 `null`을 반환하므로 프론트엔드는 `server-ready` 이벤트 수신 후 호출해야 한다.
#[tauri::command]
fn get_server_port(state: tauri::State<ServerState>) -> Option<u16> {
    *state.port.lock().unwrap()
}

/// 하이브리드 모드 Python 환경이 설치되어 있는지 확인하는 Tauri command.
///
/// 캐시 디렉토리의 `.hybrid_installed` 플래그 파일 존재 여부로 판단한다.
/// - macOS: `~/Library/Caches/opendataloader/.hybrid_installed`
/// - Windows: `%LOCALAPPDATA%\opendataloader\.hybrid_installed`
#[tauri::command]
fn check_hybrid_installed(app: tauri::AppHandle) -> bool {
    app.path()
        .cache_dir()
        .map(|dir| dir.join("opendataloader").join(".hybrid_installed").exists())
        .unwrap_or(false)
}

/// 번들된 uv 바이너리의 경로를 반환하는 헬퍼.
///
/// 플랫폼과 아키텍처에 따라 리소스 파일명을 선택한다.
/// 현재 번들: macOS arm64 (`uv-macos-arm64`), Windows x64 (`uv-windows-x86_64.exe`).
fn uv_binary_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    let name = "uv-macos-arm64";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    let name = "uv-macos-x86_64";
    #[cfg(target_os = "windows")]
    let name = "uv-windows-x86_64.exe";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let name = "uv";

    app.path()
        .resolve(name, tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())
}

/// `java` 실행 파일 경로를 반환한다.
///
/// 우선순위:
/// 1. `JAVA_HOME` 환경변수 → `$JAVA_HOME/bin/java(.exe)`
/// 2. Windows: 주요 설치 경로 직접 탐색 (Oracle, Temurin, Microsoft, Corretto)
/// 3. `PATH`에서 `java` 검색 (fallback)
///
/// Windows GUI 앱은 사용자 셸과 다른 환경을 상속받아 PATH에서 java를 못 찾는 경우가 있으므로
/// JAVA_HOME 및 공통 설치 경로를 먼저 확인한다.
/// jre.zip 번들을 리소스 디렉토리에 압축 해제한다 (Windows 전용).
///
/// 이미 추출되어 있으면 즉시 경로를 반환한다.
/// 첫 실행 시 PowerShell의 `Expand-Archive`로 jre.zip을 해제한다.
#[cfg(target_os = "windows")]
fn ensure_bundled_jre(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let java_exe = resource_dir.join("jre").join("bin").join("java.exe");

    if java_exe.exists() {
        log::info!("번들 JRE 이미 추출됨: {}", java_exe.display());
        return Some(java_exe);
    }

    let zip_path = app.path()
        .resolve("jre.zip", tauri::path::BaseDirectory::Resource)
        .ok()?;

    if !zip_path.exists() {
        log::warn!("jre.zip 없음: {}", zip_path.display());
        return None;
    }

    log::info!("번들 JRE 압축 해제 중: {} → {}", zip_path.display(), resource_dir.display());

    let status = Command::new("powershell")
        .args([
            "-NoProfile", "-NonInteractive", "-Command",
            &format!(
                "Expand-Archive -Force '{}' '{}'",
                zip_path.display(),
                resource_dir.display()
            ),
        ])
        .status()
        .ok()?;

    if status.success() && java_exe.exists() {
        log::info!("번들 JRE 추출 완료: {}", java_exe.display());
        Some(java_exe)
    } else {
        log::error!("번들 JRE 추출 실패 (exit: {:?})", status.code());
        None
    }
}

fn find_java(bundled_java: Option<std::path::PathBuf>) -> std::path::PathBuf {
    // 0. 번들된 JRE (Windows 배포판에 포함)
    if let Some(java) = bundled_java {
        if java.exists() {
            log::info!("번들 JRE 사용: {}", java.display());
            return java;
        }
    }

    // 1. JAVA_HOME
    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        #[cfg(target_os = "windows")]
        let candidate = std::path::PathBuf::from(&java_home).join("bin").join("java.exe");
        #[cfg(not(target_os = "windows"))]
        let candidate = std::path::PathBuf::from(&java_home).join("bin").join("java");

        if candidate.exists() {
            log::info!("Java found via JAVA_HOME: {}", candidate.display());
            return candidate;
        }
        log::warn!("JAVA_HOME={java_home} 설정됐지만 java 바이너리 없음, 경로 탐색으로 전환");
    }

    // 2. Windows 주요 설치 경로 탐색 (Java 21 이상만)
    #[cfg(target_os = "windows")]
    {
        let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        let vendors = ["Eclipse Adoptium", "Microsoft", "Amazon Corretto", "BellSoft", "Azul", "Java"];
        for vendor in &vendors {
            let base = std::path::PathBuf::from(&program_files).join(vendor);
            if let Ok(entries) = std::fs::read_dir(&base) {
                let mut dirs: Vec<_> = entries.filter_map(|e| e.ok()).collect();
                dirs.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
                for entry in dirs {
                    let name = entry.file_name().to_string_lossy().to_lowercase();
                    // Java 21 이상만 허용 (jdk-21, jre21, jdk21.0.x, openlogic-openjdk-21 등)
                    let version_ok = name.contains("21") || name.contains("22") || name.contains("23") || name.contains("24");
                    if !version_ok {
                        log::info!("Java 버전 21 미만 스킵: {}", entry.path().display());
                        continue;
                    }
                    let candidate = entry.path().join("bin").join("java.exe");
                    if candidate.exists() {
                        log::info!("Java found via path scan: {}", candidate.display());
                        return candidate;
                    }
                }
            }
        }
    }

    // 3. PATH fallback
    #[cfg(target_os = "windows")]
    return std::path::PathBuf::from("java.exe");
    #[cfg(not(target_os = "windows"))]
    return std::path::PathBuf::from("java");
}

/// docling-serve 고정 포트.
const DOCLING_PORT: u16 = 5002;

/// `hybrid-install-progress` 이벤트 페이로드.
///
/// 프론트엔드에서 설치 단계와 진행률을 표시하는 데 사용된다.
#[derive(serde::Serialize, Clone)]
struct InstallProgress {
    /// 현재 단계 번호 (1: Python 설치, 2: 가상 환경 생성, 3: 패키지 설치).
    step: u8,
    /// 사용자에게 표시할 메시지.
    message: String,
    /// 전체 진행률 (0–100).
    percent: u8,
}

/// 하이브리드 모드 Python 환경을 설치하는 Tauri command.
///
/// 순서:
/// 1. `uv python install 3.11` — Python 3.11 설치
/// 2. `uv venv <cache>/venv --python 3.11` — 가상 환경 생성
/// 3. `uv pip install --python <cache>/venv "opendataloader-pdf[hybrid]"` — 패키지 설치
///
/// 각 단계 전후로 `hybrid-install-progress` 이벤트를 emit한다.
/// 패키지 설치 중 출력 라인은 `hybrid-install-log` 이벤트로 실시간 전달된다.
/// 모든 단계 성공 시 `.hybrid_installed` 플래그 파일을 생성한다.
#[tauri::command]
async fn install_hybrid(app: tauri::AppHandle) -> Result<(), String> {
    let uv = uv_binary_path(&app)?;

    let cache_dir = app
        .path()
        .cache_dir()
        .map_err(|e| e.to_string())?
        .join("opendataloader");
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let venv_dir = cache_dir.join("venv");

    let emit = |step: u8, message: &str, percent: u8| {
        let _ = app.emit(
            "hybrid-install-progress",
            InstallProgress {
                step,
                message: message.to_string(),
                percent,
            },
        );
    };

    // Step 1: Python 3.11 설치
    emit(1, "Python 3.11 다운로드 및 설치 중...", 5);
    let status = Command::new(&uv)
        .args(["python", "install", "3.11"])
        .status()
        .map_err(|e| format!("Python 설치 실패: {e}"))?;
    if !status.success() {
        return Err(format!("uv python install 실패 (exit {:?})", status.code()));
    }
    emit(1, "Python 3.11 설치 완료", 30);

    // Step 2: 가상 환경 생성
    emit(2, "가상 환경 생성 중...", 35);
    let status = Command::new(&uv)
        .args([
            "venv",
            venv_dir.to_str().unwrap(),
            "--python",
            "3.11",
            "--clear", // 중단된 설치로 venv가 불완전하게 존재할 경우 재생성
        ])
        .status()
        .map_err(|e| format!("가상 환경 생성 실패: {e}"))?;
    if !status.success() {
        return Err(format!("uv venv 실패 (exit {:?})", status.code()));
    }
    emit(2, "가상 환경 생성 완료", 40);

    // Step 3: 패키지 설치 (stderr 실시간 스트리밍)
    emit(3, "opendataloader-pdf[hybrid] 패키지 설치 중...", 45);
    let mut child = Command::new(&uv)
        .args([
            "pip",
            "install",
            "--python",
            venv_dir.to_str().unwrap(),
            "opendataloader-pdf[hybrid]",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("패키지 설치 시작 실패: {e}"))?;

    // pip 출력을 프론트엔드로 실시간 전달
    let stderr = child.stderr.take().expect("stderr not captured");
    let app_log = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = app_log.emit("hybrid-install-log", line);
        }
    });

    let status = child.wait().map_err(|e| format!("패키지 설치 대기 실패: {e}"))?;
    if !status.success() {
        return Err(format!("uv pip install 실패 (exit {:?})", status.code()));
    }
    emit(3, "패키지 설치 완료", 95);

    // 설치 완료 플래그 파일 생성
    std::fs::write(cache_dir.join(".hybrid_installed"), "")
        .map_err(|e| format!("플래그 파일 생성 실패: {e}"))?;
    emit(3, "하이브리드 모드 활성화 완료", 100);

    Ok(())
}

/// 하이브리드 모드 Python 환경을 제거하는 Tauri command.
///
/// 실행 중인 docling-serve를 종료하고 venv 디렉토리와 `.hybrid_installed` 플래그 파일을 삭제한다.
/// DoclingState 포트도 초기화하여 이후 startDoclingServe 호출이 다시 가능하도록 한다.
#[tauri::command]
fn uninstall_hybrid(
    app: tauri::AppHandle,
    handle_state: tauri::State<'_, DoclingHandle>,
    docling_state: tauri::State<'_, DoclingState>,
) -> Result<(), String> {
    // 실행 중인 docling-serve 종료
    if let Ok(mut guard) = handle_state.0.lock() {
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
        }
        *guard = None;
    }
    *docling_state.port.lock().unwrap() = None;

    let cache_dir = app
        .path()
        .cache_dir()
        .map_err(|e| e.to_string())?
        .join("opendataloader");

    let venv_dir = cache_dir.join("venv");
    if venv_dir.exists() {
        std::fs::remove_dir_all(&venv_dir)
            .map_err(|e| format!("venv 삭제 실패: {e}"))?;
    }

    let flag = cache_dir.join(".hybrid_installed");
    if flag.exists() {
        std::fs::remove_file(&flag)
            .map_err(|e| format!("플래그 파일 삭제 실패: {e}"))?;
    }

    Ok(())
}

/// Windows Extended-Length Path 접두사(`\\?\`)를 제거해 일반 경로로 변환한다.
///
/// Java launcher는 `\\?\` 접두사가 붙은 경로로 `-jar`를 전달하면 JAR를 찾지 못한다.
fn normalize_path(path: std::path::PathBuf) -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        let s = path.to_string_lossy();
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return std::path::PathBuf::from(stripped.to_string());
        }
    }
    path
}

/// 지정 포트로 TCP 연결을 시도하며 서버 기동을 확인한다.
///
/// `timeout_secs` 초 내에 연결이 성공하면 `true`, 타임아웃이면 `false`를 반환한다.
fn wait_for_server(port: u16, timeout_secs: u64) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);
    while std::time::Instant::now() < deadline {
        if TcpStream::connect_timeout(
            &addr.parse().expect("invalid address"),
            Duration::from_millis(300),
        )
        .is_ok()
        {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    false
}

/// docling-serve 프로세스를 시작하는 Tauri command.
///
/// `<cache>/venv/bin/docling-serve run --host 127.0.0.1 --port 5002` 를 실행한다.
/// 이미 실행 중인 경우(포트가 설정된 경우) 즉시 반환한다.
/// 서버 기동 완료는 백그라운드 스레드에서 TCP 폴링으로 확인 후 `docling-ready` 이벤트로 알린다.
#[tauri::command]
fn start_docling_serve(
    app: tauri::AppHandle,
    handle_state: tauri::State<'_, DoclingHandle>,
    docling_state: tauri::State<'_, DoclingState>,
) -> Result<(), String> {
    // 이미 실행 중이면 no-op
    if docling_state.port.lock().unwrap().is_some() {
        return Ok(());
    }

    let cache_dir = app
        .path()
        .cache_dir()
        .map_err(|e| e.to_string())?
        .join("opendataloader");

    #[cfg(target_os = "windows")]
    let docling_bin = cache_dir.join("venv").join("Scripts").join("opendataloader-pdf-hybrid.exe");
    #[cfg(not(target_os = "windows"))]
    let docling_bin = cache_dir.join("venv").join("bin").join("opendataloader-pdf-hybrid");

    if !docling_bin.exists() {
        return Err(
            "opendataloader-pdf-hybrid 실행 파일을 찾을 수 없습니다. install_hybrid를 먼저 실행해 주세요."
                .to_string(),
        );
    }

    // 앱 강제 종료 후 좀비 프로세스가 포트를 점유하고 있을 수 있음.
    // 포트가 이미 열려있으면 기존 프로세스를 재활용하고 새 프로세스를 시작하지 않는다.
    if wait_for_server(DOCLING_PORT, 2) {
        *docling_state.port.lock().unwrap() = Some(DOCLING_PORT);
        let _ = app.emit("docling-ready", DOCLING_PORT);
        log::info!("docling-serve already running on port {DOCLING_PORT}, reusing");
        return Ok(());
    }

    let child = Command::new(&docling_bin)
        .args(["--host", "127.0.0.1", "--port", &DOCLING_PORT.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("docling-serve 시작 실패: {e}"))?;

    *handle_state.0.lock().unwrap() = Some(child);

    // 백그라운드 스레드에서 TCP health check 후 상태 갱신 및 이벤트 emit
    let app_handle = app.clone();
    thread::spawn(move || {
        if wait_for_server(DOCLING_PORT, 60) {
            let state = app_handle.state::<DoclingState>();
            *state.port.lock().unwrap() = Some(DOCLING_PORT);
            let _ = app_handle.emit("docling-ready", DOCLING_PORT);
            log::info!("docling-serve ready on port {DOCLING_PORT}");
        } else {
            log::error!("docling-serve did not become ready in time");
        }
    });

    Ok(())
}

/// WebView에서 docling-serve 포트를 조회하는 Tauri command.
///
/// 서버 기동 전에는 `null`을 반환하므로 프론트엔드는 `docling-ready` 이벤트 수신 후 호출해야 한다.
#[tauri::command]
fn get_docling_port(state: tauri::State<DoclingState>) -> Option<u16> {
    *state.port.lock().unwrap()
}

/// PDF 바이트 배열을 시스템 임시 디렉터리에 저장하고 절대 경로를 반환한다.
///
/// Ktor 서버는 파일 경로 기반으로 변환 요청을 받으므로, 프론트엔드에서 드롭한 PDF를
/// 임시 파일로 저장하여 경로를 전달할 때 사용한다.
#[tauri::command]
fn save_temp_pdf(app: tauri::AppHandle, data: Vec<u8>) -> Result<String, String> {
    let tmp_dir = app
        .path()
        .temp_dir()
        .map_err(|e| format!("임시 디렉터리 조회 실패: {e}"))?;
    let path = tmp_dir.join("opendataloader_input.pdf");
    std::fs::write(&path, &data).map_err(|e| format!("PDF 임시 저장 실패: {e}"))?;
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "파일 경로 변환 실패".to_string())
}

/// 지정 경로의 텍스트 파일을 읽어 문자열로 반환한다.
///
/// Ktor 변환 결과로 반환된 markdownPath를 프론트엔드에서 읽을 때 사용한다.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("파일 읽기 실패 ({path}): {e}"))
}

/// 지정 경로의 파일을 바이너리로 읽어 바이트 배열을 반환한다.
///
/// 변환 결과에 포함된 이미지 파일을 Base64로 인라인 임베딩할 때 사용한다.
#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("파일 읽기 실패 ({path}): {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 프로세스 핸들은 setup 클로저와 run 클로저 양쪽에서 접근하므로 Arc로 공유
    let process_handle: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let process_handle_for_run = Arc::clone(&process_handle);

    let docling_handle: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let docling_handle_for_run = Arc::clone(&docling_handle);

    tauri::Builder::default()
        .manage(ServerState {
            port: Mutex::new(None),
        })
        .manage(DoclingState {
            port: Mutex::new(None),
        })
        .manage(DoclingHandle(docling_handle))
        .setup(move |app| {
            app.handle()
                .plugin(tauri_plugin_window_state::Builder::default().build())?;
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            app.handle().plugin(tauri_plugin_process::init())?;
            app.handle().plugin(tauri_plugin_dialog::init())?;
            app.handle().plugin(tauri_plugin_fs::init())?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 번들된 server.jar 경로 조회
            let jar_path = app
                .path()
                .resolve("server.jar", tauri::path::BaseDirectory::Resource)?;

            // Windows: jre.zip 번들 압축 해제 후 경로 반환 (이미 해제됐으면 즉시 반환)
            #[cfg(target_os = "windows")]
            let bundled_java = ensure_bundled_jre(app.handle());
            #[cfg(not(target_os = "windows"))]
            let bundled_java: Option<std::path::PathBuf> = None;

            // 진단 정보 수집
            let bundled_jre_display = bundled_java.as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "N/A".to_string());
            let bundled_jre_exists = bundled_java.as_ref().map(|p| p.exists()).unwrap_or(false);
            let resource_dir = app.path()
                .resolve(".", tauri::path::BaseDirectory::Resource)
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| "조회 실패".to_string());

            let java = normalize_path(find_java(bundled_java));
            let jar_path = normalize_path(jar_path);
            let java_display = java.display().to_string();

            log::info!("[진단] 리소스 디렉토리: {resource_dir}");
            log::info!("[진단] 번들 JRE: {bundled_jre_display} (존재: {bundled_jre_exists})");
            log::info!("[진단] 선택된 java: {java_display}");
            log::info!("Launching Ktor server: {} -jar {}", java.display(), jar_path.display());
            let mut child = Command::new(&java)
                .arg("-jar")
                .arg(&jar_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()?;

            // stdout에서 PORT= 줄을 읽는 스레드 (나머지 줄은 drain해서 파이프 막힘 방지)
            let stdout = child.stdout.take().expect("stdout not captured");
            let (tx, rx) = mpsc::channel::<u16>();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    if let Some(port_str) = line.strip_prefix("PORT=") {
                        if let Ok(port) = port_str.trim().parse::<u16>() {
                            let _ = tx.send(port);
                        }
                    }
                }
            });

            // stderr를 로그로 출력 (서버 시작 실패 원인 파악용)
            let stderr = child.stderr.take().expect("stderr not captured");
            thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    log::warn!("[server.jar] {line}");
                }
            });

            *process_handle.lock().unwrap() = Some(child);

            // 비동기 스레드에서 서버 기동 대기 후 상태 갱신 및 이벤트 emit
            let app_handle = app.handle().clone();
            thread::spawn(move || {
                // PORT= 수신 대기 (최대 60초)
                if let Ok(port) = rx.recv_timeout(Duration::from_secs(60)) {
                    // TCP 연결이 수락될 때까지 폴링 (최대 30초)
                    if wait_for_server(port, 30) {
                        let state = app_handle.state::<ServerState>();
                        *state.port.lock().unwrap() = Some(port);
                        let _ = app_handle.emit("server-ready", port);
                        log::info!("Ktor server ready on port {port}");
                    } else {
                        let msg = format!(
                            "서버 포트 응답 없음.\njava: {java_display}\n번들 JRE: {bundled_jre_display} (존재: {bundled_jre_exists})\n리소스 디렉토리: {resource_dir}"
                        );
                        log::error!("{msg}");
                        let _ = app_handle.emit("server-error", msg);
                    }
                } else {
                    let msg = format!(
                        "서버 시작 타임아웃 (60초).\njava: {java_display}\n번들 JRE: {bundled_jre_display} (존재: {bundled_jre_exists})\n리소스 디렉토리: {resource_dir}"
                    );
                    log::error!("{msg}");
                    let _ = app_handle.emit("server-error", msg);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_server_port,
            check_hybrid_installed,
            install_hybrid,
            uninstall_hybrid,
            start_docling_serve,
            get_docling_port,
            save_temp_pdf,
            read_text_file,
            read_binary_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            // 앱 종료 시 JVM 프로세스 정리
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut guard) = process_handle_for_run.lock() {
                    if let Some(child) = guard.as_mut() {
                        let _ = child.kill();
                        log::info!("Ktor server process terminated");
                    }
                }
                if let Ok(mut guard) = docling_handle_for_run.lock() {
                    if let Some(child) = guard.as_mut() {
                        let _ = child.kill();
                        log::info!("docling-serve process terminated");
                    }
                }
            }
        });
}
