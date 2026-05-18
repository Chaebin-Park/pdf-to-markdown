# Bug Fix Log — pdf-to-markdown

---

## 2026-05-18 — Phase 3 첫 테스트 버그 수정

### BUG-01 드래그앤드롭 미동작
**증상**: Finder에서 PDF를 WebView에 드롭해도 아무 반응 없음  
**원인**: Tauri v2 기본값으로 OS 파일 드롭을 가로채 `tauri://drag-drop` 이벤트로 처리함. 이로 인해 HTML5 `drop` 이벤트의 `dataTransfer.files`가 비어 있음  
**수정**:
- `tauri.conf.json` 윈도우 설정에 `"dragDropEnabled": false` 추가 → HTML5 drag API 정상 동작
- `isPdf()` 헬퍼 추가: `file.type === "application/pdf"` 외에 `.pdf` 확장자도 허용 (macOS Finder가 MIME 타입을 생략하는 경우 대응)  
**커밋**: `d138dd7`

---

### BUG-02 변환 요청 오류 (`TypeError: Load failed`)
**증상**: [변환] 버튼 클릭 시 `변환 요청 오류: TypeError: Load failed` 발생  
**원인**: Ktor CORS 설정 `allowHost("localhost")` 가 `Origin: http://localhost:1420`을 허용하지 않음. Ktor CORS는 포트를 포함한 호스트를 비교하므로, `"localhost"`는 `"localhost:1420"`과 매칭되지 않아 preflight OPTIONS 요청이 차단됨  
**수정**: `anyHost()` 로 변경. 로컬 전용 데스크탑 앱이고 dev/prod WebView origin이 각각 `http://localhost:1420` / `tauri://localhost`로 달라 포트 열거가 비현실적  
**커밋**: `d138dd7`

---

### BUG-03 PDF 미리보기 무응답 (로딩 후 빈 화면)
**증상**: 파일 선택 후 박스·스크롤은 나타나나 PDF 내용이 표시되지 않음  
**원인 탐색 과정**:

| 시도 | 결과 |
|---|---|
| `?url` import로 worker URL 수정 | 박스는 생기나 내용 없음 |
| `public/pdf.worker.min.mjs` 정적 경로로 변경 | 박스는 생기나 내용 없음 |
| DPR 스케일링 제거 + try/catch 에러 시각화 추가 | **에러 메시지 확인**: `TypeError: this.#methodPromises.getOrInsertComputed is not a function` |

**최종 원인**: `pdfjs-dist v5.7`이 `Map.prototype.getOrInsertComputed` (TC39 Stage 3 proposal)를 사용하는데, 현재 macOS 시스템 WebKit이 해당 메서드를 지원하지 않음  
**수정**:
- `pdfjs-dist v5.7.284` → `v4.10.38` 다운그레이드
- `page.render()` API에서 v5 전용 `canvas` 파라미터 제거
- `public/pdf.worker.min.mjs`는 postinstall 스크립트로 v4 파일로 교체  
**커밋**: `e2215da`, `6dc5521`, `067a6b8`

---

### BUG-04 PDF.js worker URL 잘못된 경로
**증상**: (BUG-03 진단 과정에서 발견) 빌드/dev 모드 모두에서 worker가 초기화되지 않음  
**원인**: `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` — Vite dev 모드에서 `import.meta.url`이 `http://localhost:1420/src/pdf-viewer.ts`로 해석되어 결과가 `http://localhost:1420/src/pdfjs-dist/...`라는 존재하지 않는 경로가 됨  
**수정**: worker 파일을 `public/pdf.worker.min.mjs`로 복사하고 `/pdf.worker.min.mjs` 절대 경로로 참조. `postinstall` 스크립트로 `npm install` 시 자동 복사  
**커밋**: `e2215da`

---

## 수정 후 동작 확인

| 항목 | 상태 |
|---|---|
| 스플래시 → 레이아웃 전환 | ✅ |
| 온보딩 모달 | ✅ |
| 파일 선택 → PDF 미리보기 | ✅ |
| 드래그앤드롭 → PDF 미리보기 | ✅ |
| [변환] → Markdown 출력 | ✅ |
| BBox 오버레이 | 미확인 (변환 성공 후 JSON 있으면 동작 예상) |
| Hybrid/OCR/Formula 모드 | 미테스트 (docling-serve 설치 필요) |
