/**
 * docling-state.ts
 *
 * docling-serve 준비 상태를 앱 전역에서 공유하기 위한 단순 상태 모듈.
 * main.ts에서 setDoclingReady()를 호출하고,
 * pdf-viewer.ts 등 다른 모듈에서 isDoclingReady()로 읽는다.
 */

let _ready = false;

/** docling-serve가 준비됐음을 기록한다. main.ts에서만 호출한다. */
export function setDoclingReady(ready: boolean): void {
  _ready = ready;
}

/** docling-serve 준비 여부를 반환한다. */
export function isDoclingReady(): boolean {
  return _ready;
}
