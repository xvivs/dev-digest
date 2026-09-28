# React Best Practices — Code Examples

Good/bad patterns for each rule in [SKILL.md](SKILL.md). Stack: Next 15 App
Router, React 19, TanStack Query over `src/lib/api.ts`, styles in `styles.ts`.

---

## Derive, Don't Store

```tsx
// BAD: Storing derived state
const [fullName, setFullName] = useState('');
useEffect(() => {
  setFullName(`${firstName} ${lastName}`);
}, [firstName, lastName]);

// GOOD: Compute during render
const fullName = `${firstName} ${lastName}`;
```

```tsx
// BAD: Filtering in useEffect
const [visible, setVisible] = useState(findings);
useEffect(() => {
  setVisible(findings.filter((f) => f.severity === selected));
}, [findings, selected]);

// GOOD: Compute during render — a filter over a PR's findings is cheap
const visible = findings.filter((f) => f.severity === selected);

// GOOD (only if console.time shows >= 1ms, e.g. thousands of diff lines)
const parsedLines = useMemo(() => parseDiff(rawDiff), [rawDiff]);
```

```tsx
// BAD: Mirroring query data into state
const { data } = useAgents();
const [agents, setAgents] = useState<Agent[]>([]);
useEffect(() => { if (data) setAgents(data); }, [data]);

// GOOD: Read and derive from the query
const { data: agents = [] } = useAgents();
const enabledAgents = agents.filter((a) => a.enabled);
```

```tsx
// BAD: Keeping a "corrected" copy of an index in state
const [index, setIndex] = useState(0);
useEffect(() => { if (index >= items.length) setIndex(items.length - 1); }, [items, index]);

// GOOD: Clamp on read
const [rawIndex, setIndex] = useState(0);
const index = Math.min(rawIndex, Math.max(items.length - 1, 0));
```

---

## Memoization

```tsx
// BAD: Over-memoizing trivial operations
const greeting = useMemo(() => `Hello, ${name}!`, [name]);
const handleClick = useCallback(() => setOpen(true), []);   // passed to a plain <button>

// GOOD: useMemo for a measured-expensive computation
const sortedRuns = useMemo(
  () => [...runs].sort((a, b) => Date.parse(b.ran_at) - Date.parse(a.ran_at)),
  [runs],   // only worth it for large lists; otherwise compute inline
);
```

```tsx
// GOOD: useCallback when the function is a dependency of another hook
const loadMore = useCallback(() => fetchNextPage(), [fetchNextPage]);
useEffect(() => {
  if (inView) loadMore();
}, [inView, loadMore]);

// GOOD: useCallback when passed to a memo-wrapped child
const MemoRow = memo(Row);
const handleSelect = useCallback((id: string) => setSelected(id), []);
<MemoRow onSelect={handleSelect} />

// GOOD: useCallback for functions returned from a custom hook
function useFindingActions(prId: string) {
  const mutate = useFindingAction(prId).mutate;
  const accept = useCallback((id: string) => mutate({ id, kind: 'accept' }), [mutate]);
  const dismiss = useCallback((id: string) => mutate({ id, kind: 'dismiss' }), [mutate]);
  return { accept, dismiss };
}
```

---

## Render Factories

```tsx
// BAD: Render factory (camelCase, called as a function)
const renderRunRow = (run: RunSummary) => <div>{run.agent_name}</div>;
return <div>{runs.map(renderRunRow)}</div>;

// GOOD: Proper component (PascalCase, used as JSX)
function RunRow({ run }: { run: RunSummary }) {
  return <div>{run.agent_name}</div>;
}
return <div>{runs.map((run) => <RunRow key={run.run_id} run={run} />)}</div>;
```

```tsx
// BAD: Component defined inside another component — state resets every render
function AgentEditor() {
  function NameField() {
    const [name, setName] = useState('');
    return <input value={name} onChange={(e) => setName(e.target.value)} />;
  }
  return <NameField />;
}

// GOOD: Module-level definition
function NameField() { /* ... */ }
function AgentEditor() { return <NameField />; }
```

---

## Inline Creation in JSX

```tsx
// BAD: New array on every render
<SeverityFilterBar options={['CRITICAL', 'WARNING', 'SUGGESTION']} />

// GOOD: Stable reference (module-level constant, in constants.ts)
export const SEVERITY_OPTIONS = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const;
<SeverityFilterBar options={SEVERITY_OPTIONS} />
```

```tsx
// BAD: Inline style object literal in JSX
<div style={{ padding: 16, background: '#fff' }}>

// GOOD: Colocated styles.ts over CSS variables (ADR 0003)
// styles.ts
export const s = { panel: { padding: 16, background: 'var(--bg-elevated)' } satisfies CSSProperties };
// Component.tsx
<div style={s.panel}>
```

---

## Separate Logic from Rendering (hook, not container)

```tsx
// BAD: Data fetching, business rules and 150 lines of JSX in one body
function FindingsPanel({ prId }: { prId: string }) {
  const [findings, setFindings] = useState<FindingRecord[]>([]);
  useEffect(() => { apiFetch(`/pulls/${prId}/reviews`).then(/* ... */); }, [prId]);
  const shown = findings.filter((f) => f.confidence >= 0.65).sort(/* ... */);
  // ... 150 lines of rendering
}

// GOOD: Hook owns data, helper owns rules, component renders
function FindingsPanel({ prId }: { prId: string }) {
  const { data: reviews, isPending, error } = usePrReviews(prId);
  if (isPending) return <Skeleton />;
  if (error) return <ErrorState error={error} />;
  const findings = baseFindings(latestFindings(reviews), { hideLow: true });  // helpers.ts
  if (!findings.length) return <EmptyState />;
  return <FindingList findings={findings} />;
}
```

---

## State Colocation

```tsx
// BAD: State lifted too high — every keystroke re-renders the whole page
function PullsPage() {
  const [search, setSearch] = useState('');
  return (
    <>
      <SearchBar value={search} onChange={setSearch} />
      <RepoStats />      {/* re-renders on every keystroke */}
      <PullsTable search={search} />
    </>
  );
}

// GOOD: State pushed down to the section that uses it
function PullsPage() {
  return (
    <>
      <RepoStats />
      <SearchablePulls />   {/* owns search state */}
    </>
  );
}

function SearchablePulls() {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);   // keeps typing responsive
  return (
    <>
      <SearchBar value={search} onChange={setSearch} />
      <PullsTable search={deferredSearch} />
    </>
  );
}
```

---

## Resetting State with a Key

```tsx
// BAD: Clearing state in an effect when the id changes (renders stale draft first)
function CommentComposer({ findingId }: { findingId: string }) {
  const [draft, setDraft] = useState('');
  useEffect(() => { setDraft(''); }, [findingId]);
  // ...
}

// GOOD: A different key = a different instance, state starts fresh
<CommentComposer key={findingId} findingId={findingId} />
```

---

## Data Fetching

```tsx
// BAD: Fetching directly in a component
function AgentDetail({ id }: { id: string }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_BASE}/agents/${id}`).then((r) => r.json()).then(setAgent);
  }, [id]);
  // no cancellation, no cache, no error normalisation
}

// GOOD: Hook in src/lib/hooks/agents.ts over api.ts
function AgentDetail({ id }: { id: string }) {
  const { data: agent, isPending, error } = useAgent(id);
  if (isPending) return <Skeleton />;
  if (error) return <ErrorState error={error} />;
  return <AgentForm agent={agent} />;
}
```

```ts
// BAD: Hand-rolled AbortController effect
useEffect(() => {
  const controller = new AbortController();
  apiFetch('/pulls', { signal: controller.signal }).then(setPulls);
  return () => controller.abort();
}, []);

// GOOD: TanStack Query passes the signal and cancels for you.
// `api.get` takes no init, so forward the signal through `apiFetch` when cancellation matters.
useQuery({
  queryKey: ['pulls', repoId],
  queryFn: ({ signal }) => apiFetch<PullSummary[]>(`/repos/${repoId}/pulls`, { signal }),
});
```

```ts
// BAD: Polling with setInterval
useEffect(() => {
  const t = setInterval(() => refetch(), 4000);
  return () => clearInterval(t);
}, [refetch]);

// GOOD: Polling owned by the query, stops when nothing is running
refetchInterval: (q) => ((q.state.data ?? []).some((r) => r.status === 'running') ? 4000 : false),
```

---

## useEffect Misuse

```tsx
// BAD: useEffect for event handling
const [submitted, setSubmitted] = useState(false);
useEffect(() => {
  if (submitted) {
    createAgent.mutate(form);
    setSubmitted(false);
  }
}, [submitted]);

// GOOD: Logic in the event handler
async function handleSubmit() {
  const agent = await createAgent.mutateAsync(form);
  notify(t('agentCreated'));
  router.push(`/agents/${agent.id}`);
}
```

```ts
// BAD: Lifecycle wrapper hides intent
function useMount(fn: () => void) { useEffect(() => { fn(); }, []); }

// GOOD: Hook named for the external system it synchronises
function useRunEvents(runId: string, onEvent: (e: RunEvent) => void) {
  useEffect(() => {
    const source = new EventSource(`${API_BASE}/runs/${runId}/events`);
    source.onmessage = (m) => onEvent(JSON.parse(m.data));
    return () => source.close();
  }, [runId, onEvent]);
}
```

---

## Forms & Actions (React 19)

```tsx
// BAD: Hand-rolled pending/error booleans
const [isSaving, setIsSaving] = useState(false);
const [error, setError] = useState<string | null>(null);
async function onSubmit(e: FormEvent) {
  e.preventDefault(); setIsSaving(true);
  try { await saveKey(value); } catch (err) { setError(String(err)); } finally { setIsSaving(false); }
}

// GOOD: useActionState owns pending + result
const [state, formAction, isPending] = useActionState(
  async (_prev: { error?: string }, formData: FormData) => {
    try { await saveKey.mutateAsync(String(formData.get('key'))); return {}; }
    catch (err) { return { error: err instanceof ApiError ? err.message : 'unknown' }; }
  },
  {},
);
<form action={formAction}>
  <input name="key" aria-invalid={!!state.error} aria-describedby="key-error" />
  <button disabled={isPending}>Save</button>
  {state.error && <p id="key-error">{state.error}</p>}
</form>
```

```tsx
// GOOD: Optimistic UI while the mutation is in flight
const [optimisticStatus, setOptimisticStatus] = useOptimistic(finding.status);
function handleAccept() {
  startTransition(async () => {
    setOptimisticStatus('accepted');
    await acceptFinding.mutateAsync(finding.id);
  });
}
```

---

## Early Returns for States

```tsx
// BAD: Nested ternaries
return isPending ? <Skeleton /> : error ? <ErrorState /> : data?.length ? <Grid data={data} /> : <EmptyState />;

// GOOD: Early returns
if (isPending) return <Skeleton />;
if (error) return <ErrorState error={error} />;
if (!data?.length) return <EmptyState />;
return <Grid data={data} />;
```

---

## Error Boundaries

```tsx
// Route level — Next App Router: app/repos/[repoId]/pulls/error.tsx
'use client';
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState error={error}>
      <button onClick={reset}>Try again</button>
    </ErrorState>
  );
}
```

```tsx
// Component level (requires adding react-error-boundary — a dependency decision)
import { ErrorBoundary } from 'react-error-boundary';
import { usePathname } from 'next/navigation';

function Section({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <ErrorBoundary resetKeys={[pathname]} FallbackComponent={SectionFallback}>
      {children}
    </ErrorBoundary>
  );
}
```

---

## Key Prop Patterns

```tsx
// BAD: Index as key — state bugs when the list changes
{findings.map((f, index) => <FindingCard key={index} finding={f} />)}

// GOOD: Stable unique id
{findings.map((f) => <FindingCard key={f.id} finding={f} />)}

// BAD: Random key — full remount every render
{findings.map((f) => <FindingCard key={Math.random()} finding={f} />)}

// GOOD: Key on the Fragment when mapping fragments
{items.map((item) => (
  <Fragment key={item.id}>
    <dt>{item.label}</dt>
    <dd>{item.value}</dd>
  </Fragment>
))}
```

---

## Conditional Rendering Gotcha

```tsx
// BAD: Renders literal "0" when count is 0
{count && <Badge>{count}</Badge>}

// GOOD: Explicit comparison
{count > 0 && <Badge>{count}</Badge>}

// GOOD: Ternary
{count ? <Badge>{count}</Badge> : null}
```

---

## Accessibility

```tsx
// BAD: Icon button without label — invisible to screen readers
<button onClick={onDelete}><TrashIcon /></button>

// GOOD
<button onClick={onDelete} aria-label={t('deleteRun')}><TrashIcon /></button>

// BAD: Error not associated with the field
<input type="email" />
{error && <span style={s.error}>{error}</span>}

// GOOD: Error linked to the field
<input type="email" aria-invalid={!!error} aria-describedby="email-error" />
{error && <span id="email-error" style={s.error}>{error}</span>}

// GOOD: Live region for dynamic updates
<div aria-live="polite">{t('findingsCount', { count: findings.length })}</div>
```

```tsx
// BAD: A div that looks like a modal
<div style={s.overlay}><div style={s.modal}>{children}</div></div>

// GOOD: Dialog semantics (WAI-ARIA APG) + focus management + Escape
<div role="dialog" aria-modal="true" aria-labelledby="prompt-title" style={s.modal}>
  <h2 id="prompt-title">{t('prompt')}</h2>
  {children}
  <button onClick={onClose} aria-label={t('close')}>×</button>
</div>
```

---

## Code Splitting

```tsx
// BAD: Heavy client-only widget in the main bundle of every page
import { MermaidDiagram } from '@/components/mermaid-diagram';

// GOOD: next/dynamic with a static import path
import dynamic from 'next/dynamic';
const MermaidDiagram = dynamic(
  () => import('@/components/mermaid-diagram').then((m) => m.MermaidDiagram),
  { ssr: false, loading: () => <Skeleton /> },
);
```

---

## React 19: ref as Prop

```tsx
// OLD (React 18): forwardRef boilerplate
const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) => <input ref={ref} {...props} />);

// NEW (React 19): ref as a regular prop
function Input({ ref, ...props }: InputProps & { ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} {...props} />;
}
```
