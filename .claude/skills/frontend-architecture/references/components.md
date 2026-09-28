# Component decomposition

How to cut a component into parts and design its props. Sources in brackets
refer to [sources.md](sources.md).

## Contents
1. Principles
2. Split signals (symptom checklist)
3. Composition patterns
4. Legacy and folklore advice
5. Good vs bad

## 1. Principles

- **One job per component.** "A component should ideally only be concerned with
  one thing. If it ends up growing, it should be decomposed" [17]. Start by
  matching components to the shape of the data they render [17].
- **Pure render.** No mutation of props, state or outer variables during
  render; side effects go in handlers or effects [18]. Purity is what makes
  extracting a piece safe.
- **Props are the component's API.** Name them for the caller's intent. A
  component that forwards `{...props}` everywhere hides its real contract [19].
- **State lives in the nearest common owner**, not at the root [20]. Moving it
  up or down while the shape settles is normal.
- **State identity = component type + position.** Extracting or inlining a
  piece can silently reset or keep state [21]. Use `key` to reset on purpose.
- **Prefer duplication over the wrong abstraction** — extract when the
  commonality is obvious, not on the first repeat [24][34].

## 2. Split signals (symptom checklist)

No primary source gives a line or prop limit; "200 lines" / "5–7 props" is
folklore [17][23]. Kent C. Dodds: split "when you experience one of the
problems… NOT BEFORE" [23]. Split when you see:

| Symptom | Move |
|---|---|
| Several unrelated state groups / handlers in one body | one component per job; parent composes |
| Loading / empty / error / data branches tangled in `?:` and `&&` | early returns around a shared layout; accept small duplication [34] |
| Typing in one input re-renders an expensive sibling | move the state down into the part that owns it, or lift content up as `children` — before reaching for `memo` [32] |
| Content props multiplying (`titleText`, `titleIcon`, `bodyContent`) | `children` / named slots [19] |
| Boolean props multiplying (`primary`, `danger`, `compact`) | one `variant` union, or separate components [35] |
| Callers need to reorder / omit parts (tabs, menus, selects) | compound components sharing state via context [26][27] |
| A reusable component sprouts flags for each caller's special case | inversion of control: accept a callback / render slot and let the caller decide [25] |
| Logic you want to unit-test lives in the render | move it to `helpers.ts` |
| One leaf needs interactivity in an otherwise static tree | make only that leaf a Client Component [36] |
| A `page.tsx` holds state or branches on data | move it into `_components/<Name>/` |

When *not* to split: a purely visual sub-region with no state and no reuse can
stay inline until one of the symptoms above appears [17][23].

## 3. Composition patterns

| Pattern | Use when | Cost |
|---|---|---|
| `children` / slots | wrapper-shaped components (card, panel, layout, modal body) | caller writes more JSX |
| `variant` union prop | one axis of visual variation | none; makes invalid combos unrepresentable |
| Compound components (`<Tabs><Tabs.List/>…`) | caller must compose parts freely | implicit context contract to learn [27] |
| Custom hook | share *logic*, not markup; each call gets its own state [43] | none — the default for logic reuse |
| Controlled + uncontrolled | parent sometimes needs to coordinate instances (accordion "one open") [20] | two code paths |
| `key` reset | wipe a subtree's state when an id changes [21] | remount |
| Render props | the component must control markup around caller content (drag-and-drop, virtualised rows) [30] | nesting |
| `asChild` / Slot | attach behaviour to the caller's element without a wrapper DOM node [33] | child must accept `ref` and spread props |

## 4. Legacy and folklore advice

| Advice | Status | Why |
|---|---|---|
| Split at N lines / N props | folklore | no source; use the symptom checklist |
| Container/Presentational as a mandatory split | legacy | its author, 2019: "I don't suggest splitting your components like this anymore… Hooks let me do the same thing without an arbitrary division" [29]; patterns.dev agrees [28]. A thin data-owning wrapper is still fine when it reads naturally |
| Render props / HOCs for logic reuse | narrowed | custom hooks are the default; keep HOCs for boundaries and library integration [30][31] |
| `renderX()` helper functions returning JSX | anti-pattern | not a component: no identity, no hooks, no DevTools entry. Make it `<X />` [62] |
| DRY on first sight | contested | AHA: wait until the abstraction is obvious [24] |

## 5. Good vs bad

```tsx
// ❌ content props grow with every new need
function Panel({ title, titleIcon, body, footerText }: PanelProps) { /* … */ }

// ✅ slots
function Panel({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  return <section style={s.panel}><header style={s.header}>{header}</header>{children}</section>;
}
```

```tsx
// ❌ boolean trap — 8 combinations, 3 valid
<Chip critical warning subtle />

// ✅ one axis
<Chip tone="critical" />
```

```tsx
// ❌ nested component definition — input loses focus on every keystroke
function AgentForm() {
  function NameField() {
    const [name, setName] = useState("");
    return <input value={name} onChange={(e) => setName(e.target.value)} />;
  }
  return <NameField />;
}

// ✅ module-level definition
function NameField() { /* … */ }
function AgentForm() { return <NameField />; }
```

```tsx
// ❌ conditional soup
return (
  <PanelLayout>
    {isPending ? <Skeleton /> : null}
    {!isPending && !data?.length ? <EmptyState /> : null}
    {data?.length ? data.map((f) => <FindingCard key={f.id} finding={f} />) : null}
  </PanelLayout>
);

// ✅ mutually exclusive branches, type-narrowed
if (isPending) return <PanelLayout><Skeleton /></PanelLayout>;
if (!data?.length) return <PanelLayout><EmptyState /></PanelLayout>;
return <PanelLayout>{data.map((f) => <FindingCard key={f.id} finding={f} />)}</PanelLayout>;
```

```tsx
// ❌ memo as a patch for state placed too high
function RunPage() {
  const [query, setQuery] = useState("");
  return (<><SearchInput value={query} onChange={setQuery} /><MemoTraceTree /></>);
}

// ✅ move the state down to its only user
function RunPage() {
  return (<><TraceSearch /><TraceTree /></>);
}
```

```tsx
// ❌ resetting state with an effect when the id changes
useEffect(() => { setDraft(""); }, [findingId]);

// ✅ key tells React it is a different instance
<CommentComposer key={findingId} findingId={findingId} />
```

```tsx
// ❌ render factory
const renderRow = (run: RunSummary) => <div>{run.agent_name}</div>;
return <>{runs.map(renderRow)}</>;

// ✅ component
function RunRow({ run }: { run: RunSummary }) { return <div>{run.agent_name}</div>; }
return <>{runs.map((r) => <RunRow key={r.run_id} run={r} />)}</>;
```

```tsx
// ❌ business rule inside JSX, untestable without rendering
{findings.filter((f) => f.confidence >= 0.65).sort(/* … */).map(/* … */)}

// ✅ pure helper + named constant, tested directly
// helpers.ts
export const baseFindings = (findings: FindingRecord[], opts: { hideLow: boolean }) => /* … */;
// FindingsPanel.tsx
{baseFindings(findings, { hideLow }).map((f) => <FindingCard key={f.id} finding={f} />)}
```
