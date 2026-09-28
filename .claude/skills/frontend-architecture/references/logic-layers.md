# Logic layers

Which layer owns which logic, and how data crosses between them. Sources in
brackets refer to [sources.md](sources.md).

## Contents
1. The model
2. Domain logic
3. Server state
4. Client (UI) state
5. Core / infrastructure
6. The DTO boundary
7. When layering is overkill
8. Good vs bad

## 1. The model

| Layer | Contains | Here | Tested by |
|---|---|---|---|
| Domain | pure calculations, filters, sorts, policies, status mapping | `helpers.ts` (component/route), `src/lib/<topic>.ts` | plain unit tests, no render |
| Server state | queries, mutations, keys, invalidation, polling | `lib/hooks/<domain>.ts` | component tests with `fetch` mocked |
| Application | orchestration: "on click → mutate → toast → navigate" | event handlers in the view, or a custom hook when shared | component tests |
| UI state | open/closed, hover, active tab, form draft | `useState` / `useReducer` in the component; URL for linkable state | component tests |
| Core | `apiFetch`, `ApiError`, providers, toast, theme, repo context | `lib/*.ts(x)` | its own tests |
| View | JSX | `<Name>.tsx` | component tests |

"Layering is not folders, it's dependency discipline" [6]: a `helpers.ts` that
imports React, or a component that calls `apiFetch`, has the folder but not the
layer.

## 2. Domain logic

Pure TypeScript, no React, no I/O [37][46]. It can be tested and reused without
rendering, and it survives UI rewrites.

Extract to `helpers.ts` when logic has branches, thresholds, sorting, grouping
or mapping — or when two views must agree on the same answer. `FindingsPanel`
splits `baseFindings` from `bySeverity` precisely so the toolbar counters and
the rendered list are computed from the same array (see the comment in its
`helpers.ts`). A one-liner like `const disabled = !isOnline` stays inline.

Signals that scattered logic should become a domain function: the same `if`
branches repeated across files, or plan/country/status-specific rules [37].

## 3. Server state

Anything whose source of truth is the Fastify API is **server state**: a cached
snapshot that can go stale behind your back [38][39]. TanStack Query owns its
freshness, retries, dedup and invalidation; it is explicitly *not* a
replacement for client state [42]. Kent C. Dodds calls it cache management, not
state management [45].

| Question | Server state | Client state |
|---|---|---|
| Source of truth | the API | this browser session |
| Can change without us | yes (another tab, a running review) | no |
| Needs refetch / retry / dedup | yes | no |
| Examples | PR list, reviews, runs, agents, settings | modal open, selected tab, draft comment, `?severity=` |
| Tool | a hook in `lib/hooks/<domain>.ts` | `useState` → lift to nearest owner → URL / Context |

Rules for this repo:

- **Adding an endpoint** = a function or call in `api.ts` → a hook in
  `lib/hooks/<domain>.ts` → the component consumes the hook (`component-anatomy.md`).
- **Never copy query data into `useState`** to "hold" it. Derive from `data`
  during render. A form draft seeded from server data is client state and fine.
- **Keys are tuples** `["<resource>", id, …]`. Reuse the exact tuple an existing
  hook uses for the same resource — `usePrReviews` shares `["reviews", prId]`
  so a hover in the PR list warms the cache the detail page reads.
  Invalidate by prefix after mutations (`invalidateQueries({ queryKey: ["agents"] })`).
- **Polling** belongs in the query (`refetchInterval` as a function of data, as
  in `usePrRuns`), not in a `setInterval` effect.
- **Mutations** are triggered from event handlers, never from an effect reacting
  to state [44]. Toast/navigate in `onSuccess`/`onError` or after `mutateAsync`.
- **Branch on `ApiError.status`** to choose the error surface (toast, inline,
  full-screen); status `0` means the API is unreachable.

Ecosystem practice not yet adopted here: query-key factories plus
`queryOptions()` for typo-safe, reusable query definitions [40][41]. Worth an
ADR if a domain file accumulates many related keys; don't introduce it
piecemeal in a feature PR.

## 4. Client (UI) state

- Colocate: keep state in the lowest component that needs it; lift only to the
  nearest common owner [20][45].
- One `status` union beats several booleans (`isSending`, `isSent`, `isError`)
  that can contradict each other [22].
- Derive, don't store: anything computable from props, state or query data is
  computed in render (`react-best-practices` has the full rule).
- State that must survive reload or be shareable goes in the URL: the PR detail
  page keeps `?tab=` and `?severity=` in search params via `next/navigation`.
- Context is for dependency injection (theme, repo context, toast), not for
  frequently-changing shared state — every consumer re-renders on change.

## 5. Core / infrastructure

`lib/api.ts` is the only `fetch` caller: it prefixes `API_BASE`, sets
`content-type` only when a body is present, and normalises every failure into
`ApiError`. Providers (`providers.tsx`, `theme.tsx`, `toast.tsx`,
`repo-context.tsx`) wire cross-cutting services. Feature code consumes these;
it never re-implements them (no second fetch wrapper, no local toast system).

## 6. The DTO boundary

API payload types come from `@devdigest/shared` (Zod contracts, `z.infer`
types). Rules:

- Use the shared type; don't hand-write a parallel `interface` for the same
  payload — it drifts at the first backend change [56].
- If a view needs a different shape, map it in a pure helper
  (`toRowModel(pr)`), not inline in JSX.
- `vendor/shared` is mirrored in `server/`; a contract change lands in both in
  the same commit (ADR 0001).
- Validate with `.safeParse` at the edge only for input you do not control
  (URL params, `localStorage`). Note the PR detail page deliberately uses a
  literal check for `?severity=` rather than `Severity.safeParse` — read the
  comment there before "fixing" it.

## 7. When layering is overkill

A thin client whose business rules live on the server does not need a full
domain / application / adapters split — "overkill" for thin clients [46]. The
minimum that pays off is: pure helpers for anything with branches, one data
access path, and imports that point one way. Extra layers (a Context for one
boolean, a service class wrapping one hook) are indirection, not architecture [47].

## 8. Good vs bad

```tsx
// ❌ component fetches directly
const [runs, setRuns] = useState<RunSummary[]>([]);
useEffect(() => { apiFetch<RunSummary[]>(`/pulls/${prId}/runs`).then(setRuns); }, [prId]);

// ✅ hook in lib/hooks/reviews.ts, component consumes it
const { data: runs = [] } = usePrRuns(prId);
```

```tsx
// ❌ server data mirrored into local state
const { data } = useAgents();
const [agents, setAgents] = useState<Agent[]>([]);
useEffect(() => { if (data) setAgents(data); }, [data]);

// ✅ read it; derive what you need
const { data: agents = [] } = useAgents();
const enabled = agents.filter((a) => a.enabled);
```

```ts
// ❌ key drift — invalidation of ["agents"] misses this
useQuery({ queryKey: ["agent-list"], queryFn: () => api.get<Agent[]>("/agents") });

// ✅ same tuple as the existing hook for the resource
useQuery({ queryKey: ["agents"], queryFn: () => api.get<Agent[]>("/agents") });
```

```tsx
// ❌ mutation fired from an effect watching state
useEffect(() => { if (submitted) createAgent.mutate(form); }, [submitted]);

// ✅ from the handler that expresses the intent
async function handleSubmit() {
  await createAgent.mutateAsync(form);
  notify(t("agentCreated"));
}
```

```ts
// ❌ polling with setInterval
useEffect(() => { const id = setInterval(() => refetch(), 4000); return () => clearInterval(id); }, []);

// ✅ polling owned by the query, stops itself
refetchInterval: (q) => ((q.state.data ?? []).some((r) => r.status === "running") ? 4000 : false),
```

```ts
// ❌ domain rule with an operator-precedence bug, inline in a component
const total = subtotal * TAX_RATES[country] ?? 0;   // parses as (subtotal * rate) ?? 0 → NaN leaks

// ✅ pure, parenthesised, unit-tested in helpers.test.ts
export function calculateTax(subtotal: number, country: CountryCode): number {
  return subtotal * (TAX_RATES[country] ?? 0);
}
```

```ts
// ❌ parallel hand-written type for a shared contract
interface Finding { id: string; severity: string }

// ✅ the contract type
import type { FindingRecord } from "@devdigest/shared";
```
