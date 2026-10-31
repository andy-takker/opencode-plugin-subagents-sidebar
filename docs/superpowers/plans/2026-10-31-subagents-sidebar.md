# OpenCode Subagents Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выпустить готовый к сопровождению публичный TUI-плагин со списком субагентов, тестами, CI и воспроизводимым npm-пакетом.

**Architecture:** Чистая модель строк → контроллер дерева → адаптер публичного OpenCode API → Solid/OpenTUI sidebar. Один ESM-пакет поставляет TS/TSX через `./tui`; транспиляцию выполняет загрузчик OpenCode. Проверяется упакованный tarball, а не только checkout.

**Tech Stack:** OpenCode / `@opencode/plugin` 2.2.5, TypeScript strict, Bun 1.3.13, Solid 1.9.17, OpenTUI 0.8.0, Biome, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-31-subagents-sidebar-design.md` — утверждена пользователем. Этот план заменяет план из глобального каталога plugins.

## Global Constraints

- Репозиторий: `~/workspace/my/opencode-plugin-subagents-sidebar`; все относительные пути ниже относятся к нему.
- Имя проекта и желаемое имя npm-пакета: `opencode-plugin-subagents-sidebar`.
- Лицензия: MIT. Основной язык публичной документации — английский.
- Один пакет, один TUI entrypoint, без серверной части.
- TypeScript strict. Типы интеграции брать из официального API, а не заменять неточными локальными декларациями или `any`.
- Использовать реактивный кеш и события, без постоянного периодического опроса.
- `Running` имеет приоритет над outcome предыдущего исполнения.
- Начальная проверяемая версия — OpenCode v2.2.5; не обещать совместимость с непроверенными будущими версиями.
- Проверки Linux и macOS; поддержку Windows пока не заявлять без проверки.
- Существующие настройки и Orca сохраняются.
- Выпуск первой публичной версии выполняется отдельным явным действием после проверки готовности пакета.
- Основная реализация — в этой сессии; независимое ревью после выполнения задач.

## Review Focus

- Root A → root B при незавершённой загрузке A: поздний ответ не заменяет B (Task 2).
- Более 50 детей и вложенные сессии в другой location: дерево полностью восстанавливается (Tasks 2–3).
- Старый outcome succeeded во время повторного запуска: показывается Running, не Done (Tasks 1–3).
- Удаление во время запроса и dispose во время refresh: удалённые строки не возвращаются, подписки не остаются (Tasks 2–3).
- Чистая установка tarball вне checkout: внутренние импорты разрешаются, нет второй копии renderer (Task 4).

## Файлы и решения поставки

- `src/model.ts`, `src/controller.ts`, `src/opencode-source.ts`, `src/tui.tsx` и colocated `*.test.ts(x)`.
- `package.json`, `bun.lock`, `tsconfig.json`, `biome.json`, `bunfig.toml`, `.gitignore`, `.editorconfig`.
- `test/preload.ts`: только настройка поддерживаемой OpenTUI/Solid трансформации для тестов.
- `scripts/check-package.ts`: создание, распаковка и структурная проверка tarball.
- `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE`, `SECURITY.md`.
- `docs/architecture.md`, `docs/compatibility.md`, `docs/releases.md`.
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/dependabot.yml`.
- `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml`, `.github/pull_request_template.md`.

Поставлять исходники без собственного бандлера: `exports: { "./tui": "./src/tui.tsx" }`.
Allowlist `files` перечисляет четыре runtime-файла поимённо, README и LICENSE;
package.json npm включает автоматически. Тесты/скрипты/docs/node_modules не публикуются.
Не экспортировать фиктивную серверную часть или внутреннюю модель как публичный API.
Начальная версия `0.1.0`; CHANGELOG и README до публикации обозначают её unreleased.

SDK `@opencode/plugin@2.2.5` доступен в npm; опубликованный manifest указывает
OpenTUI 0.8.0 и Solid 1.9.17 в devDependencies, OpenTUI >=0.8.0 в peers.
Для разработки закрепить эти версии и официальные client/theme 2.2.5,
если они требуются прямыми импортами типов. Runtime SDK оформить согласно
официальному примеру как dependency `@opencode/plugin: 2.2.5`;
OpenTUI/Solid — peers `^0.8.0` / `^1.9.17` и точные devDependencies.
Загрузчик использует собственный runtime; его дедупликацию проверить в Task 4.
Версии TypeScript, Biome и типов Bun выбрать доступные и совместимые при
установке, сохранить точно в manifest и lockfile. Не использовать V1 SDK.

### Task 1: Репозиторий, модель и воспроизводимые проверки

**Files:** конфигурация проекта из списка выше; `src/model.ts`, `src/model.test.ts`.

**Interfaces:**
- `SessionRecord = { id: string; parentID?: string; title?: string; time: { created: number; updated: number }; outcome?: "succeeded" | "failed" | "interrupted" }`.
- `LiveStatus = "running" | "idle" | "unknown"`.
- `Row = { id: string; title: string; status: "Running" | "Done" | "Error" | "Interrupted" | "Idle" | "Unknown"; active: boolean }`.
- `buildRows(rootID: string, sessions: readonly SessionRecord[], statuses: ReadonlyMap<string, LiveStatus>): Row[]`.

- [ ] Перечитать инструкции каталога и проверить содержимое; инициализировать `git init -b main` в целевом каталоге. Использовать настроенную Git identity, не придумывать автора. Переместить рабочую сессию в репозиторий. Создать commit утверждённых spec/plan; рабочую ветку `feat/initial-plugin` использовать для реализации.
- [ ] Создать package.json и инструменты проверок: `test` → Bun, `typecheck` → `tsc --noEmit`, `lint` → Biome lint, `format:check` → Biome format без записи, `check` последовательно выполняет эти четыре проверки. `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noEmit`, JSX preserve с OpenTUI types; exact `packageManager: bun@1.3.13`. Игнорировать node_modules, tarball и временные результаты, сохранить lockfile.
- [ ] Написать model tests. В helper `record(id, parentID, created, outcome?)` возвращать SessionRecord. Fixture: root, idle-child(created=1), running-child(2), grandchild(parent=idle-child,3), foreign-root, foreign-child. Assert ids равны `[running-child, idle-child, grandchild]`; переключение root исключает старое дерево, root отсутствует. Дополнительно: одинаковое created сортируется по id, пустой/whitespace title заменяется id, цикл не зависает, дубликаты id не создают две строки.
- [ ] Зафиксировать статусы параметризованной проверкой для одного child:

```ts
test.each([
  ["running", "succeeded", "Running"],
  ["idle", "succeeded", "Done"],
  ["idle", "failed", "Error"],
  ["idle", "interrupted", "Interrupted"],
  ["idle", undefined, "Idle"],
  ["unknown", undefined, "Unknown"],
] as const)("%s / %s → %s", (live, outcome, expected) => {
  const child = record("child", "root", 1, outcome)
  expect(
    buildRows("root", [child], new Map([["child", live]]))[0]?.status,
  ).toBe(expected)
})
```

- [ ] Выполнить `bun test src/model.test.ts` и подтвердить FAIL из-за отсутствующей реализации.
- [ ] Реализовать `buildRows` с visited-набором, фильтрацией потомков и стабильной сортировкой; отсутствующий live status трактовать как unknown. При неизвестном live status не выдавать старый outcome за актуальный.
- [ ] Выполнить `bun run check`; ожидается PASS. Commit `feat: add typed subagent list model`.

### Task 2: Контроллер полного дерева и событий

**Files:** `src/controller.ts`, `src/controller.test.ts`.

**Interfaces:**
- Использует SessionRecord/LiveStatus/Row/buildRows из Task 1.
- `SessionPage = { data: SessionRecord[]; next?: string | null }`.
- `Change = { kind: "refresh"; id: string } | { kind: "delete"; id: string } | { kind: "reconnect" }`.
- `Source = { get(id: string): Promise<SessionRecord>; children(parentID: string, cursor?: string): Promise<SessionPage>; statuses(ids: readonly string[]): Promise<ReadonlyMap<string, LiveStatus>>; subscribe(listener: (change: Change) => void): () => void }`.
- `View = { phase: "loading" | "ready" | "error"; rootID?: string; rows: Row[]; error?: string }`.
- `createController(source: Source, publish: (view: View) => void): { select(sessionID: string): Promise<void>; refresh(): Promise<void>; dispose(): void }`.

- [ ] Написать тесты с управляемыми Promise и fake Source: поиск root по цепочке parentID, 51 ребёнок на двух страницах плюс внук, возвращение в дерево и переход в child сохраняют полный список. Статусы читаются для всех найденных потомков.
- [ ] Добавить тесты гонок: ответ A приходит после выбора B → последний View содержит только B; delete во время чтения → удалённый id отсутствует; dispose до разрешения Promise → новых publish нет и unsubscribe вызван ровно один раз.
- [ ] Добавить тесты refresh: started/succeeded меняют одну строку без дублирования; событие во время чтения инициирует завершающую синхронизацию; reconnect повторно читает дерево; error → phase error, успешный retry → ready. Повторный cursor и цикл предков дают error, а не бесконечный цикл; запросов одновременно не больше четырёх.
- [ ] Выполнить `bun test src/controller.test.ts`; подтвердить FAIL до реализации.
- [ ] Реализовать контроллер: читать предков и страницы детей, использовать bounded очередь обхода с concurrency=4, выбирать строки только после актуального снимка статусов. Номер поколения изолирует select/dispose; объединять события в один refresh с dirty-флагом для событий в полёте. Tombstone удаления сохранять до окончания затронутых запросов. Не использовать таймер периодического опроса.
- [ ] Выполнить `bun run check`; ожидается PASS. Commit `feat: synchronize complete session trees`.

### Task 3: Адаптер OpenCode и интерактивная секция

**Files:** `src/opencode-source.ts`, `src/opencode-source.test.ts`, `src/tui.tsx`, `src/tui.test.tsx`, `test/preload.ts`, `bunfig.toml`.

**Interfaces:**
- `createOpenCodeSource(context: Context): Source`; Context импортировать из опубликованного SDK либо вывести из официальной сигнатуры Plugin.define/setup. Не объявлять замену Context вручную.
- `Sidebar(props: { context: Context; sessionID: string }): JSX.Element` — именованный экспорт для тестов, не package export.
- Default `Plugin.define({ id: "opencode.subagents-sidebar", setup(context) { ... } })` регистрирует append `sidebar.content`.

- [ ] Прочитать типы установленного SDK: session list/get/active, location, ответы, payload lifecycle events, reactive cache, theme tokens, cleanup слота. Зафиксировать соответствие в `docs/architecture.md`. Для чтения дерева не ограничивать запросы текущей directory: субагент может быть перемещён в другую location.
- [ ] Написать контрактные тесты Source с typed fixtures официальных response/event типов: parentID/cursor передаются точно, cursor.next извлекается корректно, metadata нормализуется, активный id возвращает running даже с outcome succeeded. Отсутствие в полном успешном active snapshot означает idle; ошибка получения snapshot не превращается в idle. Создание/обновление/удаление/reconnect преобразуются в Change; message token events не вызывают полного refresh.
- [ ] Добавить тест существующего дерева с child в другой location и тест unsubscribe; выполнить `bun test src/opencode-source.test.ts`, подтвердить FAIL.
- [ ] Реализовать Source через подключённый context.client и публичные cache/events. Получать полный authoritative active snapshot при синхронизации; события актуализируют его, без собственного HTTP-клиента и обхода авторизации. При необходимости синхронизировать cache публичными методами; не читать внутреннее хранилище хоста.
- [ ] Настроить официальный OpenTUI/Solid test renderer и трансформацию TSX; написать TUI tests: `Subagents`, `Loading…`, `No subagents`, `Unable to load subagents`, retry; клик по child вызывает navigate `{type:"session", sessionID:"child"}`. При смене props.sessionID обновляется дерево; dispose очищает контроллер и регистрацию.
- [ ] Добавить проверку 28-колоночного контейнера с длинным Unicode title: контент не расширяет панель, текстовый статус остаётся виден. Выполнить TUI tests и подтвердить FAIL до реализации.
- [ ] Реализовать Sidebar с Solid signal/effect и cleanup, semantic theme tokens, ограничением названия средствами OpenTUI и отдельным местом для статуса. Ошибки показывать компактно, без вывода сырых пользовательских данных. Контроллер принадлежит экземпляру секции, чтобы вкладки не перезаписывали друг друга.
- [ ] Выполнить `bun run check`; ожидается PASS. Commit `feat: render navigable subagents sidebar`.

### Task 4: Проверенный пакет, сопровождение, CI и локальное подключение

**Files:** `scripts/check-package.ts`; package.json scripts/metadata; README/CONTRIBUTING/CHANGELOG/LICENSE/SECURITY; docs; .github files из карты выше; глобальный cli.json.

**Interfaces:**
- `bun run package:check` запускает `bun scripts/check-package.ts`; exit 0 только при успешном pack/extract и валидации.
- `bun run check` и `bun run package:check` — одинаковые точки входа локально и в CI.
- npm export `./tui` должен разрешаться в `src/tui.tsx` внутри tarball.

- [ ] Реализовать package:check: `npm pack --json --ignore-scripts` во временном каталоге, чтение списка и распаковка. Проверить точный allowlist из карты файлов, наличие entrypoint, разрешение относительных импортов из него и отсутствие imports вне пакета. Запретить циклический запуск через prepack. Очищать принадлежащий скрипту temp в finally; не удалять пользовательские файлы.
- [ ] Проверить checker на копии пакета: удалить controller → ненулевой exit; добавить непредусмотренный публикуемый файл → ненулевой exit; исходный пакет → exit 0. После этих проверок добавить `prepack: bun run check`, чтобы обычная упаковка тоже выполняла проверки.
- [ ] Проверить доступность желаемого npm-имени и GitHub identity через read-only инструменты. Для homepage/repository/bugs/SECURITY использовать реальный owner/remote. Если owner неоднозначен, уточнить его, продолжая локальные проверки. Удалённый репозиторий и публикацию не выдавать за созданные до фактического выполнения.
- [ ] Написать английские документы: пример панели из фактического рендера; local install через абсолютный путь каталога в cli.json; будущий npm install пометить unreleased; обновление, отключение, диагностика; contributing команды; архитектура и гонки; матрица проверенной совместимости; MIT с корректным правообладателем, реальный private reporting channel в SECURITY. Добавить issue/PR templates с версией OpenCode, OS, воспроизведением и ожидаемым/фактическим результатом.
- [ ] Создать CI для PR/push main: ubuntu-latest и macos-latest, Bun 1.3.13, `bun install --frozen-lockfile`, `bun run check`, `bun run package:check`; permissions contents:read, concurrency отменяет устаревшие запуски. Actions закрепить полными проверенными commit SHA с комментарием версии. Dependabot еженедельно обновляет npm/Bun и Actions только если текущая версия сервиса поддерживает соответствующий lockfile; поддержку проверить по официальной документации.
- [ ] Подготовить release workflow на опубликованный GitHub release: проверка tag `v${package.version}`, полный набор проверок, публикация того же проверенного tarball через npm trusted publishing, `--access public --provenance`, contents:read/id-token:write только publish job. В docs/releases описать bump, CHANGELOG, tag/release, runtime smoke и первичную настройку npm trust. Проверить текущие требования npm CLI/Node/OIDC по официальным источникам перед фиксацией версий. Первый выпуск остаётся отдельным действием.
- [ ] Создать чистую временную копию отслеживаемых файлов без node_modules; выполнить frozen install, check и package:check. Ошибки воспроизводимости устранить до установки плагина.
- [ ] Распаковать tarball вне checkout и подключить его к отдельному TUI через `OPENCODE_CLI_CONFIG_CONTENT`; проверить, что загружается именно он, работают JSX и навигация, в логах нет ошибок resolver/renderer. Сверить правила host-owned модулей с реальным загрузчиком, исключить вторую runtime-копию. Проверить существующие nested sessions и lifecycle с доступными тестовыми сессиями; непроверенные интерактивные сценарии записать явно.
- [ ] Перечитать глобальный cli.json, сделать уникальную резервную копию в `~/.config/opencode/backups/`, добавить путь рабочего репозитория ровно один раз. Проверить работу рядом с Orca и отсутствие ошибок загрузки; конфигурация перезагружается автоматически, при необходимости `/reload`.
- [ ] Выполнить `bun run check`, `bun run package:check`, `git diff --check`; проверить staged diff на личные пути/данные и случайные файлы. Commit `chore: prepare public package and maintenance workflows`. Не публиковать личные абсолютные пути из рабочих spec/plan как часть npm tarball; примеры публичной документации используют переносимые пути.
- [ ] Выполнить независимое ревью требований и diff; исправления подкрепить релевантными проверками. Итог: перечислить локальные проверки, фактические runtime-проверки, состояние GitHub/npm и оставшиеся шаги первого релиза отдельно. Настроенный CI не называть успешно пройденным на GitHub, пока удалённого запуска не было.

## Источники для исполнения

- https://opencode.ai/v2/docs/build/plugins/cli — TSX export, peers, runtime resolution, slot/context.
- https://opencode.ai/v2/docs/cli/plugins — local/npm TUI-only plugin declaration.
- https://registry.npmjs.org/@opencode%2fplugin/2.2.5 — точные опубликованные metadata и типы SDK.
- Спецификация выше и OpenAPI установленного сервера — формы session/active/list.
