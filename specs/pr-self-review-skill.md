# План: скіл `pr-self-review`

Статус: **план погоджено, код не написано.** Після реалізації тривкі частини
переїжджають у `.claude/skills/pr-self-review/`, ADR 0006 і `.claude/skills/README.md`,
а цей файл видаляється (див. `specs/README.md`).

## 1. Навіщо

Перед відкриттям PR прогнати локальні зміни через ті самі скіли, якими ми рев'юїмо
чужий код, і **не дати агенту відкрити PR**, якщо знайдено хоча б один CRITICAL.
Зараз ці скіли вмикаються лише тоді, коли агент сам вирішить їх завантажити.
Детермінований `pnpm arch:check` існує, але перед PR його ніхто не запускає.

## 2. Тригери

| Тригер | Як спрацьовує |
|---|---|
| Вручну | `/pr-self-review [--base <ref>] [--full] [--fix]` |
| Перед `git push` і `gh pr create` з Claude (у т.ч. `--draft`) | `PreToolUse` hook у `.claude/settings.json`, matcher `Bash`, регулярка по `git push` і `gh pr create` |

**Не блокуються:** `git push --tags`, `git push origin <tag>`, `git push --delete` / `:branch`
(змін коду там немає), а також `gh pr ready` і `gh pr merge`: код до них уже пройшов
гейт на push. `git push` з терміналу поза Claude hook не бачить.

Наслідок гейту на push: WIP-гілку «на бекап» теж не запушиш, поки self-review
не дасть PASS. Коміти в уже відкритий PR перевіряються на кожному push.

Hook **сам скіл не запускає**: це shell-скрипт, LLM він не викликає. Скіл після
прогону пише штамп вердикту, а hook лише перевіряє штамп. Якщо штампа немає або
він застарів, hook повертає `exit 2` з інструкцією «запусти `/pr-self-review`».
Агент запускає скіл і після PASS повторює ту саму команду.

## 3. Ключові рішення

### 3.1. Блокування: Claude hook + штамп

Гейт блокує агента, який відкриває PR. Заборонити merge на GitHub локально
неможливо: це дав би тільки required CI check, і він поза скоупом. Відкинуті
варіанти (git `pre-push`, headless `claude -p` у pre-push, CI required check)
разом із trade-offs потрапляють у розділ «Alternatives considered» ADR 0006.

**Штамп:** `.devdigest/self-review/<diffHash>.json` (у `.gitignore`):

```json
{ "diffHash": "<sha256 of git diff <merge-base>...HEAD>", "base": "<merge-base sha>",
  "head": "<sha>", "verdict": "PASS | BLOCK", "criticals": 0, "at": "<iso>",
  "lenses": { "<lens>": "ok | failed" }, "cost": { "ms": 0, "tokens": 0 } }
```

Ключ свіжості: `diffHash`, а не SHA. Rebase чи amend без зміни коду не змушують
проганяти рев'ю заново. Будь-яка зміна коду робить штамп недійсним. Hook пропускає
дію тільки тоді, коли штамп для поточного `diffHash` існує і має `verdict = PASS`.

### 3.2. Що вважається «відкритими змінами»

Тільки **закомічені зміни цієї гілки**: `git diff <merge-base origin/main>...HEAD`.
Staged, unstaged і untracked у рев'ю не потрапляють: push і PR їх теж не несуть.
Перед цим `git fetch origin main`. Інакше merge-base застаріває і в diff
потрапляють чужі коміти. Base перевизначається через `--base`.

**Передумова: чисте робоче дерево в пакетах з diff.** Детерміновані перевірки
(typecheck, тести) запускаються на файлах з диска. Незакомічена правка чи
untracked `.ts` у `src/` дали б вердикт не для того коду, що піде в push.
Тому якщо `git status --porcelain` показує зміни в `client/`, `server/` або
`reviewer-core/`, скіл не стартує і просить закомітити або відкласти їх
(WIP-комітом, не bare `git stash`). Зміни поза пакетами (docs, scratch) не заважають.

**Виключаємо з LLM-рев'ю** (детерміновані перевірки їх усе одно бачать):
видалені файли, `pnpm-lock.yaml`, `server/src/db/migrations/**`, `*.md` поза
`.claude/skills/**`, бінарні файли.

### 3.3. Маршрутизація: файл → лінза → скіли

| Glob | Лінза | Скіли (blocking) |
|---|---|---|
| `client/src/**/*.{ts,tsx}` | `client-arch` | `frontend-architecture`, `react-best-practices`, `next-best-practices` |
| `client/**/*.test.{ts,tsx}` | `client-tests` | `react-testing-library` |
| `server/src/modules/**`, `server/src/platform/**`, `server/src/adapters/**` | `server-arch` | `onion-architecture` |
| routes, `server/src/**/repository*`, `server/src/db/**`, файли з `from 'zod'` | `server-tech` | `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design` (для `db/schema/**`), `zod` |
| `reviewer-core/src/**` | `core-purity` | власний чекліст: жодних I/O-імпортів (fs, net, http, db, octokit, SDK провайдерів), лише injected `LLMProvider`, правила з `reviewer-core/README.md` |
| routes, auth, adapters, secrets, `client/src/lib/api.ts`, рендер HTML/markdown на клієнті | `security` | `security` (server **і** client) |

**Advisory-лінзи, тільки з `--full`, ніколи не CRITICAL:** `typescript-expert`,
`vercel:react-best-practices` (perf).

**Не включаємо:** `mermaid-diagram`, `engineering-insights` (не рев'ю-скіли).
Вбудовані `/code-review` і `/security-review` теж ні: вони перетинаються з нашими
лінзами і дають другий, неузгоджений набір severity.

### 3.4. Детерміновані перевірки (перед LLM, дешеві, авторитетні)

| Перевірка | Коли | Провал = |
|---|---|---|
| `cd <pkg> && pnpm typecheck` | для кожного пакета з diff | CRITICAL |
| `cd server && pnpm arch:check` | є зміни в `server/src` | CRITICAL (тільки нові порушення, baseline ігнорується) |
| `pnpm exec vitest run --exclude '**/*.it.test.ts'` | для кожного пакета з diff | CRITICAL |
| vendored shared: змінено лише одну з `server/src/vendor/shared` / `client/src/vendor/shared` | завжди | CRITICAL |
| ручна правка `server/src/db/migrations/**` без зміни `db/schema/**` | завжди | CRITICAL |
| diff додає записи в `.dependency-cruiser-known-violations.json` | завжди | CRITICAL |
| секрети в diff (`sk-`, `ghp_`, `-----BEGIN`) | завжди | CRITICAL |

`*.it.test.ts` не запускаємо: вони потребують Docker/Postgres, а гейт має
працювати без них. Про пропуск звіт пише явно.

### 3.5. Нормалізація severity

Скіли мають **різні шкали**. Без спільних правил «хоча б один critical»
перетворюється на лотерею.

| Скіл | Власна шкала | Як мапимо |
|---|---|---|
| `onion-architecture`, `frontend-architecture`, `react-best-practices` | CRITICAL / HIGH / MEDIUM для findings | 1:1 |
| `security` | severity **і** confidence | CRITICAL тільки при confidence HIGH; інакше максимум HIGH |
| `zod` | CRITICAL означає **пріоритет категорії правил**, а не тяжкість знахідки | максимум HIGH, крім `parse` без обробки на межі довіри |
| `core-purity` | власний чекліст | I/O-імпорт у `reviewer-core/src` = CRITICAL |
| `fastify`, `drizzle`, `postgresql`, `next`, `react-testing-library` | шкали немає | максимум HIGH |

**Єдине визначення CRITICAL у self-review:** провал детермінованої перевірки (3.4)
або знахідка лінзи з рівнем CRITICAL за мапою вище, яку підтвердив skeptic (3.6).

### 3.6. Виконання

1. Зібрати diff і маршрут (3.2–3.3). Порожній diff → PASS, штамп, кінець.
   Тільки docs/specs → детерміновані перевірки, лінзи пропускаються.
2. **Інкрементальність:** findings кешуються по хешу вмісту файлу
   (`.devdigest/self-review/cache/`). Лінза проганяється лише по файлах, чий хеш
   змінився з попереднього прогону. Кеш інвалідується, коли змінюється `SKILL.md`
   будь-якого підключеного скіла.
3. Детерміновані перевірки (3.4) паралельно.
4. Лінзи паралельно, один саб-агент (`sonnet`) на лінзу. **Контекст лінзи:**
   hunk, повний файл, `AGENTS.md` та `INSIGHTS.md` пакета, скіли лінзи.
   Вихід: жорстка JSON-схема `{id, file, line, lens, skill, rule, severity, confidence, evidence, fix}`.
5. **Fail-closed:** timeout або невалідний JSON → один retry, далі BLOCK зі
   статусом «лінза `<name>` не відпрацювала». Лінза, що впала, не дає PASS.
6. **Skeptic на `opus`** для кожного LLM-CRITICAL: незалежна спроба спростувати
   знахідку за кодом навколо. Не підтвердив → знахідка стає HIGH, а запис іде в
   `.devdigest/self-review/refuted.jsonl` (`{rule, skill, file, reason, at}`).
7. Оркестратор дедуплікує (той самий `file:line` з кількох лінз), пише звіт і штамп.

### 3.7. Вихід

Звіт українською; назви скілів, правил і коду залишаються англійською.

```
Self-review: BLOCK (2 critical, 5 high, 3 medium)  base=origin/main@abc123  files=14
Час: 94 с · лінзи: 5 (1 з кешу) · токени: ~180k

| Sev | file:line | Лінза / скіл / перевірка | Що не так | Fix |
|-----|-----------|--------------------------|-----------|-----|
...
Пропущено: server/*.it.test.ts (Docker), 3 lockfile/migration файли, advisory-лінзи (без --full)
```

Рядок «Пропущено» обов'язковий, щоб будь-яке обрізання було видно. Diff понад
40 файлів або 3k рядків перевіряється повністю, але з попередженням про вартість.

**При PASS** скіл генерує блок для опису PR («Self-review: лінзи, HIGH/MEDIUM,
що пропущено»). Агент підставляє його в `gh pr create --body`.

### 3.8. Waiver немає

CRITICAL абсолютний: його прибирає тільки зміна коду або спростування skeptic-ом.
Щоб жорсткість не перетворилась на шум, є три запобіжники: LLM блокує лише
через мапу 3.5, кожен LLM-CRITICAL проходить skeptic на `opus`, а журнал
`refuted.jsonl` показує правила, які варто уточнити.

### 3.9. Режим `--fix`

Для HIGH/MEDIUM з однозначним `fix` скіл застосовує правку і проганяє повторно
(інкрементально, 3.6.2). CRITICAL тільки пропонує: людина має бачити, що змінилось
у блокуючих місцях.

## 4. Структура файлів

```
.claude/skills/pr-self-review/
  SKILL.md                    # тригери, кроки 3.6, severity-мапа 3.5, формат 3.7
  references/routing.md       # таблиця 3.3 (одне джерело правди для globs)
  references/lens-prompts.md  # контракти саб-агентів + чекліст core-purity
  scripts/collect-diff.sh     # 3.2 → JSON зі списком файлів, маршрутом і diffHash
  scripts/deterministic.sh    # 3.4
  scripts/gate-hook.sh        # PreToolUse: перевірка штампа для git push / gh pr create
  evals/                      # golden-фікстури (розділ 6)
.claude/settings.json         # hooks.PreToolUse → gate-hook.sh
.gitignore                    # .devdigest/self-review/
docs/adr/0006-local-self-review-gate.md
.claude/skills/README.md      # рядок у каталозі
```

Перевикористати severity-розділи наявних скілів: `onion-architecture/SKILL.md:116`,
`frontend-architecture/SKILL.md:61`, `react-best-practices/SKILL.md:18`,
`security/SKILL.md:251`; скрипт `arch:check` з `server/package.json`.

## 5. Edge cases

- Rebase або amend без зміни коду: `diffHash` той самий, штамп лишається валідним.
- Ланцюжки (`git add . && git commit -m … && git push`): регулярка ловить підрядок,
  а не лише початок команди. Hook бачить команду до її виконання, тобто до коміту,
  а `diffHash` рахується від HEAD. Тому ланцюжок коміт+push завжди блокується, коли
  коміт додає код. Агент має спершу закомітити, потім прогнати скіл, потім пушити.
- Новий коміт після PASS, що змінює код, змінює `diffHash` → hook блокує. Порожній
  коміт або зміна лише commit message → `diffHash` той самий, PASS.
- `git push` не з поточної гілки (`git push origin other:other`) → hook блокує з
  проханням запушити з checkout цієї гілки: штамп описує лише поточне робоче дерево.
- `git push --force-with-lease` після rebase без змін коду: `diffHash` той самий, PASS.
- Push на `main` напряму: гейт працює так само (diff від merge-base порожній → PASS),
  окремий захист `main` поза скоупом.
- Немає мережі для `git fetch` → використати локальний `origin/main` і написати про це.
- Змінився скіл, що бере участь у рев'ю → кеш findings недійсний (3.6.2).

## 6. Верифікація скіла

- **Golden-фікстури** у `evals/`: route з Drizzle-запитом (onion CRITICAL),
  `useEffect` для derived state (react CRITICAL), зміна однієї копії vendored
  shared, I/O-імпорт у `reviewer-core`, плюс один чистий патч. Очікування: чотири
  BLOCK з потрібною знахідкою і 0 CRITICAL на чистому патчі. Проганяти після
  кожної зміни будь-якого з підключених скілів.
- Агент викликає `git push` і `gh pr create` без штампа: hook блокує, агент
  запускає скіл, після PASS команда проходить.
- `git push --tags` і `git push --delete` проходять без перевірки.
- Новий коміт з правкою після PASS: `diffHash` не збігається, hook знову блокує.
- Незакомічена правка після PASS: hook пропускає push (вона не пушиться).
- Брудне дерево в `server/`: скіл відмовляється стартувати з інструкцією.
- Замір часу і токенів на реальній гілці `l02-labwork`, повний прогін і інкрементальний.

## 7. Рішення (інтерв'ю 2026-09-28)

| Питання | Рішення |
|---|---|
| Механізм блокування | Claude hook + штамп |
| Тригер | `git push` (крім тегів і `--delete`) і `gh pr create` (доповнено 2026-09-28) |
| Немає штампа | hook блокує, агент сам запускає скіл |
| Ключ штампа | `diffHash` |
| Скоуп diff | тільки закомічені зміни гілки (`<merge-base>...HEAD`), чисте дерево в пакетах |
| Збій LLM API | `--deterministic-only` не дозволяємо: PASS тільки з усіма лінзами |
| Waiver | немає |
| Unit-тести | блокуючі |
| reviewer-core | окрема лінза `core-purity` |
| Security | блокує на server і client (CRITICAL + confidence HIGH) |
| LLM-CRITICAL | skeptic на `opus` для кожного |
| Advisory-лінзи | тільки з `--full` |
| Мова звіту | українська |

Наслідок: поки LLM API недоступний, ні `git push`, ні `gh pr create` з агента не
пройдуть (3.6.5). Це свідомий вибір: гейт, який можна пропустити на збої, перестає
бути гейтом. Відкритих питань немає.
