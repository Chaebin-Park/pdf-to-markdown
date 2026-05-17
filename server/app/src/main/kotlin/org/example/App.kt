package org.example

import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.plugins.contentnegotiation.*
import io.ktor.server.plugins.cors.routing.*
import java.net.ServerSocket

/**
 * 애플리케이션 진입점.
 *
 * 사용 가능한 포트를 동적으로 할당하고 `PORT=<port>` 형식으로 stdout에 출력한다.
 * Rust(Tauri) 프로세스가 이 출력을 읽어 포트를 파악한다.
 */
fun main() {
    val port = findFreePort()
    println("PORT=$port")

    embeddedServer(Netty, port = port, module = Application::module)
        .start(wait = true)
}

/**
 * Ktor 애플리케이션 모듈.
 *
 * 플러그인 설치 및 라우트 등록을 담당한다.
 */
fun Application.module() {
    install(ContentNegotiation) { json() }
    install(CORS) {
        allowHost("localhost", schemes = listOf("http", "https", "tauri"))
        allowHeader(HttpHeaders.ContentType)
        allowMethod(HttpMethod.Post)
    }
    configureRouting()
}

/**
 * OS에서 사용 가능한 포트를 하나 할당받아 반환한다.
 *
 * [ServerSocket]을 포트 0으로 열면 OS가 빈 포트를 자동 배정한다.
 */
private fun findFreePort(): Int =
    ServerSocket(0).use { it.localPort }
