# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-07-20
- Primary product surfaces: desktop split view, PDF toolbar and overlays, Markdown preview/source, activity rail and side panels, settings and conversion-quality controls
- Evidence reviewed: `frontend/src/layout.ts`, `frontend/src/pdf-viewer.ts`, `frontend/src/bbox-overlay.ts`, `frontend/src/markdown-renderer.ts`, `frontend/src/style.css`, `docs/qa/conversion-quality-improvements.md`, Wiki project planning and v0.9 documents
- Feature-level contract: `docs/design/reading-order-editor.md`

## Brand

- Personality: precise, calm, local-first, and technically capable without exposing parser terminology unnecessarily
- Trust signals: original PDF and converted result shown together, reversible edits, explicit warnings, local processing, and visible source/result correspondence
- Avoid: unexplained terms such as XY-Cut in primary controls, destructive one-click transformations, decorative UI that competes with document content, and claims that automatic conversion is always correct

## Product goals

- Goals: convert PDFs into dependable Markdown; make extraction errors visible and correctable; preserve tables, formulas, headings, and reading order; keep user documents local
- Non-goals: full PDF editing, page layout authoring, collaborative document review, or replacing a general-purpose Markdown editor
- Success signals: users can identify a wrong reading order, correct it without editing raw Markdown, and obtain the same corrected order in Preview, Source, Copy, and Save

## Personas and jobs

- Primary personas: researchers, developers preparing documents for AI/RAG, and users digitizing reports or scanned documents
- User jobs: inspect conversion quality, correct structural mistakes, export trustworthy Markdown, and understand advanced options without knowing PDF parsing algorithms
- Key contexts of use: desktop, mouse/trackpad or keyboard, long technical PDFs, multi-column pages, and documents with tables, figures, footnotes, or imperfect structure tags

## Information architecture

- Primary navigation: activity rail for document-level tools; PDF toolbar for view and conversion actions; Markdown toolbar for result views and export
- Core routes/screens: single desktop workspace with PDF on the left and Markdown on the right
- Content hierarchy: app actions → document actions → page inspection → block-level correction → exported result
- Reading-order correction belongs to the existing `Order` control because it is a refinement of the current order visualization, not a separate global settings category

## Design principles

- Show before changing: enter with the detected order visible; editing is an explicit second state
- Use user language first: label actions as “읽기 순서”, “순서 편집”, and “원래 순서로”; keep algorithm names under technical details
- One correction, one result: Preview, Source, Copy, Save, Outline, search, and scroll references must derive from the same ordered document model
- Reversible by default: every move supports undo; every changed page supports reset; the original parser result remains recoverable
- Constrain the first release: page-local top-level blocks only, with clear boundaries for nested content and cross-page moves
- Tradeoffs: correctness and recoverability take priority over making every PDF structure directly editable

## Visual language

- Color: reuse existing Deep Ink tokens; coral remains the reading-order accent; selected, drop-target, changed, warning, and focus states must remain distinguishable without color alone
- Typography: reuse Geist and Geist Mono; technical identifiers and order numbers may use mono, while actions and guidance use the primary UI font
- Spacing/layout rhythm: follow the compact toolbar and side-panel rhythm already present; editing controls must not obscure the PDF block being moved
- Shape/radius/elevation: reuse current buttons, popovers, chips, borders, and overlays; avoid a second visual system
- Motion: short positional feedback only; honor reduced-motion preferences and do not animate long-distance block paths
- Imagery/iconography: reuse the existing line-icon style; pair unfamiliar icons with text labels or tooltips

## Components

- Existing components to reuse: `Order` toolbar toggle, BBox overlay layer, toolbar buttons, side panel, Markdown Preview/Source/Split tabs, status bar, and existing dialog/popover patterns
- New/changed components: reading-order edit toolbar, interactive order chip, block outline, drop indicator, page change badge, undo/redo/reset controls, keyboard move actions, and unresolved-change notice
- Variants and states: viewing, editing, selected, dragging, keyboard-moving, valid drop target, invalid target, changed, saving/applying, conflict, and reset confirmation when multiple edits exist
- Token/component ownership: extend `frontend/src/style.css` tokens and repo-native TypeScript modules; do not introduce a component framework or new dependency solely for this feature

## Accessibility

- Target standard: WCAG 2.2 AA for the new workflow
- Keyboard/focus behavior: all blocks are focusable in edit mode; Space/Enter selects, arrow-key commands move, Escape cancels drag/selection, and focus follows the moved block
- Contrast/readability: order values and state boundaries meet contrast requirements; selected and changed states include shape, label, or icon cues
- Screen-reader semantics: expose a page-scoped ordered list, block type and text excerpt, current position, total count, and move result through a polite live region
- Reduced motion and sensory considerations: disable movement animation under `prefers-reduced-motion`; never rely on color or motion alone

## Responsive behavior

- Supported breakpoints/devices: desktop macOS and Windows WebViews; mouse, trackpad, keyboard, and touch-capable Windows devices
- Layout adaptations: when the PDF pane is narrow, editing commands move into a compact floating bar or side panel while the page remains visible
- Touch/hover differences: use a drag handle and sufficiently large targets; essential guidance must not depend on hover

## Interaction states

- Loading: order editing is unavailable until structured JSON and Markdown are both ready
- Empty: explain that a conversion with layout data is required
- Error: preserve the last valid order and show why the result could not be regenerated
- Success: mark changed pages and announce that Preview/Source/export now use the corrected order
- Disabled: explain unsupported items, conversion-in-progress state, or missing structured mapping
- Offline/slow network: no network dependency; regeneration should be local and immediate, with progress only for unusually large documents

## Content voice

- Tone: concise, reassuring, and explicit about consequences
- Terminology: use “문단 순서” in conversion settings and “읽기 순서” in inspection/editing; describe XY-Cut as “화면에 보이는 배치 우선” outside technical details
- Microcopy rules: state scope (“이 페이지 안에서”), result (“미리보기와 저장 파일에 반영”), and recovery (“원래 순서로 되돌리기”); avoid parser internals in primary labels

## Implementation constraints

- Framework/styling system: Tauri 2, TypeScript, PDF.js, existing DOM-based UI, and `frontend/src/style.css`
- Design-token constraints: extend existing CSS custom properties and Deep Ink patterns
- Performance constraints: moving a block must not rerun PDF extraction; reorder the already-converted structured model and regenerate affected output deterministically
- Compatibility constraints: current BBox items lack stable IDs/source paths, and current Markdown rendering stores one raw string; implementation must introduce a canonical structured document model before editable order can be reliable
- Test/screenshot expectations: unit tests for ordering and serialization, integration tests for all result consumers, keyboard/accessibility checks, and visual smoke at 50%, 100%, and 150% PDF zoom

## Open questions

- [ ] Decide whether edits persist only for the open session or as a sidecar/local record keyed by PDF fingerprint / product owner / affects reopen behavior
- [ ] Decide whether the first release needs redo in addition to undo / product owner / affects toolbar scope
- [ ] Define stable block identity across reconversion when parser output changes / engineering / affects edit recovery
- [ ] Decide whether page-crossing moves are needed after MVP evidence / product owner / affects data model and export semantics
- [ ] Validate the interaction on representative multi-column and footnote-heavy PDFs / QA / blocks stable release, not implementation start
