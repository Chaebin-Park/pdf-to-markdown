/**
 * image-inliner.ts
 *
 * 변환 결과 Markdown에 포함된 로컬 이미지 경로를 Base64 data URL로 치환한다.
 * opendataloader-pdf-core가 출력하는 이미지 디렉토리 패턴만 대상으로 한다.
 */

import { readBinaryFile } from "./tauri-bridge";

// opendataloader-pdf-core 출력 이미지 경로 패턴
// 예: ![image 4](<opendataloader_input_images/imageFile4.png>)
//     ![image 4](opendataloader_input_images/imageFile4.png)
const IMAGE_PATTERN =
  /!\[([^\]]*)\]\(<?(opendataloader_input_images\/[^>)\s]+)>?\)/g;

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * Markdown 내 로컬 이미지 참조를 Base64 data URL로 인라인 치환한다.
 *
 * @param markdown     변환된 Markdown 문자열
 * @param markdownPath 마크다운 파일의 절대 경로 (이미지 상대경로 기준점)
 * @returns            이미지가 인라인된 Markdown 문자열
 */
export async function inlineImages(
  markdown: string,
  markdownPath: string,
): Promise<string> {
  const matches = [...markdown.matchAll(IMAGE_PATTERN)];
  if (matches.length === 0) return markdown;

  // OS에 따라 경로 구분자가 다를 수 있으므로 양쪽 모두 처리
  const lastSep = Math.max(
    markdownPath.lastIndexOf("/"),
    markdownPath.lastIndexOf("\\"),
  );
  const dir = markdownPath.substring(0, lastSep);
  const sep = markdownPath.includes("\\") ? "\\" : "/";

  let result = markdown;

  for (const match of matches) {
    const [fullMatch, altText, relPath] = match;
    // 상대경로의 슬래시를 OS 구분자로 통일
    const absPath = dir + sep + relPath.split("/").join(sep);

    try {
      const bytes = await readBinaryFile(absPath);
      const base64 = bytesToBase64(bytes);
      const ext = relPath.split(".").pop()?.toLowerCase() ?? "png";
      const mime = MIME_MAP[ext] ?? "image/png";
      result = result.replace(fullMatch, `![${altText}](data:${mime};base64,${base64})`);
    } catch (e) {
      // 이미지 읽기 실패 시 원본 참조 유지
      console.warn(`[inlineImages] 이미지 읽기 실패: ${absPath}`, e);
    }
  }

  return result;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
