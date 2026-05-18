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

/// WebView에서 Ktor 서버 포트를 조회하는 Tauri command.
///
/// 서버 기동 전에는 `null`을 반환하므로 프론트엔드는 `server-ready` 이벤트 수신 후 호출해야 한다.
#[tauri::command]
fn get_server_port(state: tauri::State<ServerState>) -> Option<u16> {
    *state.port.lock().unwrap()
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
        .setup(move |app| {
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

            let mut child = Command::new("java")
                .arg("-jar")
                .arg(&jar_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
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
                        log::error!("Ktor server did not become ready in time");
                    }
                } else {
                    log::error!("Timed out waiting for PORT= from Ktor server");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_server_port])
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
