# Tasks: 屏幕录制器 (Screen Recorder)

**Input**: Design documents from `/specs/001-screen-recorder/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ipc.md, quickstart.md

**Tests**: 单元测试与人工验收来源于 plan.md 的 Testing 与 quickstart.md 场景(未采用 TDD 先写后实现的严格顺序;测试任务可在实现同步推进)。人工验收任务按 quickstart 场景执行。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root(electron-vite:main / preload / renderer)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Initialize electron-vite project: create `package.json` with pinned dependencies (electron 44.9.0, react 19.3.1, zod 4.6.7, vitest 5.0.5, mediabunny 1.61.6, electron-builder 26.15.3) and `electron.vite.config.ts` with main/preload and four renderer entries (`src/renderer/{mode,settings,overlay,capture}/index.html`), plus `npm run dev/test/lint/typecheck/compile` scripts
- [X] T002 Create TypeScript configuration: `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json` with `strict: true` and path alias `@shared/* → src/shared/*`
- [X] T003 [P] Configure ESLint 10 + typescript-eslint 8.71.2 + Prettier in `eslint.config.mjs` and `.prettierrc`, ignoring build outputs
- [X] T004 [P] Configure Vitest in `vitest.config.ts` (node environment, include `tests/unit/**/*.test.ts`, path aliases)
- [X] T005 [P] Configure electron-builder in `package.json` `build` section: `appId: com.dsh.screen-recorder`, `productName: DSH 屏幕录制器`, `win.target: [nsis, portable]`, `arch: x64`, `asar: true`, icon `build/icon.ico` (256×256)
- [X] T006 Create shared types and IPC channel constants per `contracts/ipc.md` in `src/shared/types.ts` and `src/shared/ipc-channels.ts`
- [X] T007 [P] Create zod schemas for Settings/Region/WindowSource/StartCaptureRequest and IPC payloads in `src/shared/schemas.ts` (region: int, width/height ≥ 16, within primary display DIP bounds)
- [X] T008 [P] Create renderer HTML entry points with CSP meta (`default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'`) in `src/renderer/{mode,settings,overlay,capture}/index.html`, plus shared design tokens in `src/renderer/common/tokens.css` (colors, typography, spacing, radii, button/input states) used by all renderer UIs (FR-022)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T009 [P] Implement settings store in `src/main/services/settingsStore.ts`: default storage `path.join(app.getPath('videos'), 'DSH Screen Recorder')`, default region clamped to primary display, zod validation, atomic write (temp + rename), backup-and-reset on corrupt/unknown version
- [X] T010 [P] Implement region math in `src/main/services/regionMath.ts`: DIP↔physical conversion (`Math.round(x * scaleFactor)`), bounds clamping to display, minimum 16×16 validation
- [X] T011 [P] Implement filename generator in `src/main/services/filename.ts`: `ScreenRecording_YYYYMMDD_HHmmss.mp4` with `_1.._n` collision suffixes
- [X] T012 [P] Create shared MP4 mime candidate list in `src/shared/mime.ts` (`video/mp4;codecs=avc1.42001F` → `video/mp4;codecs=avc1` → `video/mp4`) and a `pickSupportedMime(isSupported)` helper; probing itself runs in the capture renderer because `MediaRecorder` is renderer-only
- [X] T013 [P] Implement MP4 integrity checker in `src/main/services/mp4Probe.ts`: file > 1 KB and ftyp box present in first 32 bytes
- [X] T014 [P] Implement streaming file sink in `src/main/services/fileSink.ts`: createWriteStream append, `write(chunk)`, `finalize()` awaiting `finish`, error propagation
- [X] T015 Implement main process skeleton in `src/main/index.ts`: app lifecycle, `requestSingleInstanceLock`, `Menu.setApplicationMenu(null)`, `will-navigate`/`setWindowOpenHandler` blocking, session permission handler, tray bootstrap
- [X] T016 Implement window factory in `src/main/windows/windowFactory.ts`: secure `webPreferences` (sandbox, contextIsolation, no nodeIntegration), `[SR]` title prefix, hidden/show helpers
- [X] T017 Implement preload API in `src/preload/index.ts`: `contextBridge` exposing `window.dsh` exactly as `contracts/ipc.md`
- [X] T018 Implement IPC handler registry in `src/main/ipc/handlers.ts`: channel registration, zod parsing, sender `webContents.id` allowlist, typed error results
- [X] T019 Implement tray service skeleton in `src/main/tray.ts`: ICO icon load, dynamic menu construction, placeholder handlers for 录屏/设置/停止录制/退出
- [X] T020 Implement recording session state machine in `src/main/services/recordingSession.ts`: states `starting→recording→finalizing→completed|failed`, single-session guard, start/stop/abort orchestration hooks, bytes counter
- [X] T021 Implement crash recovery in `src/main/services/crashRecovery.ts`: write `userData/recording-session.json` marker on start, remove on completion/failure, detect leftover at startup and notify
- [X] T022 Implement notifications wrapper in `src/main/services/notifications.ts`: save-success notification with file path, recovery notice, tray tooltip fallback when notifications unavailable
- [X] T023 Create foundational unit tests in `tests/unit/{settingsStore,regionMath,filename,mime,mp4Probe,recordingSession}.test.ts` covering defaults, validation, conversion, naming, probe order, state transitions

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - 托盘常驻并完成一次全屏录制 (Priority: P1) 🎯 MVP

**Goal**: 托盘入口 + 全屏录制 + 托盘停止 + MP4 保存 + 保存通知的最小可用闭环

**Independent Test**: 在 Windows 10 启动应用 → 托盘右键 → 录屏 → 全屏 → 开始 → 操作屏幕 10 秒 → 托盘停止 → 输出 MP4 可播放(quickstart 场景 A)

### Implementation for User Story 1

- [X] T024 [P] [US1] Implement mode selection dialog UI in `src/renderer/mode/src/App.tsx`: three-mode radio (final delivery enables all three modes), 开始 button styled with shared design tokens and interactive states, close-on-start, error toast area
- [X] T025 [US1] Implement capture window creation and `session.defaultSession.setDisplayMediaRequestHandler` for the primary display source in `src/main/windows/captureWindow.ts` (match `display_id`; fallback first screen source; `backgroundThrottling: false`)
- [X] T026 [US1] Wire `capture:start`/`capture:stop` in `src/main/ipc/handlers.ts` and `src/main/services/recordingSession.ts`: validate session idle, storage writability; pass `mimeCandidates` in `capture:begin` and accept only the mimeType reported by `capture:ready` (else fail `UNSUPPORTED_MP4`); create sink + marker; update tray state
- [X] T027 [US1] Implement fullscreen capture pipeline in `src/renderer/capture/src/main.ts`: `getDisplayMedia` → `<video>` → 30fps canvas → probe `MediaRecorder.isTypeSupported` over candidates (fail with `UNSUPPORTED_MP4` when none), `MediaRecorder` at ~8 Mbps → 1s `dataavailable` chunks via `capture:chunk`, report selected `mimeType` in `capture:ready`; keep `powerSaveBlocker`
- [X] T028 [US1] Handle `capture:chunk`/`capture:finished` in `src/main/ipc/handlers.ts`: append via `fileSink`, finalize, `mp4Probe` validation, session transition, completion notification
- [X] T029 [US1] Implement tray dynamic states in `src/main/tray.ts`: idle menu(录屏/设置/退出) vs recording menu(停止录制/设置/退出); stop triggers `capture:stop`; menu remains responsive during recording
- [X] T030 [US1] Implement save-success notification with output path and tray tooltip update in `src/main/services/notifications.ts` (fallback to tray tooltip when notifications disabled)
- [X] T031 [P] [US1] Create fullscreen session unit tests in `tests/unit/recordingSession.fullscreen.test.ts`: start guards (BUSY/STORAGE_ERROR/UNSUPPORTED_MP4), stop→finalize→completed, finalize failure→failed
- [X] T032 [US1] Manual verification of quickstart scenario A in `specs/001-screen-recorder/quickstart.md`; record pass/fail for SC-001/SC-002/SC-007 in 场景 A

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - 选定区域录制 (Priority: P2)

**Goal**: 屏幕框选矩形区域 + 设置数值区域 + 只输出该区域的 MP4

**Independent Test**: 选择「选定区域」→ 框选约 640×480 → 录制 10 秒 → 停止;输出分辨率等于区域尺寸(quickstart 场景 B)

### Implementation for User Story 2

- [X] T033 [P] [US2] Implement region selection overlay window in `src/main/windows/regionOverlay.ts` and renderer `src/renderer/overlay/src/main.ts`: transparent frameless fullscreen over primary display, dim mask, drag selection, Esc cancel, minimum 16×16 DIP, report `region:selected`/`region:cancelled`
- [X] T034 [US2] Add region editor to mode dialog in `src/renderer/mode/src/RegionEditor.tsx`: x/y/width/height inputs (DIP) prefilled from settings, inline validation errors, 框选 button triggering overlay, live region preview label
- [X] T035 [US2] Wire `region:select` IPC in `src/main/ipc/handlers.ts`: open overlay, resolve rect, validate via `regionMath`, return `{ok, rect}` or cancelled/error
- [X] T036 [US2] Extend capture renderer in `src/renderer/capture/src/main.ts` with region crop path: physical rect from `capture:begin`, draw cropped region to canvas at physical size
- [X] T037 [US2] Wire region `capture:start` in `src/main/services/recordingSession.ts`/`handlers.ts`: convert DIP→physical, enforce bounds, set canvas output size, `INVALID_TARGET` errors
- [X] T038 [P] [US2] Extend region unit tests in `tests/unit/regionMath.test.ts`: DPI scaling cases (100/125/150%), out-of-bounds, min-size rejection
- [X] T039 [US2] Manual verification of quickstart scenario B in `specs/001-screen-recorder/quickstart.md`; record SC-004 result

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - 设置界面与配置持久化 (Priority: P2)

**Goal**: 设置窗口可配置区域范围与存储位置,校验并持久化,重启后生效

**Independent Test**: 修改存储位置与区域 → 重启应用 → 设置保持;下次区域录制使用新值并输出到新目录(quickstart 场景 D)

### Implementation for User Story 3

- [X] T040 [P] [US3] Implement settings window UI in `src/renderer/settings/src/App.tsx`: region numeric form (DIP), storage folder field + browse button, save/cancel, inline field errors, disabled save while invalid, using shared design tokens and control states
- [X] T041 [US3] Wire settings IPC in `src/main/ipc/handlers.ts` and `src/main/services/settingsStore.ts`: `settings:get`, `settings:save` (map zod errors to field errors), `dialog:pick-folder`
- [X] T042 [US3] Use `lastMode` to preselect the mode dialog radio and prefill region editor from settings in `src/renderer/mode/src/App.tsx` and `src/main/ipc/handlers.ts`
- [X] T043 [US3] Enforce effective-time rules in `src/main/services/recordingSession.ts`: storage dir used at next recording, region validated at start, settings window open while recording does not disturb the session
- [X] T044 [P] [US3] Extend settings unit tests in `tests/unit/settingsStore.test.ts`: defaults, atomic write, corrupt/unknown-version reset, invalid region rejection including DPI bounds
- [X] T045 [US3] Manual verification of quickstart scenario D in `specs/001-screen-recorder/quickstart.md`; record SC-005 result

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: User Story 4 - 指定应用窗口录制 (Priority: P3)

**Goal**: 列出可录制窗口并选中其一,录制只包含该窗口;窗口关闭时自动结束

**Independent Test**: 打开记事本 → 选择「指定应用窗口」→ 选中记事本 → 录制输入文字 → 停止;输出只含记事本(quickstart 场景 C/E)

### Implementation for User Story 4

- [X] T046 [P] [US4] Implement window source enumeration and filtering in `src/main/services/captureSources.ts` (pure filter in `src/shared/windowFilter.ts`): `getSources({types:['window'], thumbnailSize:{width:320,height:180}, fetchWindowIcons:true})`, exclude `[SR]`-prefixed own windows, empty titles, system shell windows
- [X] T047 [US4] Add window picker UI to mode dialog in `src/renderer/mode/src/WindowPicker.tsx`: thumbnail list with titles/icons, refresh button, selected state, empty-list fallback message
- [X] T048 [US4] Wire `sources:list-windows` IPC in `src/main/ipc/handlers.ts` returning filtered `WindowSource[]` per `contracts/ipc.md`
- [X] T049 [US4] Extend capture renderer in `src/renderer/capture/src/main.ts` for window mode: capture selected window source, fixed-resolution canvas scaling on window resize, listen track `ended` for auto-stop
- [X] T050 [US4] Wire window `capture:start` and track-ended auto-stop in `src/main/services/recordingSession.ts`/`handlers.ts`: pass sourceId, finalize on ended, notify user, `INVALID_TARGET` when source vanished
- [X] T051 [P] [US4] Create window filter unit tests in `tests/unit/windowFilter.test.ts`: own-window exclusion, empty-title exclusion, system shell exclusion, preserved thumbnails
- [X] T052 [US4] Manual verification of quickstart scenarios C and E in `specs/001-screen-recorder/quickstart.md`; record output window-only content and auto-stop result

**Checkpoint**: All user stories should now be independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T053 Exit-while-recording confirmation (FR-021): show confirm dialog in `src/main/tray.ts`/`src/main/index.ts`; on confirm stop+save+finalize then quit, on cancel continue recording
- [X] T054 Storage validation, disk-space pre-check, and in-recording write-error handling in `src/main/services/recordingSession.ts`/`settingsStore.ts` (FR-012, Edge Cases): `STORAGE_ERROR` dialog; sink write error fails the session with a notification, preserves the partial file, and never leaves a corrupt final file
- [ ] T055 Verify crash recovery end-to-end (quickstart scenario G) in `src/main/services/crashRecovery.ts`: kill process mid-recording → relaunch → recovery notification, marker removed, file preserved
- [X] T056 [P] Security review of `src/main/ipc/handlers.ts`, `src/preload/index.ts`, and renderer HTML CSP: confirm sandbox/contextIsolation/no nodeIntegration across 4 renderers, all IPC payloads zod-validated, sender allowlist enforced, no remote navigation
- [X] T057 Run `npm run lint`, `npm run typecheck`, `npm test` over `src/**` and `tests/**`; fix all failures
- [ ] T058 Build NSIS and portable installers via `package.json` build config into `dist/`; smoke test on Windows 10 and Windows 11 (SC-003) with quickstart scenarios A–C, plus a ≥60-minute long-recording playability spot check (Edge Cases)
- [X] T059 Update results table in `specs/001-screen-recorder/quickstart.md` and verify traceability of SC-001–SC-009 to test outcomes
- [X] T060 [P] Consolidate shared visual system in `src/renderer/common/`: extract reusable Button/NumberField/TextField components from the mode/settings/overlay UIs and apply the tokens defined in T008; verify cross-UI visual consistency (FR-022)
- [X] T061 Add interaction-state feedback (hover/focus/active/disabled) and primary-action emphasis for 开始/停止/保存 in `src/renderer/{mode,settings}/src/**` and `src/renderer/overlay/src/main.ts` (FR-023)
- [ ] T062 Validate DPI scaling (100%/125%/150%/200%) and layout adaptivity per quickstart scenario H in `specs/001-screen-recorder/quickstart.md`; record SC-009 usability rating (FR-024)
- [ ] T063 Run the 5-user usability and performance protocol from quickstart scenario I in `specs/001-screen-recorder/quickstart.md`: ≥4/5 complete a recording unaided (SC-006) and performance rating median ≥4/5 (SC-008); record results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - US1 first (MVP); US2/US3 can start after Foundational but integrate with US1 pieces
  - US4 depends on US1 capture pipeline (T027) and benefits from US2 canvas work
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: After Foundational - no other story dependencies
- **User Story 2 (P2)**: After Foundational + US1 capture pipeline (T027); reuses mode dialog (T024) and overlay
- **User Story 3 (P2)**: After Foundational + mode dialog (T024) for `lastMode` prefill; settings IPC independent
- **User Story 4 (P3)**: After US1 (T027) for capture pipeline; reuses mode dialog (T024)

### Within Each User Story

- Services and pure logic before renderer wiring
- IPC wiring before manual verification
- Unit tests can be written alongside implementation (no strict TDD order)
- Story complete before moving to next priority

### Parallel Opportunities

- Setup: T003, T004, T005, T007, T008 can run in parallel after T001/T002
- Foundational: T009–T014 in parallel; T017/T018/T019/T021/T022 can follow T015/T016
- US1: T024 [P] parallel with T025; T031 [P] after T026–T028
- US2: T033/T038 [P]; US3: T040/T044 [P]; US4: T046/T051 [P]
- Polish: T056 [P] independent of T053–T055; T060 [P] can start once US1 UI exists; T063 runs after T057–T062

---

## Parallel Example: User Story 1

```bash
# UI and capture window modules can start together:
Task: "Implement mode selection dialog UI in src/renderer/mode/src/App.tsx"
Task: "Implement capture window creation + setDisplayMediaRequestHandler in src/main/windows/captureWindow.ts"

# After session wiring, run unit tests in parallel:
Task: "Create fullscreen session unit tests in tests/unit/recordingSession.fullscreen.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: quickstart scenario A on Windows 10
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → validate (MVP: tray + fullscreen + MP4)
3. US2 → validate region recording
4. US3 → validate settings persistence
5. US4 → validate window recording
6. Polish → installer build + Win10/Win11 verification

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Then:
   - Developer A: US1 (capture pipeline)
   - Developer B: US3 (settings UI/IPC)
   - Developer C: US4 window sources (waits for US1 capture pipeline)
3. US2 after US1 canvas pipeline is available

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Tests are aligned with plan.md Testing and quickstart.md scenarios; no strict TDD order required
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
