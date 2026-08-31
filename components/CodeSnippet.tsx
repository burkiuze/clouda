"use client";

import { useState } from "react";

const snippets: Record<string, string> = {
  cURL: `curl https://clouda.dev/api/v1/search \\
  -H "Authorization: Bearer cld_live_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "en son yapay zeka haberleri", "max_results": 5}'`,
  Node: `const res = await fetch("https://clouda.dev/api/v1/search", {
  method: "POST",
  headers: {
    Authorization: "Bearer cld_live_xxxxxxxx",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: "en son yapay zeka haberleri" }),
});

const { results, credits_remaining } = await res.json();`,
  Python: `import requests

res = requests.post(
    "https://clouda.dev/api/v1/search",
    headers={"Authorization": "Bearer cld_live_xxxxxxxx"},
    json={"query": "en son yapay zeka haberleri"},
)

print(res.json()["results"])`,
};

export default function CodeSnippet({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const tabs = Object.keys(snippets);
  const [active, setActive] = useState(tabs[0]);
  const isDark = tone === "dark";

  return (
    <div
      className={`overflow-hidden rounded-3xl ${
        isDark ? "bg-clouda-inkSoft ring-1 ring-white/10" : "bg-clouda-ink"
      }`}
    >
      <div className="flex items-center gap-1 px-3 pt-3">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={`rounded-full px-4 py-2 text-xs font-bold transition ${
              active === tab
                ? "bg-clouda-lime text-clouda-ink"
                : "text-white/40 hover:text-white/80"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      <pre className="overflow-x-auto p-6 font-mono text-[13px] leading-relaxed text-violet-100">
        <code>{snippets[active]}</code>
      </pre>
    </div>
  );
}
