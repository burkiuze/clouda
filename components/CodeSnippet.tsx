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

export default function CodeSnippet() {
  const tabs = Object.keys(snippets);
  const [active, setActive] = useState(tabs[0]);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-1 border-b border-clouda-border px-3 py-2.5">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={`rounded-pill px-4 py-1.5 text-xs font-medium transition ${
              active === tab
                ? "bg-clouda-sageSoft text-clouda-sageDark"
                : "text-clouda-muted hover:text-clouda-ink"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      <pre className="overflow-x-auto bg-clouda-bg/60 p-6 font-mono text-[13px] leading-relaxed text-clouda-ink">
        <code>{snippets[active]}</code>
      </pre>
    </div>
  );
}
