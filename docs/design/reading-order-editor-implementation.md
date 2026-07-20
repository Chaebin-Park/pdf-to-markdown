# 읽기 순서 편집기 구현 기록

## 상태

- 상태: 구현 및 자동 검증 완료
- 기준 설계: `DESIGN.md`, `docs/design/reading-order-editor.md`
- 범위: 열린 세션에서만 유지되는 페이지 단위 최상위 블록 순서 편집

## 코드 경계와 데이터 흐름

```text
변환 JSON + 인라인 처리된 Markdown
  -> createCanonicalDocument (reading-order-model.ts)
  -> CanonicalDocument
       -> BBox 번호/선택 표시 (bbox-overlay.ts)
       -> 읽기 순서 편집 패널 (reading-order-editor.ts)
       -> serializeMarkdown()
            -> markdown-renderer.ts raw Markdown
                 -> Preview / Source / Copy / Save
                 -> Outline 재생성 입력 / scroll-sync heading 참조
```

- `reading-order-model.ts`는 원본 JSON을 수정하지 않는다. `CanonicalBlock`은 `id`, `sourcePath`, `pageNumber`, `type`, `bbox`, `content`, 불변 자식 트리와 최초 순서를 가진다.
- `PageOrder`는 페이지별 `originalBlockIds`와 `currentBlockIds`만 변경한다. 화면 순번은 식별자가 아니며, 안정 ID는 `p<page>:<sourcePath>`다.
- `bbox-overlay.ts`는 같은 source-path 규칙으로 생성한 ID를 사용해 현재 `PageOrder`의 번호를 다시 표시한다. PDF canvas의 viewport transform을 계속 사용하므로 확대/축소 렌더링과 좌표계는 기존 구현을 유지한다.
- `main.ts`는 변환 완료 후 JSON과 Markdown을 동시에 모델로 전달한다. 순서 변경 이벤트에서 모델을 다시 직렬화해 `setMarkdown()` 하나만 호출한다. `markdown-renderer.ts`의 Preview/Source 렌더, Copy, Save는 모두 그 단일 raw output getter를 읽는다.
- Outline은 기존처럼 현재 Markdown에서 재생성되며, scroll sync는 순서 변경 후 다시 초기화한다. 검색은 PDF 원문 페이지 검색이므로 페이지 안 블록 순서와 결과가 충돌하지 않는다.

## Markdown 매핑 및 fail-closed 규칙

현재 변환기는 JSON 구조와 raw Markdown을 별도 산출물로 제공한다. 역파싱이나 추측으로 순서를 바꾸지 않기 위해 구현은 다음을 모두 만족할 때만 편집을 허용한다.

1. JSON에서 찾은 최상위 heading, paragraph, table, list, image, formula 블록 수와 빈 줄 기준 Markdown 블록 수가 같다.
2. 최초 자동 순서에서 각각의 정규화한 콘텐츠가 같은 위치의 Markdown 블록과 상호 포함 관계로 확인된다.

둘 중 하나라도 실패하면 순서 보기와 위치 오버레이는 제공하지만 편집 패널에 이유를 표시하고 순서 변경을 비활성화한다. 따라서 이미지 alt text 부재, 복합 Markdown 블록, Markdown/JSON 수 불일치에서 저장 결과가 화면 번호와 다르게 되는 상태를 만들지 않는다. 성공한 경우에는 블록 Markdown 조각을 원본 순서에 묶어 두고 현재 `PageOrder`로만 조립한다. 표/수식/이미지의 실제 Markdown 조각은 그대로 이동하며 재포맷하지 않는다.

## 타입과 상태 전이

주요 타입은 `CanonicalBlock`, `CanonicalChild`, `PageOrder`, `ReorderCommand`, `ReorderResult`, `CanonicalDocument`이다. `move()`는 페이지 외 ID, 누락 ID, 중복 ID, 잘못되거나 오래된 인덱스를 실패 결과로 반환하고 상태를 바꾸지 않는다.

```text
Unavailable (JSON 없음 또는 매핑 불가)
  -> Viewing (Order 표시)
  -> Editing (순서 편집)
  -> Moving (drag/drop 또는 Alt+방향키/버튼)
  -> Viewing 또는 Editing
```

각 성공 move는 이전 페이지 order를 undo stack에 넣는다. `undo()`와 `resetPage()`는 `originalBlockIds`에서 복원하며, 원본 JSON/원본 순서는 변경하지 않는다. 새 PDF를 열거나 새 변환을 시작하면 세션 모델은 폐기한다.

## UI 및 접근성 구현

- `Order`는 읽기 순서 오버레이와 보조 편집 표면을 함께 열고, `순서 편집`으로 명시적으로 편집에 들어간다.
- 블록 행은 선택, drag/drop, 앞으로/뒤로/맨앞/맨뒤 버튼을 제공한다. 드롭은 대상 행 앞 삽입으로 계산한다.
- `Alt+↑`, `Alt+↓`, `Alt+Home`, `Alt+End`로 같은 동작을 수행하며 이동 후 같은 블록의 선택 버튼에 focus를 복원한다.
- 페이지 단위 ordered list, 선택 상태, 변경 배지(텍스트 `수정됨`), aria-live 이동 안내를 제공한다. 색만으로 변경/선택/드롭 상태를 전달하지 않는다.
- `prefers-reduced-motion`에서 새 순서 편집기의 이동/전환 애니메이션을 비활성화한다.

## 구현 파일

- `frontend/src/reading-order-model.ts`: canonical 모델, 순수 reorder/undo/reset, 보수적 Markdown mapping/serialization
- `frontend/src/reading-order-editor.ts`: DOM 기반 편집 패널과 키보드/drag/drop 접근성 동작
- `frontend/src/bbox-overlay.ts`: stable ID/sourcePath와 현재 순서 번호 오버레이
- `frontend/src/pdf-viewer.ts`: Order 진입점, 편집기 mount, 현재 PDF 페이지 이벤트
- `frontend/src/main.ts`: 변환 결과에서 모델 생성, Markdown/overlay/scroll 동기화
- `frontend/src/markdown-renderer.ts`: 공통 현재 Markdown 출력 getter를 Preview/Source/Copy/Save에 적용
- `frontend/src/style.css`: 편집 패널, 선택/변경/drop/focus/reduced-motion 스타일
- `frontend/tests/reading-order-model.test.ts`: canonical/reorder/Markdown 회귀 테스트

## 자동 테스트 매트릭스

| 요구 | 증거 |
| --- | --- |
| sourcePath 및 계층 보존 | `canonical model preserves source paths and nested table/list hierarchy` |
| 6,7,8,9,10 → 6,7,9,8,10 | `moves 9 before 8 as a pure page-local command` |
| undo/reset 원본 복원 | `undo and page reset restore the immutable original order` |
| 페이지 밖/중복/누락/잘못된 index 거부 | `rejects cross-page, missing, duplicate, and invalid reorder commands safely` |
| table/list 자식 상대 순서 | `moving a table or list keeps child relative order intact` |
| Preview/Source/Copy/Save 단일 문자열 | `regenerated Markdown is the single value for Preview, Source, Copy, and Save consumers` 및 공통 `getCurrentMarkdownOutput()` |
| 기존 옵션/결과 polling | 기존 `conversion-options.test.ts`, `result-polling.test.ts` |

2026-07-21 실행 결과:

```text
cd frontend && npm test       # 12 passed, 0 failed
cd frontend && npm run build  # tsc + Vite build passed
git diff --check              # passed
```

## 알려진 제한

- Markdown과 JSON이 위의 보수적 1:1 조건을 만족하지 않는 문서는 편집이 비활성화된다. 이는 임의 문자열을 역파싱해 표·이미지·수식을 손상시키는 것보다 의도적인 제한이다.
- 세션 밖 영속화, redo, 다중 블록 이동, 페이지 간 이동, 재변환 후 override 복원은 MVP 범위 밖이다.
- 실제 PDF/WebView에서 50/100/150%와 200% 확대 screen-reader 수동 QA는 자동 테스트 범위 밖이며 릴리스 전 별도 실기기 점검이 필요하다.
