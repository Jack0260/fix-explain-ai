import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { PROGRAMS, repair, score, type QTable, type RepairResult } from "@/lib/rl-repair";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Reinforce — RL Code Repair Compiler" },
      { name: "description", content: "A compiler pass that learns to rewrite buggy code with reinforcement learning and explains every fix." },
      { property: "og:title", content: "Reinforce — RL Code Repair Compiler" },
      { property: "og:description", content: "Watch an RL agent repair buggy programs, with reasoning logs and human-readable explanations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Spark({ data }: { data: number[] }) {
  const max = Math.max(...data, 0.01), min = Math.min(...data, 0);
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * 100},${40 - ((v - min) / (max - min || 1)) * 36}`).join(" ");
  return (
    <svg viewBox="0 0 100 42" className="h-16 w-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" className="stroke-primary" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Code({ code, other, mark }: { code: string; other?: string | undefined; mark: "bad" | "good" }) {
  const o = other?.split("\n") ?? [];
  return (
    <pre className="panel overflow-x-auto p-4 text-sm leading-6">
      {code.split("\n").map((l, i) => (
        <div key={i} className={other !== undefined && o[i] !== l ? (mark === "bad" ? "line-bad" : "line-good") : ""}>
          <span className="mr-4 select-none text-muted-foreground">{String(i + 1).padStart(2)}</span>{l}
        </div>
      ))}
    </pre>
  );
}

function Index() {
  const [pid, setPid] = useState(PROGRAMS[0]!.id);
  const [results, setResults] = useState<Record<string, RepairResult>>({});
  const Q = useRef<QTable>({});
  const p = PROGRAMS.find((x) => x.id === pid)!;
  const r = results[pid];
  const before = useMemo(() => score(p.code, p), [p]);
  const after = r ? score(r.repaired, p) : null;

  const run = (id: string) => {
    const prog = PROGRAMS.find((x) => x.id === id)!;
    setResults((s) => ({ ...s, [id]: repair(prog, Q.current) }));
  };
  const runAll = () => { const out: Record<string, RepairResult> = {}; PROGRAMS.forEach((x) => (out[x.id] = repair(x, Q.current))); setResults(out); };

  return (
    <main className="min-h-screen px-6 py-10 md:px-12">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">rlc · repair pass v0.1</p>
          <h1 className="mt-2 text-5xl font-bold tracking-tight md:text-6xl">Reinforce<span className="text-primary">.</span></h1>
          <p className="mt-3 max-w-xl text-muted-foreground">A compiler pass that learns which rewrites fix bugs. Each action is rewarded by actually executing the test suite; a shared Q-table carries knowledge across programs.</p>
        </div>
        <button onClick={runAll} className="btn-primary">Compile & repair all</button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="flex flex-col gap-2">
          {PROGRAMS.map((x) => (
            <button key={x.id} onClick={() => setPid(x.id)} className={`tab ${x.id === pid ? "tab-active" : ""}`}>
              <span className="font-mono text-sm">{x.name}</span>
              <span className="text-xs text-muted-foreground">{x.description}</span>
              {results[x.id] && <span className={`mt-1 font-mono text-xs ${results[x.id]!.finalRate === 1 ? "text-success" : "text-destructive"}`}>{Math.round(results[x.id]!.finalRate * 100)}% pass</span>}
            </button>
          ))}
          <div className="panel mt-4 p-3 font-mono text-xs">
            <p className="mb-2 text-muted-foreground">shared Q-table</p>
            {Object.keys(Q.current).length === 0 ? <p className="text-muted-foreground">untrained</p> :
              Object.entries(Q.current).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <div key={k} className="flex justify-between"><span>{k}</span><span className={v > 0 ? "text-success" : "text-destructive"}>{v.toFixed(2)}</span></div>
              ))}
          </div>
        </nav>

        <section className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between font-mono text-xs"><span className="text-destructive">● input (buggy)</span><span className="text-muted-foreground">{Math.round(before.rate * 100)}% tests</span></div>
              <Code code={p.code} other={r?.repaired} mark="bad" />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between font-mono text-xs"><span className="text-success">● output (repaired)</span>{after && <span className="text-muted-foreground">{Math.round(after.rate * 100)}% tests</span>}</div>
              {r ? <Code code={r.repaired} other={p.code} mark="good" /> :
                <div className="panel flex h-full min-h-48 items-center justify-center p-4"><button onClick={() => run(pid)} className="btn-primary">Train agent & repair</button></div>}
            </div>
          </div>

          <div className="panel p-4">
            <p className="mb-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">Test suite</p>
            <div className="grid gap-2 font-mono text-sm">
              {p.tests.map((t, i) => (
                <div key={i} className="flex flex-wrap gap-x-4">
                  <span>{p.fn}({t.args.map((a) => JSON.stringify(a)).join(", ")}) → {JSON.stringify(t.expected)}</span>
                  <span className={before.results[i]!.ok ? "text-success" : "text-destructive"}>before: {before.results[i]!.got}</span>
                  {after && <span className={after.results[i]!.ok ? "text-success" : "text-destructive"}>after: {after.results[i]!.got}</span>}
                </div>
              ))}
            </div>
          </div>

          {r && (
            <>
              <div className="panel p-4">
                <p className="mb-4 font-mono text-xs uppercase tracking-widest text-muted-foreground">Fix explanations</p>
                {r.steps.length === 0 && <p className="text-muted-foreground">No beneficial rewrites found.</p>}
                <ol className="space-y-4">
                  {r.steps.map((s, i) => (
                    <li key={i} className="border-l-2 border-primary pl-4">
                      <p className="font-semibold">{i + 1}. {s.action.label}</p>
                      <p className="mt-1 font-mono text-sm"><span className="text-destructive line-through">{s.before}</span> → <span className="text-success">{s.after}</span></p>
                      <p className="mt-1 text-sm text-muted-foreground">{s.action.explain(s.before, s.after)}</p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">tests {Math.round(s.rateBefore * 100)}% → {Math.round(s.rateAfter * 100)}% · reward {s.reward.toFixed(2)} · Q {s.q.toFixed(2)}</p>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="grid gap-6 xl:grid-cols-[1fr_2fr]">
                <div className="panel p-4">
                  <p className="mb-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">Episode return ({r.episodeRewards.length} eps)</p>
                  <Spark data={r.episodeRewards} />
                </div>
                <div className="panel max-h-72 overflow-auto p-4 font-mono text-xs leading-5">
                  <p className="mb-2 uppercase tracking-widest text-muted-foreground">Reasoning log</p>
                  {r.log.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
                </div>
              </div>
              <button onClick={() => run(pid)} className="btn-ghost">Retrain on this program</button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
