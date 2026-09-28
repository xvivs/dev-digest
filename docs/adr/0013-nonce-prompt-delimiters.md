# ADR 0013 — Prompt delimiters carry a per-request nonce

**Status:** accepted
**Date:** 2026-09-28
**Amends:** ADR 0012, Decision 3 (escaping is kept, but it is no longer the boundary)

## Context

The prompt fences untrusted content in `<untrusted>…</untrusted>` and skills in
`<skills>…</skills>` (`reviewer-core/src/prompt.ts`). The guard tells the model
that text inside `<untrusted>` is data. Both tags were fixed strings, so
anyone who could write into a diff, a PR body or a skill could write the same
string and close the fence early.

ADR 0012 Decision 3 answered that by rewriting forged tags in the content
(`neutralizeDelimiters`). Four review rounds on 2026-09-28 each found a new way
past it:

| Round | Bypass |
|---|---|
| 1 | fullwidth `＞` or small-form `﹥` closing the tag |
| 2 | zero-width character, soft hyphen or combining mark inside the tag word; fullwidth letters and `／` |
| 3 | a tag split across a skill's name/body join, reassembled after per-field escaping |
| 4 | Cyrillic homoglyphs: `</untruѕted>`, `</untrustеd>` |

Rounds 1 to 3 were fixable in the regex. Round 4 shows the regex cannot win:
Unicode has thousands of confusables, and a list of them is the denylist
`reviewer-core/AGENTS.md` rules out ("a denylist only ever catches one
phrasing").

## Decision

1. `assemblePrompt` resolves one nonce per call: 12 hex characters from
   `globalThis.crypto.getRandomValues`, regenerated if it occurs anywhere in
   the inputs. Callers may pass `parts.nonce` (validated against
   `/^[a-z0-9]{8,32}$/`); tests do, production does not.
2. Every delimiter carries it: `<untrusted-N source="…">…</untrusted-N>` and
   `<skills-N>…</skills-N>`. `wrapUntrusted(label, content, nonce)` takes it as
   a required argument.
3. The guard names the suffix and states that a tag without exactly that suffix
   is ordinary data, whatever its spelling or script.
4. `neutralizeDelimiters` stays as defense in depth and runs on the assembled
   skills block and on each untrusted block, as before.

## Consequences

### What this enables

- A forged closing tag is inert without the nonce, and the nonce is generated
  after the attacker's content is fixed. No homoglyph list is needed.
- Map-reduce gets a fresh nonce per chunk call, so one chunk's prompt reveals
  nothing about another's.

### What this costs

- Every prompt changes, so every review's output may shift. This is the
  behavioural change `reviewer-core/AGENTS.md` asks to be called out.
- Prompts are no longer byte-identical across runs. Traces show a different
  suffix each time; tests must pin `parts.nonce`.
- The engine now calls Web Crypto. It is not I/O, but it is the package's first
  source of non-determinism outside the injected `LLMProvider`.
- A trace records the nonce it used. That is safe: a later run uses a new one.

### What this forbids

- Fixed-string delimiters in any prompt `assemblePrompt` builds.
- Calling `wrapUntrusted` without the nonce the guard names.
- Treating `neutralizeDelimiters` as the security boundary, or growing it into
  a confusables table.

## Alternatives considered

| Option | For | Against |
|---|---|---|
| Keep extending the regex (Cyrillic/Greek confusables per letter) | Small change, prompt format stays | The next script or confusable reopens it; it is the denylist AGENTS.md forbids |
| Canonicalize untrusted text (NFKC + strip ignorables + confusable skeleton) before wrapping | Catches whole classes at once | Alters the diff the model cites, so grounding against the real diff breaks; still a mapping table |
| **Per-request nonce in every delimiter (chosen)** | Forgery needs a secret the attacker cannot know; independent of Unicode | Output changes for every review; prompts lose byte-stability |
| Move untrusted content into separate messages or tool results | Structural separation, no delimiters in text | Not supported the same way by every provider behind `LLMProvider`; larger change to `reviewPullRequest` |

## Revisit when

- A provider behind `LLMProvider` offers a first-class channel for untrusted
  data. Then move the untrusted blocks there and drop in-text delimiters.
