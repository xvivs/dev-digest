// pr-self-review: a small, conservative shell tokenizer for gate-hook.mjs.
//
// It is not a shell. It only has to answer "which simple commands does this
// line run, in which directory, with which words", and to fail toward
// "looks like a gated command" whenever it is unsure (a false block is a
// nuisance, a false allow defeats the gate).
//
// Handled: single/double quotes, backslashes, comments, `&& || ; | & \n`,
// redirects (`2>&1`, `>f`, `> f`, `&>f`, `<f`, `<<EOF`) which are dropped from
// the word list, `( )` subshells, `$( )` and backticks, `cd`/`pushd`,
// env-assignment prefixes, `env|command|time|nohup|exec|sudo|nice` wrappers,
// and `bash|sh|zsh -c '<string>'`.
// Not handled: aliases, functions, variables holding a command name, heredoc
// bodies (treated as more words: at worst a false block). `eval`, `xargs`,
// `find -exec`, `source` and `bash -c "$VAR"` are flagged `indirect` on the
// command; gate-hook.mjs blocks them when push / pr create appears in the text.

import { homedir } from 'node:os';
import { resolve } from 'node:path';

// Marker for "the working directory is not statically known" (`cd "$X"`, `cd -`).
export const UNKNOWN_DIR = Symbol('unknown-dir');

const WRAPPERS = new Set(['env', 'command', 'builtin', 'exec', 'time', 'nohup', 'sudo', 'nice']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
// Commands that run text/other commands the tokenizer cannot follow.
const INDIRECT = new Set(['eval', 'xargs', 'source', '.']);
const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir']);

/**
 * Tokenizes into a flat stream of `{ op }` (`&&`, `||`, `;`, `|`, `&`, `(`, `)`)
 * and `{ word, dyn }` items. `dyn` = the word contains an expansion (`$x`,
 * `` `..` ``, glob) whose value cannot be known statically.
 */
export function tokenize(command) {
  const items = [];
  let cur = '';
  let started = false;
  let dyn = false;
  let skipWord = false; // the next word is a redirect target
  let backtickOpen = false;
  const pendingNested = [];
  const heredocs = [];
  const n = command.length;

  const flush = () => {
    if (!started) return;
    if (skipWord) skipWord = false;
    else items.push({ word: cur, dyn });
    cur = '';
    started = false;
    dyn = false;
  };
  const op = (v) => {
    flush();
    items.push({ op: v });
  };

  for (let i = 0; i < n; i++) {
    const c = command[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      flush();
    } else if (c === '\n') {
      op(';');
      while (heredocs.length) {
        const { delim, strip } = heredocs.shift();
        for (;;) {
          const eol = command.indexOf('\n', i + 1);
          const line = command.slice(i + 1, eol === -1 ? n : eol);
          i = eol === -1 ? n : eol;
          if ((strip ? line.replace(/^\t+/, '') : line) === delim || eol === -1) break;
        }
      }
    } else if (c === '#' && !started) {
      while (i < n && command[i] !== '\n') i++;
      i--; // leave the newline to the loop
    } else if (c === "'") {
      const end = command.indexOf("'", i + 1);
      const stop = end === -1 ? n : end;
      cur += command.slice(i + 1, stop);
      started = true;
      i = stop;
    } else if (c === '"') {
      started = true;
      let j = i + 1;
      let inner = '';
      while (j < n && command[j] !== '"') {
        if (command[j] === '\\' && j + 1 < n) {
          if ('"\\$`'.includes(command[j + 1])) inner += command[j + 1];
          else inner += command[j] + command[j + 1];
          j += 2;
          continue;
        }
        inner += command[j++];
      }
      cur += inner;
      if (/[$`]/.test(inner)) {
        dyn = true;
        // Commands nested in the string still run: surface them as extra commands.
        for (const m of inner.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
          const nested = tokenize(m[1] ?? m[2] ?? '');
          nested.unshift({ op: ';' });
          nested.push({ op: ';' });
          pendingNested.push(nested);
        }
      }
      i = j;
    } else if (c === '\\') {
      if (command[i + 1] === '\n') i++; // line continuation
      else if (i + 1 < n) {
        cur += command[++i];
        started = true;
      }
    } else if (c === '$' && command[i + 1] === '(') {
      op('(');
      i++;
    } else if (c === '$') {
      cur += c;
      started = true;
      dyn = true;
    } else if (c === '`') {
      op(backtickOpen ? ')' : '(');
      backtickOpen = !backtickOpen;
    } else if (c === '&' && command[i + 1] === '&') {
      op('&&');
      i++;
    } else if (c === '&' && command[i + 1] === '>') {
      // `&>file` / `&>>file`
      flush();
      i += command[i + 2] === '>' ? 2 : 1;
      skipWord = true;
    } else if (c === '&') {
      op('&');
    } else if (c === '|') {
      if (command[i + 1] === '|') {
        op('||');
        i++;
      } else {
        if (command[i + 1] === '&') i++; // `|&`
        op('|');
      }
    } else if (c === ';') {
      op(';');
    } else if (c === '(' || c === ')') {
      op(c);
    } else if (c === '<' || c === '>') {
      // A bare number right before the operator is the fd (`2>&1`), not an argument.
      if (started && /^\d+$/.test(cur) && !dyn) {
        cur = '';
        started = false;
      } else {
        flush();
      }
      let j = i;
      while (j + 1 < n && (command[j + 1] === c || command[j + 1] === '|' || (c === '<' && command[j + 1] === '>'))) j++;
      const opText = command.slice(i, j + 1);
      if (opText === '<<' || opText === '<<-') {
        // Heredoc: the delimiter word is read here, the body is skipped at the next newline.
        let k = j + 1;
        while (command[k] === ' ' || command[k] === '\t') k++;
        let delim = '';
        while (k < n && !/[\s;&|<>()]/.test(command[k])) {
          if (command[k] !== "'" && command[k] !== '"' && command[k] !== '\\') delim += command[k];
          k++;
        }
        heredocs.push({ delim, strip: opText === '<<-' });
        i = k - 1;
        continue;
      }
      if (command[j + 1] === '&') {
        // `>&1`, `>&2`, `<&-`, `>&file`: the target is glued to the operator.
        j++;
        while (j + 1 < n && /[0-9-]/.test(command[j + 1])) j++;
        if (!/[0-9-]/.test(command[j])) skipWord = true;
      } else {
        skipWord = true;
      }
      i = j;
    } else {
      cur += c;
      started = true;
      if (/[*?[]/.test(c)) dyn = true;
    }
  }
  flush();
  if (pendingNested.length) {
    for (const nested of pendingNested.splice(0)) items.push(...nested);
  }
  return items;
}

function expandTilde(word, dyn) {
  if (dyn) return word;
  if (word === '~') return homedir();
  if (word.startsWith('~/')) return homedir() + word.slice(1);
  return word;
}

function isAssignment(w) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(w);
}

/**
 * Splits a command line into simple commands, each with the directory it runs
 * in: `[{ words: string[], dyn: boolean[], cwd: string | UNKNOWN_DIR, env: {} }]`.
 * `cd`/`pushd` are followed (and undone at the end of a `( ... )` subshell).
 * Wrappers and env assignments are stripped from `words`.
 */
export function commands(command, cwd) {
  const items = tokenize(command);
  const out = [];
  const stack = [];
  let dir = cwd;
  let buf = [];

  const endCommand = () => {
    if (buf.length) runSimple(buf);
    buf = [];
  };

  function runSimple(list) {
    let i = 0;
    const env = {};
    for (;;) {
      const w = list[i]?.word;
      if (w === undefined) return;
      if (isAssignment(w) && !list[i].dyn) {
        env[w.slice(0, w.indexOf('='))] = w.slice(w.indexOf('=') + 1);
        i++;
      } else if (WRAPPERS.has(w)) {
        i++;
        while (i < list.length && (list[i].word.startsWith('-') || isAssignment(list[i].word))) {
          if (isAssignment(list[i].word)) env[list[i].word.slice(0, list[i].word.indexOf('='))] = list[i].word.slice(list[i].word.indexOf('=') + 1);
          i++;
        }
      } else break;
    }
    const rest = list.slice(i);
    const name = rest[0].word.replace(/^.*\//, ''); // /usr/bin/git → git
    const words = rest.map((r, k) => (k === 0 ? name : expandTilde(r.word, r.dyn)));
    const dyn = rest.map((r) => r.dyn);

    if (name === 'cd' || name === 'pushd') {
      const args = rest.slice(1).filter((r) => !/^-[LPe@]+$/.test(r.word) && r.word !== '--');
      if (args.length === 0) dir = name === 'cd' ? homedir() : dir;
      else if (args.length > 1 || args[0].dyn || args[0].word === '-') dir = UNKNOWN_DIR;
      else if (dir !== UNKNOWN_DIR) dir = resolve(dir, expandTilde(args[0].word, false));
      return;
    }
    if (name === 'popd') {
      dir = UNKNOWN_DIR;
      return;
    }
    if (SHELLS.has(name)) {
      const c = rest.findIndex((r) => /^-[a-z]*c[a-z]*$/.test(r.word));
      if (c !== -1 && rest[c + 1]) {
        // `bash -c "$CMD"`: the string is not known, only its expansion would say what runs.
        if (rest[c + 1].dyn) out.push({ words, dyn, cwd: dir, env, indirect: 'shell-dynamic' });
        out.push(...commands(rest[c + 1].word, dir));
        return;
      }
    }
    // eval / xargs / source / find -exec: the command they run is not statically visible.
    const indirect = INDIRECT.has(name) ? name : name === 'find' && words.some((w) => FIND_EXEC.has(w)) ? 'find -exec' : undefined;
    out.push({ words, dyn, cwd: dir, env, ...(indirect ? { indirect } : {}) });
  }

  for (const it of items) {
    if (it.word !== undefined) {
      buf.push(it);
      continue;
    }
    if (it.op === '(') {
      endCommand();
      stack.push(dir);
    } else if (it.op === ')') {
      endCommand();
      if (stack.length) dir = stack.pop();
    } else {
      endCommand();
    }
  }
  endCommand();
  return out;
}

// ---------------------------------------------------------------------------
// git / gh command recognition

const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);

/**
 * `git [global options] <sub> args...` →
 * `{ sub, args, cdirs[], gitDir, workTree, dynamic }` or null if not git.
 * `dynamic` = a directory-carrying option has a value that cannot be resolved.
 */
export function parseGit(cmd) {
  const { words, dyn, env } = cmd;
  if (words[0] !== 'git') return null;
  const cdirs = [];
  let gitDir = env.GIT_DIR;
  let workTree = env.GIT_WORK_TREE;
  let dynamic = false;
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) {
    const w = words[i];
    const eq = w.indexOf('=');
    const key = w.startsWith('--') && eq !== -1 ? w.slice(0, eq) : w;
    let value;
    if (w.startsWith('--') && eq !== -1) value = w.slice(eq + 1);
    else if (GIT_OPTS_WITH_VALUE.has(w)) {
      value = words[i + 1];
      if (dyn[i + 1]) dynamic = dynamic || key !== '-c';
      i++;
    }
    if (key === '-C') cdirs.push(value ?? '');
    else if (key === '--git-dir') gitDir = value;
    else if (key === '--work-tree') workTree = value;
    if (w.startsWith('--') && eq !== -1 && dyn[i]) dynamic = dynamic || key === '--git-dir' || key === '--work-tree';
    i++;
  }
  return { sub: words[i], args: words.slice(i + 1), cdirs, gitDir, workTree, dynamic };
}

/**
 * `gh [-R repo] pr [-R repo] create args...` → `{ args }` or null.
 * `-R/--repo` picks the repository the PR is opened *in*; the local branch is
 * still the one checked out in the working directory.
 */
export function parseGhPrCreate(cmd) {
  const { words } = cmd;
  if (words[0] !== 'gh') return null;
  let i = 1;
  const skipFlags = () => {
    while (i < words.length && words[i].startsWith('-')) {
      i += (words[i] === '-R' || words[i] === '--repo') && words[i + 1] !== undefined ? 2 : 1;
    }
  };
  skipFlags();
  if (words[i] !== 'pr') return null;
  i++;
  skipFlags();
  if (words[i] !== 'create') return null;
  return { args: words.slice(i + 1) };
}
