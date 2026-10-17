/** Injected by vite.config.ts (T20). */
declare const __BUILD__: {
  /** "0.1.<commit count>", or package.json's version when git isn't available. */
  version: string;
  /** Short commit SHA, '' without git. */
  sha: string;
  /** Commits in HEAD's history, 0 without git. */
  count: number;
  /** Build time, ISO 8601 (UTC). */
  time: string;
};

declare module 'virtual:changelog' {
  const entries: { date: string; sha: string; subject: string }[];
  export default entries;
}
