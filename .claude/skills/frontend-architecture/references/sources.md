# Sources

Numbered sources behind the rules in this skill. Numbering matches `docs/research/react-best-practices-research.md` §12, where each entry is annotated; ✔ marks claims re-verified against the primary source on 2026-09-28.

## Project structure
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

## Component decomposition
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

## Logic layers and state
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

## Constants, utils, types, naming
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

## React API
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


## Local

- `client/AGENTS.md`, `client/docs/component-anatomy.md` — local conventions (source of truth)
- `docs/adr/0001-vendored-shared.md`, `docs/adr/0003-collapse-in-vendored-ui.md`
- `client/INSIGHTS.md`
