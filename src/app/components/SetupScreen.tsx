import { CircleAlert } from "lucide-react";

export function SetupScreen({ problems }: { problems: string[] }) {
  return (
    <main className="setup">
      <section className="card" aria-labelledby="setup-title">
        <h1 id="setup-title">Finish setting up minimi</h1>
        <p>It needs two keys before it can search and answer.</p>
        <ol>
          <li>
            Copy <code>.env.example</code> to <code>.env</code>.
          </li>
          <li>
            Add <code>OPENROUTER_API_KEY</code> and <code>TAVILY_API_KEY</code>. Tavily has a free plan.
          </li>
          <li>Reload this page. No restart needed.</li>
        </ol>
        {problems.map((problem) => (
          <div className="alert" role="alert" key={problem}>
            <CircleAlert size={18} aria-hidden="true" />
            <span>{problem}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
