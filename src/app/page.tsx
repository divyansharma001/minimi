import { readConfig } from "@/config/env.ts";
import { ChatApp } from "./components/ChatApp.tsx";
import { SetupScreen } from "./components/SetupScreen.tsx";

// Read the environment on every request, so fixing .env and reloading works.
export const dynamic = "force-dynamic";

export default function Home() {
  const result = readConfig(process.env);
  return result.ok ? <ChatApp /> : <SetupScreen problems={result.problems} />;
}
