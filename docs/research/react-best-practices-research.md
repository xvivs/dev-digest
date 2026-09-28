# React frontend best practices: research

**Дата:** 2026-09-28
**Мета:** сировина для перебудови скіла `react-best-practices` через `/skill-creator`. Скіл має відповідати на питання «де що лежить і як розбито», а не лише «які антипатерни в хуках».
**Метод:** 6 паралельних research-агентів (структура, декомпозиція, шари логіки, константи/утиліти/naming, фактчек наявного скіла, локальний аудит скілів і коду `client/`). Ключові твердження оркестратор перевірив повторно по першоджерелах (позначка ✔ у тексті).
**Посилання:** `[n]` ведуть на розділ [Джерела](#12-джерела). `[Lx]` означає локальний файл репозиторію.

---

## Зміст

0. [TL;DR](#0-tldr)
1. [Контекст стеку і розподіл відповідальності між скілами](#1-контекст-стеку-і-розподіл-відповідальності-між-скілами)
2. [Структура проєкту: де лежать компоненти](#2-структура-проєкту-де-лежать-компоненти)
3. [Декомпозиція компонентів](#3-декомпозиція-компонентів)
4. [Шари логіки: domain, core, use-case, UI](#4-шари-логіки-domain-core-use-case-ui)
5. [Константи, утиліти, типи, naming](#5-константи-утиліти-типи-naming)
6. [Стан, хуки, ефекти, мемоізація (перевірене ядро)](#6-стан-хуки-ефекти-мемоізація-перевірене-ядро)
7. [Аудит наявного скіла: що зберегти, що виправити](#7-аудит-наявного-скіла-що-зберегти-що-виправити)
8. [Прогалини: чого бракує в наявному скілі](#8-прогалини-чого-бракує-в-наявному-скілі)
9. [Спірні питання (без консенсусу)](#9-спірні-питання-без-консенсусу)
10. [Пропозиція структури нового скіла](#10-пропозиція-структури-нового-скіла)
11. [Обмеження дослідження](#11-обмеження-дослідження)
12. [Джерела](#12-джерела)

---

## 0. TL;DR

1. **Колокація спочатку, виносимо лише за другого реального споживача.** Це правило однаково працює для компонентів, констант, утиліт і типів. На ньому сходяться Kent C. Dodds, Bulletproof React, FSD і Wieruch [1][4][11][12][24].
2. **Імпорти йдуть в один бік:** `shared → entities → features → pages/app`. Фіча не імпортує іншу фічу, а компонування відбувається рівнем вище. Папки без enforcement (лінт-правила) дають лише видимість архітектури [1][3][6][15][16].
3. **Barrel-файли:** неглибокий явний `index.ts` на межі модуля можна, глибокий `export *` по всьому застосунку ні. TkDodo заміряв: 11k → 3.5k модулів (−68%) після прибирання barrel-файлів у Next-проєкті ✔ [5][14].
4. **Числові ліміти («200 рядків», «5–7 пропсів») не мають жодного джерела.** Компонент розбивають за симптомами: різні відповідальності, заплутаний стан, кілька причин для змін, conflict-hotspot у git [17][23].
5. **Container/Presentational як обов'язковий поділ застарів.** Абрамов сам відмовився від нього у 2019: логіку від відображення тепер відділяють custom hooks ✔ [28][29].
6. **Бізнес-логіка живе в чистих TS-функціях без React.** Оркестрація сидить у custom hooks, інфраструктура (http, i18n, auth) в `lib/` чи провайдерах, UI-стан у компоненті [37][43][46].
7. **Server state і client state мають різну природу.** Дані з API живуть у TanStack Query (фабрики ключів + `queryOptions`), їх не копіюють у `useState`. Чернетка форми, засіяна з сервера, це client state [38]–[42].
8. **У наявному скілі з 43 правил 20 KEEP, 8 REVISE, 1 DROP, 6 STACK-SPECIFIC.** Критичні виправлення: інструкцію про React Compiler, правила `useMemo`/`useCallback` (там більше легітимних кейсів), Container/Presentational (не CRITICAL), два баги в прикладах ✔ [58][59][66].
9. **Найбільша прогалина:** організація коду описана 6 рядками. Немає Server/Client-меж, React 19 Actions, `useOptimistic`, `use()`, `useTransition` [61][66]–[71].
10. **Стек-невідповідності:** скіл написаний під Vite + axios + react-router + Tailwind. `client/` натомість використовує Next 15 App Router, TanStack Query поверх `apiFetch` і `styles.ts` з inline `CSSProperties` за ADR 0003 [L1][L3].

---

## 1. Контекст стеку і розподіл відповідальності між скілами

### 1.1 Реальний стек `client/` (факти з коду)

| Аспект | Факт | Джерело |
|---|---|---|
| Фреймворк | Next 15 App Router, React 19 | `client/README.md` |
| Мережа | Лише `src/lib/api.ts` (`apiFetch`) викликає `fetch`; помилки нормалізуються в `ApiError` зі `status` | [L1], [L2] |
| Дані | Хуки TanStack Query у `src/lib/hooks/{core,reviews,agents,trace,repo-intel}.ts`, реекспорт з `hooks/index.ts` | [L1], [L2] |
| Анатомія фічі | `app/**/_components/<Name>/` з `<Name>.tsx`, `index.ts`, опційно `<Name>.test.tsx`, `constants.ts`, `helpers.ts`, `styles.ts`; допускається вкладений `_components/` | [L1], [L2] |
| Спільні leaf-компоненти | `src/components/<name>/`, якщо їх використовують 1–2 екрани; примітив для >1 фічі йде в `@devdigest/ui` | [L1] |
| Стилі | Колокований `styles.ts` з об'єктами `CSSProperties` поверх CSS-змінних; Tailwind лише в `globals.css` і точково | [L3], `AgentCard/styles.ts` |
| Копірайт | Лише через `next-intl`, `messages/<locale>/<namespace>.json` | [L1] |
| Тести | vitest + jsdom, `fetch` замоканий; `@testing-library/user-event` і `msw` не встановлені | [L4]:98 |

> Правило «шарів» з `component-anatomy.md` [L2] (дослівно): *"Nothing skips a layer. A component never calls `apiFetch`; a hook never renders."* Це локальний еквівалент unidirectional-правила з розділу 2.

### 1.2 Хто яку тему має «володіти» (щоб не дублювати)

| Тема | `react-best-practices` (новий) | `next-best-practices` | `vercel:react-best-practices` (плагін) | `typescript-expert` |
|---|---|---|---|---|
| Структура папок, анатомія компонента | **власник** | лише file conventions роутингу | — | частково (colocated types) |
| Декомпозиція, composition API | **власник** | — | `rerender-no-inline-components` | — |
| Шари логіки, server vs client state | **власник** | data-patterns (RSC / Server Actions / Route Handlers) | — | — |
| Server/Client boundary | коротке правило + посилання | **власник** (`rsc-boundaries.md`) | `server-*` | — |
| Re-render / bundle perf | коротке правило + посилання | `bundling.md` | **власник** (64 rule-файли) | — |
| Naming, type-safety | React-специфічне naming | — | — | **власник** |

**Висновок:** новий скіл відповідає за архітектуру й організацію коду React-фронтенду. Server/Client-межі та perf він лише згадує й посилається на відповідні скіли, не переписуючи їх. Плагінний `vercel:react-best-practices` у правилі `client-swr-dedup` радить SWR замість TanStack Query, а його `validate` підштовхує до Tailwind/shadcn (спрацьовує лише на імпорти styled-components/emotion/MUI/Chakra, тому на `styles.ts` цього репо мовчить). Про це варто попередити в новому скілі (див. §9).

---

## 2. Структура проєкту: де лежать компоненти

### 2.1 Консенсусні правила

| # | Правило | Чому | Коли не застосовувати | Src |
|---|---|---|---|---|
| S1 | **Колокуй спочатку, структуруй потім.** Тест, стилі, хелпери, константи лежать поруч із компонентом, а не в паралельних деревах `__tests__/`, `styles/` | Що змінюється разом, те й лежить разом. Так видно відсутні тести, і немає дрейфу між файлом і його двійником | Код справді cross-cutting (дизайн-токени, форматер дати на 5 фіч) | [11][10] |
| S2 | **Групуй за фічею/доменом**, коли застосунок переріс кілька компонентів. Групування за типом (`components/`, `hooks/`) як головна вісь не масштабується | Зміна «checkout» інакше зачіпає 5 верхніх папок | Атоми UI (Button, Input) та інфраструктура лишаються type-grouped у `shared/` | [1][2][12] |
| S3 | **Імпорти в один бік:** `shared → entities → features → widgets/pages → app`. Нижній шар не імпортує верхній, сусіди на одному шарі не імпортують одне одного | Інакше feature-based деградує в клубок залежностей | Правило діє завжди. Enforcement може бути м'яким (code review) у маленькій команді | [1][3][12] |
| S4 | **Кожна фіча має public API:** один вхідний `index.ts` з явними іменованими експортами. Ніяких глибоких імпортів у чужі internals | Внутрішній рефакторинг не ламає споживачів | Не плутати з `export *`: FSD прямо називає wildcard антипатерном | [5][2] |
| S5 | **Next App Router: `app/` безпечний для колокації.** Сервиться лише `page`/`route`. `_folder` прибирає папку з роутингу, `(group)` групує без впливу на URL | Next свідомо зробив колокацію безпечною | Next не диктує, що обрати: «поза `app/`», «всередині `app/`» чи «split by route». Головне, щоб команда робила однаково | [7] |
| S6 | **Naming файлів: один стиль на весь проєкт.** Kebab чи PascalCase менш важливо, ніж однаковість | Непослідовність коштує часу на пошук і рев'ю | — | [12][13] |
| S7 | **Не більше ~2 рівнів вкладеності під доменом** (`features/project/components/`), глибше лише на реальних архітектурних швах | Глибока вкладеність вбиває discoverability і ламає відносні імпорти | Верхній скафолд (domain → feature → segment), бо кожен рівень кодує окрему вісь | [12] |
| S8 | **Промоція за другим споживачем:** util/компонент, потрібний двом маршрутам чи фічам, піднімається на шар вище | Інакше маршрути лізуть у приватні папки одне одного | — | [12][L1] |

### 2.2 Barrel-файли: примирення двох таборів

| Табір | Позиція | Src |
|---|---|---|
| Проти | Barrel змушує завантажити весь граф модулів, провокує циклічні імпорти і блокує `optimizePackageImports`. Замір TkDodo (Next-проєкт, shared-пакет): «pages that were loading over 11k modules, which took 5-10 seconds to start-up» → «about 3.5k modules - a reduction of 68%» ✔ | [14][8][1] |
| За | Курований `index.ts` на фічу чи компонент є механізмом public API. Прибравши його, ми втрачаємо інструмент інкапсуляції | [13][5] |

**Правило-примирення:** *shallow + explicit + на свідомій межі = ок; deep + wildcard + скрізь = антипатерн.*
У `client/` кожен `_components/<Name>/index.ts` реекспортує один компонент, тож це shallow-варіант, і він коректний [L2]. `lib/hooks/index.ts` агрегує 5 доменних файлів: це вже широкий barrel, за ростом варто стежити.

```ts
// ❌ deep wildcard barrel
// features/discussions/index.ts
export * from './api';
export * from './components';
export * from './hooks';   // 40+ символів транзитивно

// ✅ shallow explicit public API
// features/auth/index.ts
export { LoginPage } from './ui/LoginPage';
export { RegisterPage } from './ui/RegisterPage';
```

### 2.3 Референсні layout-и

**Малий проєкт (colocation-first):**
```
src/
  components/
    FileViewer/
      FileViewer.tsx
      FileViewer.test.tsx
      helpers.ts
      index.ts
  hooks/
  utils/
```

**Середній/великий (Bulletproof React):** [1]
```
src/
  app/            # routes, providers, root
  components/     # лише справді cross-feature UI
  config/         # env, глобальні константи
  features/
    comments/
      api/  components/  hooks/  stores/  types/  utils/
      index.ts    # curated public API
  hooks/  lib/  stores/  types/  utils/   # shared
```

**Next App Router + FSD-шари:** [2][7]
```
src/
  app/
    (marketing)/page.tsx
    dashboard/
      page.tsx
      _components/      # не роутиться
  features/billing/{ui,api,model}/index.ts
  entities/user/
  shared/{ui,lib,api,config}/
```

**Цей репозиторій (`client/`):** [L1][L2]
```
src/
  app/
    repos/[repoId]/pulls/
      page.tsx                # thin: params + composition
      constants.ts helpers.ts styles.ts   # спільне для компонентів маршруту
      _components/
        PRRow/{PRRow.tsx,index.ts,constants.ts,helpers.ts,styles.ts,PRRow.test.tsx}
        RunTraceDrawer/
          _components/ToolCallRow/...     # вкладені частини фічі
  components/<name>/          # leaf для 1–2 екранів
  components/app-shell/       # cross-cutting chrome
  lib/api.ts                  # єдиний fetch
  lib/hooks/<domain>.ts       # TanStack Query
  vendor/ui/                  # design system (@devdigest/ui), редагований
  vendor/shared/              # контракти, НЕ чіпати без server/
```

Трирівнева промоція: **компонент → маршрут → `src/components/` → `@devdigest/ui`**. Кожен крок робиться, коли з'являється реальний новий споживач.

### 2.4 Good vs bad

```ts
// ❌ cross-feature import
// features/discussions/api.ts
import { CommentForm } from '../comments/components/CommentForm';

// ✅ композиція на рівні сторінки
// app/posts/[id]/page.tsx
import { CommentForm } from '@/features/comments';
import { DiscussionList } from '@/features/discussions';
```

```ts
// ❌ entity тягнеться вгору до feature
// entities/user/model/user.ts
import { session } from '@/features/auth/model/session';

// ✅ feature спирається вниз на entity
// features/auth/model/session.ts
import type { User } from '@/entities/user';
```

```
// ❌ паралельне дерево тестів
src/__tests__/Button.test.tsx
src/components/Button.tsx

// ✅ колокація
src/components/Button/Button.tsx
src/components/Button/Button.test.tsx
```

```
// ❌ один маршрут імпортує з приватної папки іншого
app/dashboard/billing/_lib/formatCurrency.ts  ← імпортують ще 3 маршрути

// ✅ промоція після другого споживача
shared/lib/format-currency.ts
```

### 2.5 Enforcement

- `eslint-plugin-boundaries` задає типи елементів і політики «хто від кого може залежати» [15].
- `import/no-restricted-paths` Bulletproof React використовує для `shared → features → app` та заборони feature→feature [1].
- `steiger` лінтить FSD: `fsd/forbidden-imports`, `fsd/no-public-api-sidestep` [16].

Trade-off: налаштування і крива навчання проти дрейфу, бо без лінтера правило розмивається за кілька PR, щойно в кодбейсі працює >2 людей [6].

---

## 3. Декомпозиція компонентів

### 3.1 Консенсусні правила

| # | Правило | Чому / коли ні | Src |
|---|---|---|---|
| C1 | **Межі компонентів відповідають моделі даних**, далі уточнюються за відчуттям | react.dev називає це judgment call, а не правилом | [17] |
| C2 | **Одна відповідальність.** «A component should ideally only be concerned with one thing» | На цьому тримаються інші правила | [17] |
| C3 | **Чистота рендеру:** не мутувати props/state/зовнішні змінні. Side effects йдуть в обробники або `useEffect` | Завдяки чистоті виносити шматки безпечно | [18][62] |
| C4 | **Props є API компонента.** Масовий `{...props}` прокидується «у кожному іншому компоненті» як smell | Ховає реальний контракт | [19] |
| C5 | **`children`/слоти замість вибуху content-props** для wrapper-компонентів | Не стосується ортогональних налаштувань (`size`, `disabled`, `variant`) | [19][34] |
| C6 | **Стан живе в найближчому спільному власнику**, а не в корені | Single source of truth | [20] |
| C7 | **Controlled/uncontrolled це спектр.** Controlled потрібен, коли батько координує кілька інстансів | — | [20] |
| C8 | **Ідентичність стану = тип + позиція в дереві.** Винесення чи інлайн може непомітно скинути або зберегти стан | — | [21] |
| C9 | **`key` для навмисного скидання стану**, а не дублікат компонента ✔ | `<Profile key={userId} />` | [21][44] |
| C10 | **Ніколи не оголошувати компонент усередині іншого компонента** | Новий тип на кожен рендер, стан під ним скидається | [21] |
| C11 | **Move state down / lift content up до `memo()`** | Дешевше і прозоріше за мемоізацію | [32] |
| C12 | **Compound components**, коли споживач компонує, переставляє чи пропускає частини (tabs, menu, select) | Ціна: неявний контракт через context | [26][27] |
| C13 | **Inversion of control:** замість нового boolean-пропа дати споживачеві хук або callback, щоб рішення ухвалював він | API перестає рости вшир | [25] |
| C14 | **`'use client'` тримати в листках дерева.** «If a component can be a Server Component, it should be» | Окрема вісь декомпозиції, специфічна для RSC | [36] |
| C15 | **`asChild`/Slot:** поведінку чіпляють на елемент споживача без зайвого wrapper-DOM | Ціль має приймати `ref` і прокидувати props | [33] |
| C16 | **Дублювання дешевше за хибну абстракцію** (Sandi Metz / AHA) | Абстракцію вводять, коли спільне «кричить» | [24][34] |

### 3.2 Чекліст сигналів для розбиття (усі з джерелами)

- Компонент робить більше однієї речі і продовжує рости [17].
- Відчутна (не передбачувана) проблема за Kent C. Dodds: perf, логіку важко перевикористати, заплутане володіння станом, тестується лише інтеграційно, git-конфлікти на файлі, неможливо вставити сторонній компонент, розкидана імперативна lifecycle-логіка. Його ж правило: *«When you experience one of the problems above, that's when you break your component into multiple smaller components. NOT BEFORE.»* [23]
- Кілька content-пропсів (`titleText`, `titleIcon`, `bodyContent`) замість `children` [19].
- Для взаємовиключних станів (pending / empty / loaded) нагромаджуються `?:` і `&&`. Тоді варто перейти на early-return гілки зі спільним `Layout` [34].
- Швидкозмінний стан впливає лише на піддерево. Таке піддерево виносять [32].
- Компонент обростає boolean-пропсами. Їх замінюють на `variant` union, named variants або compound [35].
- Лише листку потрібна інтерактивність. Його виносять у Client Component [36].

### 3.3 Застаріле / фольклор

| Порада | Вердикт | Обґрунтування | Src |
|---|---|---|---|
| «Розбивай після 200 рядків», «max 5–7 пропсів» | **Фольклор** | Жодне з 20 джерел не дає числового порогу. KCD прямо обирає підхід «за симптомами» | [17][23] |
| Container/Presentational як обов'язковий поділ | **Legacy** | Абрамов, 2019 ✔: *«I don't suggest splitting your components like this anymore… Hooks let me do the same thing without an arbitrary division.»* patterns.dev: «Modern React strongly favors Hooks over container components» | [28][29] |
| Render props для шерингу логіки | **Звужено** | «In a 2025 codebase, render props are no longer the default tool for sharing logic — custom hooks are». Лишається для контролю розмітки (DnD, анімації, headless) | [30] |
| HOC | **Legacy, живий на межах** | Error boundaries, інтеграції бібліотек. Для загальної логіки використовують хуки | [31] |
| DRY-as-dogma | **Спірно** | AHA / «prefer duplication over the wrong abstraction» | [24] |

### 3.4 Good vs bad

```tsx
// ❌ content-props explosion
function Card({ photo, photoCaption, aboutTitle, aboutText }: CardProps) { /* ... */ }

// ✅ slot
function Card({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>;
}
```

```tsx
// ❌ boolean trap: 8 комбінацій, валідні 3
<Button primary secondary danger>Submit</Button>
// ✅ одна вісь варіативності
<Button variant="primary">Submit</Button>
```

```tsx
// ❌ вкладене оголошення: input втрачає фокус і стан на кожному рендері
function Form() {
  function Field() { const [v, setV] = useState(''); return <input value={v} onChange={e => setV(e.target.value)} />; }
  return <Field />;
}
// ✅ оголошення на рівні модуля
function Field() { /* ... */ }
function Form() { return <Field />; }
```

```tsx
// ❌ conditional soup
<Layout>
  {isPending ? <Skeleton /> : null}
  {!data && !isPending ? <EmptyScreen /> : null}
  {data ? data.items.map(renderItem) : null}
</Layout>

// ✅ early return + спільний Layout (дублювання тут свідоме) [34]
if (isPending) return <Layout><Skeleton /></Layout>;
if (!data) return <Layout><EmptyScreen /></Layout>;
return <Layout>{data.items.map(item => <Item key={item.id} item={item} />)}</Layout>;
```

```tsx
// ❌ memo як латка
<input value={color} onChange={...} />
<ExpensiveTree />            // обгорнули в memo, щоб не рендерився

// ✅ move state down + lift content up [32]
function ColorPicker({ children }: { children: React.ReactNode }) {
  const [color, setColor] = useState('red');
  return <div style={{ color }}><input value={color} onChange={e => setColor(e.target.value)} />{children}</div>;
}
// <ColorPicker><ExpensiveTree /></ColorPicker>
```

```tsx
// ❌ монолітний select
<Select options={opts} showSearch showClearButton />
// ✅ compound
<Select>
  <Select.Search />
  <Select.Option value="1">a</Select.Option>
  <Select.ClearButton />
</Select>
```

```tsx
// ❌ скидання стану через useEffect
useEffect(() => { setComment(''); }, [userId]);
// ✅ key [44] ✔
<Profile userId={userId} key={userId} />
```

```tsx
// ❌ 'use client' на всю сторінку заради однієї кнопки
'use client';
export default function Page() { /* весь layout + <LikeButton/> */ }
// ✅ клієнтський лише листок
export default async function Page() { const post = await getPost(); return <Article post={post}><LikeButton id={post.id} /></Article>; }
```

---

## 4. Шари логіки: domain, core, use-case, UI

### 4.1 Модель шарів

| Шар | Містить | Де лежить | Може імпортувати | Не може | Src |
|---|---|---|---|---|---|
| **Domain / business rules** | Чисті функції: розрахунки, валідація, політики, трансформації. Без React, без I/O | `domain/`, `models/`, FSD `entities/*/model`; у `client/` це `helpers.ts` | інший domain, generic utils | React, хуки, fetch, browser API | [37][46] |
| **Core / infrastructure** | HTTP-клієнт, auth, логування, i18n, analytics, feature flags, DI через Context | `lib/`, `services/`, FSD `shared/api`, `shared/lib`, `app/providers`; у `client/` це `lib/api.ts`, `lib/providers.tsx` | domain-типи | UI-компоненти, use-case хуки | [1][37] |
| **Server state** | queries, mutations, фабрики ключів, `queryOptions` | `features/*/api`, FSD `entities/*/api`; у `client/` це `lib/hooks/<domain>.ts` | core http, domain (DTO→model) | рендер-тіла компонентів напряму | [38][40][41] |
| **Application / use-case** | Custom hooks, що оркеструють server-state, domain-функції і реакцію на подію | `features/*/hooks`, `features/*/model` | domain, core, server-state | internals конкретних адаптерів | [37][43] |
| **UI state** | open/closed, hover, активна вкладка, чернетка форми | тіло компонента (`useState`/`useReducer`), URL | — | — | [45] |
| **View** | Приймає props, рендерить. Без бізнес-правил, без fetch | `components/`, FSD `*/ui`, `_components/<Name>/<Name>.tsx` | use-case хуки, domain (лише для форматування), UI kit | core-адаптери, raw fetch | [37] |

> «Layering is not "folders", it's dependency discipline» [6]. Папка `domain/`, куди можна імпортувати React, нічого не дає.

### 4.2 Консенсусні правила

| # | Правило | Чому | Коли ні | Src |
|---|---|---|---|---|
| L1 | Domain-логіка це plain TS без React | Тестується без рендера, переживає зміну фреймворку | Однорядкове `disabled = !isOnline` | [37][46] |
| L2 | **Не копіювати server data в `useState`** | Дані застаріють; ламаються refetch та invalidation | Чернетка форми, засіяна з сервера, є client state, і це нормально | [39][42] |
| L3 | Ключі запитів збирають ієрархічні фабрики, колоковані з фічею | Точкова інвалідація, без опечаток | Одиничний one-off запит | [40] |
| L4 | `queryOptions()` об'єднує key, fn і options | Повертає excess-property check; один об'єкт для `useQuery`, `prefetchQuery`, `getQueryData` | — | [41] |
| L5 | **Mutations і side effects викликаються в обробниках подій, не в `useEffect`** ✔ | «Use Effects only for code that should run *because* the component was displayed» | Синхронізація з зовнішньою системою | [44] |
| L6 | Custom hooks шерять **логіку, не стан**: кожен виклик має свій стан | — | Не робити lifecycle-обгорток (`useMount`) | [43] |
| L7 | DTO парситься в domain-форму **на кордоні** (zod у `queryFn` чи `api.ts`) | Решта застосунку залежить від форми, яку контролюєте ви | Внутрішній endpoint зі спільним контрактом, уже валідованим (як `@devdigest/shared`) | [37][46][56] |
| L8 | Thin client не потребує повного clean-architecture | Bespoyasov: для thin client це «overkill». Мінімум: винести domain і дотримуватись напряму залежностей | — | [46][47] |

### 4.3 Server state vs client state

| Питання | Server state (TanStack Query) | Client state |
|---|---|---|
| Власник істини | сервер, клієнт тримає кеш | клієнт |
| Може застаріти «за спиною»? | так (інша вкладка, інший юзер) | ні |
| Потрібні refetch / dedup / retry? | так, заради цього бібліотека і є | ні |
| Приклад | список ревʼю, профіль | модалка відкрита, активна вкладка, `?sort=` |
| Інструмент | `useQuery(xQueries.detail(id))` | `useState` → lift → Context/URL → store лише для великого синхронного client state |
| Антипатерн | Redux-slice, завантажений один раз на старті | fetch у `useEffect` + `setState` |

TanStack Query прямо каже, що він не замінює client state, окремий store потрібен лише для «a massive amount of synchronous client-only state» [42]. KCD класифікує react-query як *cache management*, а не state management [45].

### 4.4 Good vs bad

```tsx
// ❌ бізнес-правило в JSX
function OrderSummary({ items, country }: Props) {
  const tax = country === 'US' ? sum(items) * 0.0825 : country === 'UA' ? sum(items) * 0.2 : 0;
  return <div>Total: {sum(items) + tax}</div>;
}

// ✅ domain.ts: чиста функція, unit-тест без рендера
export function calculateTax(items: LineItem[], country: CountryCode): number {
  const subtotal = items.reduce((s, i) => s + i.price, 0);
  return subtotal * (TAX_RATES[country] ?? 0);   // дужки обов'язкові: `a * b ?? 0` ≠ `a * (b ?? 0)`
}
```

```tsx
// ❌ ручний кеш
const [user, setUser] = useState<User | null>(null);
useEffect(() => { fetchUser(id).then(setUser); }, [id]);   // race, немає retry/dedup/staleness

// ✅ server state
const { data: user } = useQuery(userQueries.detail(id));
```

```ts
// ❌ розкидані ключі
useQuery({ queryKey: ['todo', id], queryFn: () => fetchTodo(id) });
queryClient.invalidateQueries({ queryKey: ['todos'] });   // промах: 'todo' ≠ 'todos'

// ✅ фабрика + queryOptions [40][41]
export const todoQueries = {
  all: () => ['todos'] as const,
  detail: (id: number) => queryOptions({
    queryKey: [...todoQueries.all(), 'detail', id] as const,
    queryFn: () => fetchTodo(id),
    staleTime: 5_000,           // опечатка `stallTime` тепер дасть помилку компіляції
  }),
};
```

```tsx
// ❌ мутація з ефекту
useEffect(() => { if (product.isInCart) notify(`Added ${product.name}`); }, [product]);
// ✅ з обробника [44]
function handleBuyClick() { addToCart(product); notify(`Added ${product.name}`); }
```

```ts
// ❌ сирий DTO по всьому застосунку
return (await res.json()) as any;

// ✅ парсинг на кордоні
const UserDto = z.object({ id: z.string(), full_name: z.string() });
const toUser = (dto: z.infer<typeof UserDto>): User => ({ id: dto.id, name: dto.full_name });
export const fetchUser = async (id: string) => toUser(UserDto.parse(await apiFetch(`/users/${id}`)));
```

```ts
// ❌ lifecycle-обгортка ховає намір
function useMount(fn: () => void) { useEffect(() => { fn(); }, []); }
// ✅ хук, названий за призначенням [43]
function useChatRoom({ roomId }: { roomId: string }) {
  useEffect(() => { const c = connect(roomId); return () => c.disconnect(); }, [roomId]);
}
```

**Для `client/`:** шари вже задані [L2]: `page.tsx` (thin) → `_components/<Name>/` (view + `helpers.ts` як domain) → `lib/hooks/*` (server state) → `lib/api.ts` (core). Скіл має описати саме цю мапу, а не вводити FSD-назви.

---

## 5. Константи, утиліти, типи, naming

### 5.1 Таблиця рішень «що куди»

| Артефакт | Куди | Критерій | Src |
|---|---|---|---|
| Константа одного компонента | верх файлу або колокований `constants.ts` | один споживач | [11][L2] |
| Константа ≥2 фіч | `config/` (Bulletproof) / `shared/config` (FSD) | cross-cutting | [1][4] |
| Env-змінні | один `env.ts` зі схемою, парситься при завантаженні; `NEXT_PUBLIC_*` окремою схемою | fail-fast, серверний секрет не потрапить у клієнтську схему | [54] |
| Фіксований набір значень | `as const` об'єкт (+ `satisfies`) замість `enum` | erasable, tree-shakable, семантика звичайного JS | [49][50][57] |
| Хелпер з одним використанням | у тому ж файлі, **поза тілом компонента** | AHA | [24] |
| Хелпер ≥2 в одній фічі | `helpers.ts` / `utils/` фічі | дублювання вже реальне | [1][55] |
| Хелпер між фічами | `utils/` чи `shared/lib`, **розбитий за доменом** (`date/`, `money/`) | уникаємо «dunghill»-звалища | [1][53] |
| Обгортка над сторонньою бібліотекою | `lib/` (не `utils/`) | «reusable libraries preconfigured for the application» | [1][4] |
| Тип одного файлу | поруч | — | [11] |
| Тип ≥2 модулів | `types/` чи `model` шару `shared` | крос-модульний контракт | [1][4] |
| Тип зі схемою | `z.infer<typeof Schema>`, колокований зі схемою ✔ | одне джерело для runtime і compile-time; для `.transform()` є `z.input`/`z.output` | [56] |
| Нереактивний об'єкт/функція | module scope | стабільна референція, менше deps | [52] |

### 5.2 Правила

- **Колокація спочатку, промоція за другим споживачем.** Виняток: env і інфраструктурний конфіг, які cross-cutting з першого дня [11][1].
- **AHA / rule of three.** Виняток: security-критичну логіку (auth, permission gates) не дублюють навіть один раз, бо дрейф там перетворюється на баг безпеки [24].
- **Утиліти ділять за доменом, а не за хронологією.** Плаский `utils.ts` на 1500 рядків і є «Dunghill anti-pattern» [53].
- **`lib/` ≠ `utils/`.** У `lib` лежать налаштовані обгортки, в `utils` чисті функції без залежностей. Чіткого тесту межі не дає жодне джерело (див. §9) [1][4].
- **`CONST_CASE` лише для справжніх module-level констант.** Локальний `const` у функції пишеться `lowerCamelCase` [48].
- **Сегменти називають за призначенням, а не за суттю.** FSD не радить `components`/`hooks`/`types` як імена сегментів у слайсі [4].
- **`satisfies`** перевіряє, що вираз відповідає типу, **не змінюючи виведеного типу** ✔ [57]. Саме так `client/` пише `styles.ts`: `export const s = { body: { padding: 24 } satisfies CSSProperties, card: (active: boolean): CSSProperties => ({...}) }`. Кожна властивість перевіряється окремо, а динамічні стилі оформлені як типізовані функції.

### 5.3 Naming

| Ідентифікатор | Конвенція | Src |
|---|---|---|
| Компоненти, типи, інтерфейси | `PascalCase` | [48][51] |
| Змінні, функції, props | `camelCase` | [48][51] |
| Module-level константи | `CONST_CASE` | [48] |
| Файл компонента | `PascalCase.tsx` (Airbnb) / snake/kebab (Google). Головне однаковість | [48][51][12] |
| Prop, значення якого є компонентом | `PascalCase` (`Icon={X}`) | [51] |
| Хуки `useX` | обов'язково, на цьому тримається лінтер Rules of Hooks | [43][62] |
| `isX`/`hasX`, `handleX`/`onX` | **де-факто конвенція екосистеми**, дослівно не кодифікована в Google/Airbnb | — |

### 5.4 Good vs bad

```ts
// ❌ enum: numeric auto-increment, runtime-артефакт
enum Direction { Up, Down }
// ✅
export const Direction = { Up: 'UP', Down: 'DOWN' } as const;
export type Direction = (typeof Direction)[keyof typeof Direction];
```

```ts
// ❌ raw env
const apiUrl = process.env.NEXT_PUBLIC_API_URL;          // string | undefined, падає глибоко в застосунку
// ✅ fail-fast
export const clientEnv = z.object({ NEXT_PUBLIC_API_URL: z.string().url() }).parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,  // Next інлайнить лише прямі звернення до NEXT_PUBLIC_*
});
```
> ⚠ Нюанс, якого немає в джерелі [54]: у клієнтському бандлі Next підставляє лише **статичні** звернення `process.env.NEXT_PUBLIC_X`. `schema.parse(process.env)` у браузері отримає порожній об'єкт. Тому поля передаються явно, як у прикладі вище.

```ts
// ❌ об'єкт у тілі компонента: нова референція на кожен рендер
function ChatRoom() { const options = { roomId: 'music' }; useEffect(() => connect(options), [options]); }
// ✅ module scope [52]
const OPTIONS = { roomId: 'music' } as const;
function ChatRoom() { useEffect(() => connect(OPTIONS), []); }
```

```
// ❌ звалище
src/utils.ts                // formatDate, slugify, retry, parseMoney, ...
// ✅ за доменом
src/utils/date/formatDate.ts
src/utils/money/parseMoney.ts
```

```
// ❌ wrapper над бібліотекою поруч із чистими хелперами
src/utils/httpClient.ts
// ✅
src/lib/httpClient.ts
src/utils/string/slugify.ts
```

```ts
// ❌ CONST_CASE для локального значення
function computeTotal() { const MAX_ITEMS = 100; }
// ✅
const MAX_ITEMS = 100;
```

```ts
// ❌ ручний дубль DTO-типу поруч зі схемою
const User = z.object({ id: z.string() });
interface UserT { id: string }            // розійдеться при першій зміні
// ✅
type User = z.infer<typeof User>;
```

---

## 6. Стан, хуки, ефекти, мемоізація (перевірене ядро)

Цей розділ зберігає сильну частину наявного скіла, **уточнену** за фактчеком.

### 6.1 Derive, don't store (KEEP, найважливіше правило)

- Похідні значення не зберігаються в `useState` і не синхронізуються через `useEffect`, їх обчислюють під час рендеру [44].
- `client/` дійшов до цього сам: «Derive-don't-store applies to list indices too… clamps on read» [L4]:80-83.
- **Коли `useMemo`:** «unless you're creating or looping over thousands of objects, it's probably not expensive». Мемоізувати має сенс, якщо `console.time` показує **≥1ms** ✔ [44].

### 6.2 `useEffect` (KEEP)

Перед кожним ефектом питаємо: *яку зовнішню систему синхронізуємо?* Похідний стан, обробка подій і ланцюжки ефектів сюди не належать. Залежності мають бути повними, cleanup для підписок і таймерів обов'язковий [44].

### 6.3 Мемоізація (REVISE)

| Хук | Легітимні кейси (react.dev ✔) | Src |
|---|---|---|
| `useMemo` | (1) дорогий розрахунок з рідко змінними deps; (2) значення йде в `memo`-дитину; (3) значення є залежністю іншого хука | [58] |
| `useCallback` | (1) передається в `memo`-дитину; (2) є залежністю іншого хука (`useEffect`, інший `useCallback`); (3) **функції, які повертає custom hook**: «it's recommended to wrap any functions that it returns into `useCallback`» | [59] |
| React Compiler 1.0 (7 жовтня 2025) ✔ | Новий код: «relying on the compiler for memoization and using `useMemo`/`useCallback` where needed». **Наявний код:** «leaving existing memoization in place (removing it can change compilation output) or carefully testing before removing» | [66] |

`memo` не має сенсу, якщо props щоразу нові (inline-об'єкти чи функції) [60].

### 6.4 Контекст і стан (KEEP)

- Context служить для DI (theme, auth, i18n), а не для глобального стану. Зміна контексту перерендерює всіх споживачів, тому контексти ділять за призначенням [60].
- Кілька пов'язаних `useState` об'єднують у `useReducer`. Один `status` enum краще за `isSending`/`isSent`/`isError` [22].
- Стан фільтрів і пагінації тримають в URL. У Next це `useSearchParams` (або `nuqs`), а не react-router.

### 6.5 Решта правил, підтверджених як KEEP

- **Render factories:** `renderX()` не є компонентом. Правило «Never call component functions directly» ✔ [62].
- **Keys:** індекс не годиться для змінюваних списків, `Math.random()` теж не можна. `key` ставлять на `Fragment` [63].
- **`{count && …}`** рендерить `0`. Потрібно `count > 0 &&` або тернарний оператор.
- **Error boundaries** не ловлять помилки в обробниках, async і SSR [64]. **Але** в React 19 помилки з `startTransition` Actions потрапляють до найближчого boundary [64].
- **a11y:** `aria-label` для icon-only кнопок, `aria-describedby`/`aria-invalid` для помилок, `aria-live`. Для модалки APG вимагає також `role="dialog"`, `aria-modal="true"` і `aria-labelledby` [65].
- **`ref` як prop** у React 19. `forwardRef` поки працює, його deprecation оголошено на майбутнє [61].

---

## 7. Аудит наявного скіла: що зберегти, що виправити

**Файли:** `.claude/skills/react-best-practices/SKILL.md` (175 рядків), `examples.md` (369 рядків). Скіл має severity-теги і good/bad до кожного правила, але **жодного джерела**.

### 7.1 Вердикти по секціях

| Секція / правило | Вердикт | Дія |
|---|---|---|
| Components pure; логіка в hooks/helpers; хелпери поза тілом | KEEP | перенести |
| Container/Presentational (CRITICAL) | REVISE | «винось fetching у хук, рендер тримай чистим», без CRITICAL [29] |
| Max 200 рядків / 5–7 props | **DROP** | замінити чеклістом §3.2 |
| One component per file | KEEP | MEDIUM |
| Composition: lift content up / push state down / children | KEEP | + джерело [32] |
| Derive, Don't Store | KEEP | + поріг 1ms [44] |
| State colocation; Context = DI; useReducer | KEEP | — |
| URL state | KEEP | переписати під `next/navigation` |
| useEffect rules | KEEP | — |
| useMemo «лише дорогі» | REVISE | 3 кейси [58] |
| useCallback «лише для memo-дитини» | REVISE | 3 кейси, включно з поверненням з хука [59] |
| Render factories | KEEP | — |
| Inline creation in JSX | REVISE | успадковує вузькість мемоізації |
| Over-engineering (premature abstraction, wrappers) | KEEP | + AHA [24] |
| «ALL data fetching in custom hooks» | STACK-SPECIFIC | розділити на Server Component (`await` у компоненті) і Client (хук) |
| `useApiQuery`/`useApiMutation` | STACK-SPECIFIC | цих хуків у репо немає; замінити на `lib/hooks/*` |
| Tailwind section | STACK-SPECIFIC / **конфлікт з ADR 0003** | або прибрати, або «дотримуйся стилю проєкту; у `client/` це `styles.ts`» |
| Error boundaries: `resetKeys={[location.pathname]}` | STACK-SPECIFIC | `usePathname()` з `next/navigation` |
| Error boundaries + React 19 Actions | REVISE | додати нюанс [64] |
| Keys, conditional rendering | KEEP | — |
| a11y: modal | REVISE | + `role="dialog"`, `aria-modal`, `aria-labelledby` [65] |
| `React.lazy` + Suspense | REVISE | `next/dynamic` як основний API в Next [9] |
| Vite `manualChunks` | STACK-SPECIFIC → DROP для Next | — |
| Static paths у `lazy()` | KEEP | стосується і `next/dynamic` |
| Axios section | STACK-SPECIFIC | переписати: `queryFn` отримує `signal`, скасування робить TanStack Query |
| React 19 `ref` as prop | KEEP | — |
| «With Compiler, avoid memo unless measured» | **REVISE (невірно)** | цитата [66] |
| Code Organization (6 рядків) | KEEP, але **розширити до повного розділу** | §2 + §5 |

**Підсумок:** 20 KEEP · 8 REVISE · 1 DROP · 6 STACK-SPECIFIC (з 43 рядків фактчеку).

### 7.2 Баги в `examples.md` (перевірено)

1. **Derive, Don't Store** (рядки 20–32). Коментар каже «memoize only if expensive», а GOOD-код безумовно огортає `filter` у `useMemo`. Файл суперечить власному правилу. Виправлення: GOOD це просто `const filtered = blogs.filter(...)`, а `useMemo` винести в окремий приклад «якщо профайлер показав ≥1ms».
2. **State Colocation** (рядки 147–151). `const debouncedTerm = useDebounce(...)` ніде не використовується, це мертвий код.
3. **Memoization.** Немає жодного GOOD-прикладу для `useCallback`, тож читач не бачить, як виглядає коректне використання.

### 7.3 Що обов'язково зберегти (не втратити при оптимізації)

Good/bad пари з `examples.md`, актуальні після виправлень:

| Приклад | Статус |
|---|---|
| fullName через useState+useEffect → inline | зберегти |
| filteredBlogs | виправити (див. 7.2) |
| over-memoizing `greeting` / `setOpen` | зберегти + додати GOOD `useCallback` |
| `renderBlogCard()` → `<BlogCard />` | зберегти |
| inline array → module const | зберегти |
| inline style → Tailwind | **замінити** на `styles.ts` / стиль проєкту |
| Container/Presenter split | переписати як «hook + pure render» |
| State colocation (SearchSection) | виправити debounce |
| fetch у компоненті → хук | зберегти, адаптувати до TanStack Query |
| useEffect для submit → handler | зберегти |
| Nested ternaries → early returns | зберегти |
| Error boundary з resetKeys | адаптувати (`usePathname`) |
| index/random key, Fragment key | зберегти |
| `count &&` | зберегти |
| a11y icon button, aria-describedby, aria-live | зберегти + modal attrs |
| React.lazy routes | замінити на `next/dynamic` |
| Axios AbortController | замінити на `queryFn({ signal })` |
| forwardRef → ref prop | зберегти |

Severity-теги (CRITICAL / HIGH / MEDIUM) теж зберегти: їх використовують агенти-рев'юери.

---

## 8. Прогалини: чого бракує в наявному скілі

| Тема | Чому важливо | Src |
|---|---|---|
| **Організація коду** (папки, анатомія компонента, промоція, barrel-файли, межі імпортів) | Основний запит цього дослідження; зараз 6 рядків | §2, §5 |
| **Шари логіки** (domain / core / server state / UI) | Немає зовсім | §4 |
| **Server vs Client Components** | Усі правила про хуки й fetching зараз написані ніби лише для Client | [36], `next-best-practices/rsc-boundaries.md` |
| **React 19 Actions, `useActionState`, `<form action>`** | Стандарт для мутацій з pending/error станом | [61][67] |
| `useOptimistic` | Optimistic UI | [68] |
| `use()` | Promise/context у рендері, інтеграція з Suspense | [69] |
| `useTransition` / `useDeferredValue` | Неблокувальний UI (таби, пошук) | [70] |
| `useSyncExternalStore` | Підписка на зовнішній store без tearing | [71] |
| `key` для навмисного reset | Рев'юер зараз може прийняти це за баг «нестабільного ключа» | [21][44] |
| Розміщення Suspense boundaries | Одна верхня межа дає waterfall і блокує весь екран | [69] |
| Server state: фабрики ключів, `queryOptions`, «не копіювати в useState» | Ядро роботи з даними в цьому стеку | [38]–[41] |
| Env-валідація | Fail-fast, нюанс інлайну `NEXT_PUBLIC_*` | [54] |

---

## 9. Спірні питання (без консенсусу)

| Питання | Позиція A | Позиція B | Рекомендація для скіла |
|---|---|---|---|
| Головна вісь групування | за фічею (Bulletproof, FSD, Wieruch) [1][2][12] | за типом (Comeau: фічі «дрейфують» від коду) [13] | залежить від масштабу; для `client/` вісь задає маршрут (`_components` біля route) |
| Barrel-файли | проти (TkDodo, Bulletproof) [14][1] | за як public API (Comeau, FSD) [13][5] | shallow + explicit так, deep + wildcard ні |
| `enum` vs `as const` | `as const` (TS Handbook, Pocock) [49][50] | `enum` дозволений, заборонений лише `const enum` (Google) [48] | `as const` за замовчуванням |
| Named vs default exports | лише named (Google) [48] | default вимагає Next (`page`, `layout`) | named скрізь, крім файлів, що вимагають default |
| `lib/` vs `utils/` | окремі сегменти [1][4] | на практиці їх часто зливають | задати критерій: є зовнішня залежність чи side-effect → `lib` |
| Жорсткість enforcement меж | лінтер з першого дня [15][16] | конвенція + рев'ю [12][13] | лінтер, коли >2 контриб'юторів |
| Стилі | Tailwind (наявний скіл, плагін Vercel) | inline `CSSProperties` + CSS vars (ADR 0003) [L3] | **скіл не нав'язує styling-бібліотеку**, а каже «дотримуйся ADR проєкту» |
| Плагін `vercel:react-best-practices` | 64 perf-правила, machine-checkable | правило `client-swr-dedup` радить SWR; `validate` реагує лише на імпорти styled-components/emotion/MUI/Chakra (на `styles.ts` з `CSSProperties` не спрацьовує, перевірено) | посилатися на perf-правила; `client-swr-dedup` читати як «dedup через TanStack Query» |

---

## 10. Пропозиція структури нового скіла

### 10.1 Варіанти

| Варіант | Плюси | Мінуси |
|---|---|---|
| **A. Один скіл, SKILL.md-роутер + reference-файли** (як `next-best-practices`) | один trigger у description, progressive disclosure, мінімальне context load | роутер треба тримати в актуальному стані |
| B. Два скіли: `react-architecture` (структура, шари) + `react-best-practices` (хуки, стан) | вужчі тригери | два description завжди в контексті; межа між ними розмита (стан сидить і там, і там) |
| C. Загальний скіл + окремий `client/`-специфічний адендум | універсальність, скіл можна перенести в інший репо (напр. Nebula) | ризик розсинхрону двох джерел |

**Рекомендація: A**, з одним файлом `project-conventions.md` усередині, який локалізує загальні правила під `client/` і посилається на `client/AGENTS.md` та `component-anatomy.md`, а не копіює їх. Причина: `writing-great-skills` вимагає single source of truth і попереджає, що кожен додатковий model-invoked description коштує context load [L5].

### 10.2 Скелет

```
react-best-practices/
  SKILL.md                 # ≤150 рядків: severity, короткі правила-вказівники, "read X when Y"
  structure.md             # §2: папки, анатомія, промоція, barrel-файли, межі імпортів
  components.md            # §3: декомпозиція, чекліст, composition patterns
  logic-layers.md          # §4: шари, server vs client state, DTO-кордон
  constants-utils-naming.md# §5
  state-hooks.md           # §6: derive, effects, мемоізація, React 19
  examples.md              # усі good/bad пари (виправлені, §7.3)
  project-conventions.md   # мапа на client/: _components, lib/hooks, api.ts, styles.ts, next-intl
  references.md            # джерела з §12
```

### 10.3 Відкриті питання для `/skill-creator`

1. Скіл має бути універсальним (переносимим у `asknebula_spa`) чи прив'язаним до DevDigest? Від відповіді залежить, чи `project-conventions.md` лежить усередині скіла, чи в `client/`.
2. Мова скіла: англійська (як усі скіли в `.claude/skills/`) чи українська?
3. Чи оновлювати `.claude/skills/README.md` (каталог) і `react-testing-library` (там той самий стек-дрейф: msw, user-event, MemoryRouter), чи це окрема задача?
4. Чи додавати `eslint-plugin-boundaries` у `client/`? Тоді потрібен ADR, це вже рішення поза скілом.

---

## 11. Обмеження дослідження

- **Не відкрились або не читались:** Khalil Stemmler (немає робочого URL); «Dirty Architecture» Бєспоясова; Kong To «Atomic Hexagonal Architecture»; пост FSD «5 Frontend Architectures»; bulletproof-react.dev (DNS, використано GitHub-версію); окремий пост Total TypeScript про `as const` + `satisfies` (404, замість нього використано TS 4.9 release notes [57]); сторінка про magic numbers (404, тема не покрита першоджерелом); `react.dev/reference/react/forwardRef` (статус deprecation підтверджено через React 19 blog [61]); довідки react.dev для Suspense і `useFormStatus`.
- **medium.com повернув 403.** Цитату Абрамова [29] взято з дзеркала readmedium.com. Два незалежні агенти навели однаковий текст.
- **`vercel:react-best-practices`:** прочитано лише індекс, 64 rule-файли окремо не аналізувались.
- **Naming `isX`/`hasX`, `handleX`/`onX`** подано як конвенцію екосистеми без першоджерела.
- Приклад із `calculateTax` в агентському звіті мав баг пріоритету операторів (`a * b ?? 0`). Тут він виправлений.

---

## 12. Джерела

### Структура проєкту
1. Bulletproof React, Project Structure: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
2. Feature-Sliced Design, Overview: https://feature-sliced.design/docs/get-started/overview
3. FSD, Layers reference: https://feature-sliced.design/docs/reference/layers
4. FSD, Slices and Segments: https://feature-sliced.design/docs/reference/slices-segments
5. FSD, Public API: https://feature-sliced.design/docs/reference/public-api
6. FSD blog, Layered Architecture: Still Relevant for Frontend?: https://feature-sliced.design/blog/frontend-layered-architecture
7. Next.js, Project structure and organization: https://nextjs.org/docs/app/getting-started/project-structure
8. Next.js, Package bundling (`optimizePackageImports`): https://nextjs.org/docs/app/guides/package-bundling
9. Next.js, Lazy loading: https://nextjs.org/docs/app/guides/lazy-loading
10. React (legacy), File Structure FAQ: https://legacy.reactjs.org/docs/faq-structure.html
11. Kent C. Dodds, Colocation: https://kentcdodds.com/blog/colocation
12. Robin Wieruch, React Folder Structure: https://www.robinwieruch.de/react-folder-structure/
13. Josh W. Comeau, Delightful React File/Directory Structure: https://www.joshwcomeau.com/react/file-structure/
14. TkDodo, Please Stop Using Barrel Files (2024-07-26): https://tkdodo.eu/blog/please-stop-using-barrel-files ✔
15. eslint-plugin-boundaries: https://github.com/javierbrea/eslint-plugin-boundaries
16. Steiger (FSD linter): https://github.com/feature-sliced/steiger

### Декомпозиція компонентів
17. react.dev, Thinking in React: https://react.dev/learn/thinking-in-react
18. react.dev, Keeping Components Pure: https://react.dev/learn/keeping-components-pure
19. react.dev, Passing Props to a Component: https://react.dev/learn/passing-props-to-a-component
20. react.dev, Sharing State Between Components: https://react.dev/learn/sharing-state-between-components
21. react.dev, Preserving and Resetting State: https://react.dev/learn/preserving-and-resetting-state
22. react.dev, Choosing the State Structure: https://react.dev/learn/choosing-the-state-structure
23. Kent C. Dodds, When to break up a component into multiple components: https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components
24. Kent C. Dodds, AHA Programming: https://kentcdodds.com/blog/aha-programming
25. Kent C. Dodds, Inversion of Control: https://kentcdodds.com/blog/inversion-of-control
26. Kent C. Dodds, React Hooks: Compound Components: https://kentcdodds.com/blog/compound-components-with-react-hooks
27. patterns.dev, Compound Pattern: https://www.patterns.dev/react/compound-pattern/
28. patterns.dev, Container/Presentational Pattern: https://www.patterns.dev/react/presentational-container-pattern/
29. Dan Abramov, Presentational and Container Components (update 2019): https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0
30. patterns.dev, Render Props Pattern: https://www.patterns.dev/react/render-props-pattern/
31. patterns.dev, HOC Pattern: https://www.patterns.dev/react/hoc-pattern/
32. Dan Abramov, Before You memo(): https://overreacted.io/before-you-memo/
33. Radix Primitives, Composition (`asChild`): https://www.radix-ui.com/primitives/docs/guides/composition
34. TkDodo, Component Composition is great btw (2024-09-21): https://tkdodo.eu/blog/component-composition-is-great-btw
35. Spice Factory, How to avoid the Boolean Trap: https://spicefactory.co/blog/how-to-avoid-the-boolean-trap-when-designing-react-components/
36. Josh W. Comeau, Making Sense of React Server Components: https://www.joshwcomeau.com/react/server-components/

### Шари логіки і стан
37. Juntao Qiu (martinfowler.com), Modularizing React Applications with Established UI Patterns: https://martinfowler.com/articles/modularizing-react-apps.html
38. TkDodo, Practical React Query: https://tkdodo.eu/blog/practical-react-query
39. TkDodo, React Query as a State Manager: https://tkdodo.eu/blog/react-query-as-a-state-manager
40. TkDodo, Effective React Query Keys: https://tkdodo.eu/blog/effective-react-query-keys
41. TkDodo, The Query Options API: https://tkdodo.eu/blog/the-query-options-api
42. TanStack Query, Does this replace client state?: https://tanstack.com/query/latest/docs/framework/react/guides/does-this-replace-client-state
43. react.dev, Reusing Logic with Custom Hooks: https://react.dev/learn/reusing-logic-with-custom-hooks
44. react.dev, You Might Not Need an Effect: https://react.dev/learn/you-might-not-need-an-effect ✔
45. Kent C. Dodds, Application State Management with React: https://kentcdodds.com/blog/application-state-management-with-react
46. Alex Bespoyasov, Clean Architecture on Frontend: https://bespoyasov.me/blog/clean-architecture-on-frontend/
47. LaunchDarkly, My approach to React app architecture in 2025: https://launchdarkly.com/docs/blog/react-architecture-2025

### Константи, утиліти, типи, naming
48. Google TypeScript Style Guide: https://google.github.io/styleguide/tsguide.html
49. TypeScript Handbook, Enums: https://www.typescriptlang.org/docs/handbook/enums.html
50. Total TypeScript, `as const`: https://www.totaltypescript.com/concepts/as-const
51. Airbnb React/JSX Style Guide: https://github.com/airbnb/javascript/tree/master/react
52. react.dev, Removing Effect Dependencies: https://react.dev/learn/removing-effect-dependencies
53. Matti Lehtinen, The Dunghill Anti-Pattern: https://mattilehtinen.com/articles/dunghill-anti-pattern-why-utility-classes-and-modules-smell/
54. Catalin Pit, Validate Environment Variables With Zod: https://catalins.tech/validate-environment-variables-with-zod/
55. Nazar Boyko, How To Write Maintainable Utility Functions In TypeScript: https://www.nazarboyko.com/articles/maintainable-utility-functions-typescript
56. Zod, Basics (Inferring types): https://zod.dev/basics ✔
57. TypeScript 4.9 release notes (`satisfies`): https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html ✔

### React API і фактчек
58. react.dev, useMemo: https://react.dev/reference/react/useMemo
59. react.dev, useCallback: https://react.dev/reference/react/useCallback ✔
60. react.dev, memo: https://react.dev/reference/react/memo
61. react.dev, React v19: https://react.dev/blog/2024/12/05/react-19
62. react.dev, Rules of React: https://react.dev/reference/rules
63. react.dev, Rendering Lists: https://react.dev/learn/rendering-lists
64. react-error-boundary README: https://github.com/bvaughn/react-error-boundary
65. WAI-ARIA APG, Dialog (Modal) Pattern: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
66. react.dev, React Compiler v1.0 (2025-10-07): https://react.dev/blog/2025/10/07/react-compiler-1 ✔
67. react.dev, useActionState: https://react.dev/reference/react/useActionState
68. react.dev, useOptimistic: https://react.dev/reference/react/useOptimistic
69. react.dev, use: https://react.dev/reference/react/use
70. react.dev, useTransition: https://react.dev/reference/react/useTransition
71. react.dev, useSyncExternalStore: https://react.dev/reference/react/useSyncExternalStore

### Локальні
- [L1] `client/AGENTS.md`
- [L2] `client/docs/component-anatomy.md`
- [L3] `docs/adr/0003-collapse-in-vendored-ui.md`
- [L4] `client/INSIGHTS.md`
- [L5] `~/.claude/skills/writing-great-skills/SKILL.md`
