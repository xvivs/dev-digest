/* Pure view-model logic for NotIndexedState: which copy and which busy flag the
   single call to action shows. Two axes (not cloned vs not indexed, idle vs busy)
   are resolved here instead of in nested JSX ternaries. */

export type NotIndexedCtaKey = "cloneCta" | "cloning" | "cta" | "indexing";

export interface NotIndexedInput {
  /** No clone on disk: only a clone can fix it, a resync cannot. */
  notCloned: boolean;
  cloning: boolean;
  indexing: boolean;
}

export interface NotIndexedView {
  bodyKey: "notCloned" | "body";
  errorTitleKey: "cloneErrorTitle" | "errorTitle";
  ctaKey: NotIndexedCtaKey;
  ctaLoading: boolean;
}

export function notIndexedView({ notCloned, cloning, indexing }: NotIndexedInput): NotIndexedView {
  if (notCloned) {
    return {
      bodyKey: "notCloned",
      errorTitleKey: "cloneErrorTitle",
      ctaKey: cloning ? "cloning" : "cloneCta",
      ctaLoading: cloning,
    };
  }
  return {
    bodyKey: "body",
    errorTitleKey: "errorTitle",
    ctaKey: indexing ? "indexing" : "cta",
    ctaLoading: indexing,
  };
}
