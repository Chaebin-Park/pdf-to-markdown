/**
 * docling-state.ts
 *
 * docling-serve 준비 상태를 앱 전역에서 공유하기 위한 단순 상태 모듈.
 * main.ts에서 setDoclingReady()를 호출하고,
 * pdf-viewer.ts 등 다른 모듈에서 isDoclingReady()로 읽는다.
 */

let _ready = false;
const _listeners: Array<(ready: boolean) => void> = [];

/** docling-serve가 준비됐음을 기록하고 구독자에게 알린다. */
export function setDoclingReady(ready: boolean): void {
  _ready = ready;
  _listeners.forEach((fn) => fn(ready));
}

/** docling-serve 준비 여부를 반환한다. */
export function isDoclingReady(): boolean {
  return _ready;
}

/** docling 준비 상태가 바뀔 때 호출될 콜백을 등록한다. 반환값으로 해제 가능. */
export function onDoclingReadyChange(fn: (ready: boolean) => void): () => void {
  _listeners.push(fn);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i >= 0) _listeners.splice(i, 1);
  };
}
