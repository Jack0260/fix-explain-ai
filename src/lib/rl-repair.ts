// Tiny reinforcement-learning program repair engine.
// State: source code. Actions: rewrite rules. Reward: change in test pass rate (executed for real).

export type Test = { args: unknown[]; expected: unknown };
export type Program = { id: string; name: string; fn: string; description: string; code: string; tests: Test[] };

export type Action = {
  id: string;
  label: string;
  pattern: RegExp;
  rewrite: (m: RegExpMatchArray) => string;
  explain: (before: string, after: string) => string;
};

export const ACTIONS: Action[] = [
  {
    id: "loop-bound",
    label: "Fix off-by-one loop bound",
    pattern: /(\w+) <= ([\w.]+\.length)/,
    rewrite: (m) => `${m[1]} < ${m[2]}`,
    explain: (b, a) => `The loop used "${b}", which reads one element past the end of the array (index = length is undefined). Changed it to "${a}" so iteration stops at the last valid index.`,
  },
  {
    id: "init-accumulator",
    label: "Initialise accumulator",
    pattern: /let (\w+);/,
    rewrite: (m) => `let ${m[1]} = 0;`,
    explain: (b, a) => `"${b}" leaves the variable undefined, so adding to it produces NaN. Initialising it ("${a}") gives the sum a real starting value.`,
  },
  {
    id: "assign-in-cond",
    label: "Replace assignment in condition",
    pattern: /if \(([\w.]+) = ([^=)][^)]*)\)/,
    rewrite: (m) => `if (${m[1]} === ${m[2]})`,
    explain: (b, a) => `"${b}" assigns a value instead of comparing, so the condition is always truthy and overwrites data. Replaced with a strict comparison: "${a}".`,
  },
  {
    id: "strict-eq",
    label: "Use strict equality",
    pattern: /([^=!])==([^=])/,
    rewrite: (m) => `${m[1]}===${m[2]}`,
    explain: () => `Loose equality (==) performs type coercion. Switched to === so comparisons are exact. (Style-level fix; does not change behaviour here.)`,
  },
  {
    id: "flip-compare",
    label: "Flip comparison direction",
    pattern: /if \(([^()]*?) (<|>) ([^()]*?)\)/,
    rewrite: (m) => `if (${m[1]} ${m[2] === "<" ? ">" : "<"} ${m[3]})`,
    explain: (b, a) => `The comparison "${b}" pointed the wrong way, so the function tracked the opposite extreme. Flipped it to "${a}".`,
  },
  {
    id: "parity",
    label: "Flip parity check",
    pattern: /% 2 === 1|% 2 == 1/,
    rewrite: (m) => m[0].replace("1", "0"),
    explain: (b, a) => `"${b}" selects odd numbers, but the function counts evens. Changed to "${a}".`,
  },
  {
    id: "start-index",
    label: "Shift loop start to 1",
    pattern: /let (\w+) = 0; \1 </,
    rewrite: (m) => m[0].replace("= 0", "= 1"),
    explain: (b, a) => `Moved loop start from "${b}" to "${a}".`,
  },
];

export function candidates(code: string) {
  return ACTIONS.filter((a) => a.pattern.test(code));
}

export function apply(code: string, a: Action) {
  const m = code.match(a.pattern)!;
  const after = a.rewrite(m);
  return { code: code.replace(m[0], after), before: m[0], after };
}

export function score(code: string, p: Program) {
  let pass = 0;
  const results: { ok: boolean; got: string }[] = [];
  for (const t of p.tests) {
    try {
      const f = new Function(`${code}; return ${p.fn};`)();
      const got = f(...(JSON.parse(JSON.stringify(t.args)) as unknown[]));
      const ok = JSON.stringify(got) === JSON.stringify(t.expected);
      if (ok) pass++;
      results.push({ ok, got: String(got) });
    } catch (e) {
      results.push({ ok: false, got: `Error: ${(e as Error).message}` });
    }
  }
  return { rate: pass / p.tests.length, results };
}

export type Step = { action: Action; before: string; after: string; reward: number; rateBefore: number; rateAfter: number; q: number; explored: boolean };
export type RepairResult = { repaired: string; steps: Step[]; episodeRewards: number[]; finalRate: number; initialRate: number; log: string[] };

export type QTable = Record<string, number>;

const MAX_STEPS = 4;
const STYLE_BONUS = 0.02; // tiny reward for safe style fixes
const STEP_COST = 0.05;

function reward(rb: number, ra: number, id: string) {
  return ra - rb - STEP_COST + (id === "strict-eq" ? STYLE_BONUS + STEP_COST : 0);
}

export function repair(p: Program, Q: QTable, episodes = 40, alpha = 0.3, gamma = 0.9, epsilon = 0.3, seed = 7): RepairResult {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const log: string[] = [];
  const episodeRewards: number[] = [];
  const key = (code: string, a: Action) => `${a.id}`; // feature: action type generalises across programs
  const initialRate = score(p.code, p).rate;
  log.push(`[init] ${p.name}: ${Math.round(initialRate * 100)}% tests passing`);

  for (let ep = 0; ep < episodes; ep++) {
    let code = p.code;
    let total = 0;
    const eps = epsilon * (1 - ep / episodes);
    for (let t = 0; t < MAX_STEPS; t++) {
      const cands = candidates(code);
      if (!cands.length) break;
      const explore = rand() < eps;
      const a = explore ? cands[Math.floor(rand() * cands.length)] : cands.reduce((x, y) => ((Q[key(code, y)] ?? 0) > (Q[key(code, x)] ?? 0) ? y : x));
      const rb = score(code, p).rate;
      const next = apply(code, a).code;
      const ra = score(next, p).rate;
      const r = reward(rb, ra, a.id);
      const nextBest = Math.max(0, ...candidates(next).map((c) => Q[key(next, c)] ?? 0));
      const k = key(code, a);
      Q[k] = (Q[k] ?? 0) + alpha * (r + (ra === 1 ? 0 : gamma * nextBest) - (Q[k] ?? 0));
      total += r;
      if (r < 0) { /* revert harmful edits: agent keeps exploring from previous state */ } else code = next;
      if (ra === 1 && r >= 0) break;
    }
    episodeRewards.push(total);
    if (ep % 10 === 0 || ep === episodes - 1)
      log.push(`[ep ${String(ep).padStart(2, "0")}] ε=${eps.toFixed(2)} return=${total.toFixed(2)} Q={${Object.entries(Q).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(", ")}}`);
  }

  // Greedy rollout using learned policy
  let code = p.code;
  const steps: Step[] = [];
  const tried = new Set<string>();
  for (let t = 0; t < MAX_STEPS; t++) {
    const cands = candidates(code).filter((c) => !tried.has(c.id) && (Q[c.id] ?? 0) > 0);
    if (!cands.length) break;
    const a = cands.reduce((x, y) => ((Q[y.id] ?? 0) > (Q[x.id] ?? 0) ? y : x));
    tried.add(a.id);
    const rb = score(code, p).rate;
    const res = apply(code, a);
    const ra = score(res.code, p).rate;
    const r = reward(rb, ra, a.id);
    if (r < 0) { log.push(`[policy] rejected ${a.id} (reward ${r.toFixed(2)})`); continue; }
    steps.push({ action: a, before: res.before, after: res.after, reward: r, rateBefore: rb, rateAfter: ra, q: Q[a.id], explored: false });
    log.push(`[policy] apply ${a.id} → tests ${Math.round(rb * 100)}% → ${Math.round(ra * 100)}%  r=${r.toFixed(2)}`);
    code = res.code;
  }
  const finalRate = score(code, p).rate;
  log.push(`[done] ${finalRate === 1 ? "✔ repaired" : "✘ partial"} — ${Math.round(finalRate * 100)}% tests passing`);
  return { repaired: code, steps, episodeRewards, finalRate, initialRate, log };
}

export const PROGRAMS: Program[] = [
  {
    id: "sum", name: "sum.js", fn: "sum", description: "Sum an array of numbers",
    code: `function sum(arr) {\n  let total;\n  for (let i = 0; i <= arr.length; i++) {\n    total += arr[i];\n  }\n  return total;\n}`,
    tests: [{ args: [[1, 2, 3]], expected: 6 }, { args: [[]], expected: 0 }, { args: [[10, -4]], expected: 6 }],
  },
  {
    id: "max", name: "max.js", fn: "max", description: "Return the largest number",
    code: `function max(arr) {\n  let m = arr[0];\n  for (let i = 1; i < arr.length; i++) {\n    if (arr[i] < m) m = arr[i];\n  }\n  return m;\n}`,
    tests: [{ args: [[3, 9, 2]], expected: 9 }, { args: [[-5, -1]], expected: -1 }, { args: [[7]], expected: 7 }],
  },
  {
    id: "admin", name: "isAdmin.js", fn: "isAdmin", description: "Check a user's role",
    code: `function isAdmin(user) {\n  if (user.role = "admin") {\n    return true;\n  }\n  return false;\n}`,
    tests: [{ args: [{ role: "admin" }], expected: true }, { args: [{ role: "guest" }], expected: false }],
  },
  {
    id: "evens", name: "countEvens.js", fn: "countEvens", description: "Count even numbers 1..n",
    code: `function countEvens(n) {\n  let c = 0;\n  for (let i = 1; i <= n; i++) {\n    if (i % 2 == 1) c++;\n  }\n  return c;\n}`,
    tests: [{ args: [4], expected: 2 }, { args: [7], expected: 3 }, { args: [0], expected: 0 }],
  },
];
