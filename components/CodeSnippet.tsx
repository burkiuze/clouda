"use client";

import { useState } from "react";

const snippets: Record<string, string> = {
  cURL: `curl https://clouda.dev/api/v1/search \\
  -H "Authorization: Bearer cld_live_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "en son yapay zeka modeli haberleri", "max_results": 5}'`,
  Node: `const res = await fetch("https://clouda.dev/api/v1/search", {
  method: "POST",
  headers: {
    Authorization: "Bearer cld_live_xxxxxxxx",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: "en son yapay zeka modeli haberleri" }),
});

const data = await res.json();
console.log(data.results);`,
  Python: `import requests

res = requests.post(
    "https://clouda.dev/api/v1/search",
    headers={"Authorization": "Bearer cld_live_xxxxxxxx"},
    json={"query": "en son yapay zeka modeli haberleri"},
)

print(res.json()["results"])`,
};

export default function CodeSnippet() {
  const tabs = Object.keys(snippets);
  const [active, setActive] = useState(tabs[0]);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#12081f]">
      <div className="flex items-center gap-1 border-b border-white/10 px-3 pt-3">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={`rounded-t-lg px-4 py-2 text-xs font-medium transition ${
              active === tab
                ? "bg-[#1d0f33] text-white"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      <pre className="overflow-x-auto p-5 text-xs leading-relaxed text-violet-100">
        <code>{snippets[active]}</code>
      </pre>
    </div>
  );
}
