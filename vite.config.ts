import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** Run git; undefined when git or the history isn't there (tarball builds, shallow clones). */
function git(...args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Build info (T20), injected as __BUILD__: "v0.1.<commit count>", short SHA and build time.
 * The patch number is the commit count, so it rises by itself on every push to main.
 */
function buildInfo() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  const count = Number(git('rev-list', '--count', 'HEAD')) || 0;
  const [major, minor] = pkg.version.split('.');
  return {
    version: count ? `${major}.${minor}.${count}` : pkg.version,
    sha: git('rev-parse', '--short', 'HEAD') ?? '',
    count,
    time: new Date().toISOString(),
  };
}

/**
 * `virtual:changelog`: the last 40 non-merge commits (date, short SHA, subject) as a JSON
 * module, read from git at build time. An empty list when git isn't available.
 */
function changelog(): Plugin {
  const id = 'virtual:changelog';
  return {
    name: 'keys-changelog',
    resolveId: (source) => (source === id ? '\0' + id : undefined),
    load(source) {
      if (source !== '\0' + id) return;
      const log = git('log', '--no-merges', '-n', '40', '--format=%cI%x09%h%x09%s') ?? '';
      const entries = log
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [date, sha, ...subject] = line.split('\t');
          return { date, sha, subject: subject.join('\t') };
        });
      return `export default ${JSON.stringify(entries)};`;
    },
  };
}

/** Emits dist/sw.js with every built file in its precache list, so the app works offline. */
function serviceWorker(): Plugin {
  return {
    name: 'keys-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      // Skip source maps, legacy .woff and non-Latin font subsets (fetched on demand if ever needed).
      const files = Object.keys(bundle).filter(
        (f) => !f.endsWith('.map') && !f.endsWith('.woff') && !(f.endsWith('.woff2') && !/-latin-\d/.test(f)),
      );
      const precache = ['./', ...files.map((f) => `./${f}`), './manifest.webmanifest',
        './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png'];
      const version = Date.now().toString(36);
      const source = readFileSync('sw/sw.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache, null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// GitHub Pages serves the app from /<repo>/, so build with a relative base.
export default defineConfig({
  base: './',
  plugins: [serviceWorker(), changelog()],
  define: { __BUILD__: JSON.stringify(buildInfo()) },
  build: { target: 'es2022', sourcemap: true },
  // Worktrees for parallel chats live under .claude/; never run their copies of the tests.
  test: { environment: 'node', exclude: ['**/node_modules/**', 'dist/**', '.claude/**'] },
} as never);
