import { readConfig } from "@/config/env.ts";

// Read the environment on every request, so fixing .env and reloading works
// without rebuilding.
export const dynamic = "force-dynamic";

export default function Home() {
  const result = readConfig(process.env);

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 16px" }}>
      <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>minimi</h1>
      <p style={{ margin: "0 0 24px", color: "#59636e" }}>
        A chat agent with web search that remembers past chats by date.
      </p>

      {result.ok ? (
        <p style={{ margin: 0 }}>
          Setup looks good. Model: <code>{result.config.model}</code>
        </p>
      ) : (
        <div
          role="alert"
          style={{
            border: "1px solid #ffc1c0",
            background: "#fff5f5",
            borderRadius: 8,
            padding: "12px 16px",
          }}
        >
          <strong>Setup needed</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {result.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
