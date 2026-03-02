/**
 * Gemini Pro UX Condition Analyzer
 *
 * Sends HTML to Gemini Pro API and returns structured JSON
 * listing missing UX conditions and solutions for each element.
 *
 * This runs inside the Figma plugin UI (browser context),
 * so it uses fetch() directly.
 */

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent";

const SYSTEM_PROMPT = `You are a senior UX designer. Analyze this UI HTML and find every possible missing condition or interaction state. For each element like buttons, dropdowns, forms, inputs — list what conditions are missing (empty state, error state, loading state, success state, edge cases) and provide a clear design solution for each.

Return ONLY valid JSON in this exact format, no markdown fences:
{
  "conditions": [
    {
      "element": "element name or selector",
      "missing": "what condition is missing",
      "solution": "clear design solution"
    }
  ]
}`;

async function analyzeHtml(html, apiKey) {
  if (!apiKey) throw new Error("Gemini API key is required");

  const url = `${GEMINI_ENDPOINT}?key=${apiKey}`;

  const body = {
    contents: [
      {
        parts: [
          { text: SYSTEM_PROMPT },
          { text: `\n\nHTML to analyze:\n\n${html}` },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 4096,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  // Strip markdown fences if Gemini wraps them anyway
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Return raw text wrapped so the plugin can still display it
    return {
      conditions: [
        {
          element: "Parse Error",
          missing: "Could not parse Gemini response as JSON",
          solution: cleaned,
        },
      ],
    };
  }
}
