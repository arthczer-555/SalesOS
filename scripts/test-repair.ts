/**
 * Test unitaire de `repairAnalysis` sur les patterns de corruption Haiku
 * documentés. Aucune mutation de DB ici.
 */
import { repairAnalysis, type SalesCoachAnalysis } from "../lib/guides/sales-coach";

function expect<T>(label: string, actual: T, predicate: (v: T) => boolean) {
  const ok = predicate(actual);
  console.log(`${ok ? "PASS" : "FAIL"} : ${label}`);
  if (!ok) console.log(`        actual = ${JSON.stringify(actual)?.slice(0, 200)}`);
  return ok;
}

console.log("\n--- TEST 1: multi-key blob (Servier-shaped corruption) ---");
const blob = `[
  "Explorer le budget exact avant mardi.",
  "Créer un decision matrix pondéré.",
  "Proposer un success dashboard ROI."
],
  "key_moments": [
    {"timestamp_seconds": 120, "kind": "engagement", "label": "Prise d'ownership", "quote": "Je suis dédiée..."},
    {"timestamp_seconds": 1440, "kind": "pivot", "label": "Vrai besoin", "quote": "L'idée c'est..."}
  ],
  "risks": [
    "Budget holder non identifié, risque de delay.",
    "Compétition directe avec un autre prestataire."
  ],
  "strengths": [
    "Opening structuré et respectueux, agenda co-construit.",
    "Écoute active et rebonds pertinents.",
    "Compréhension claire du contexte métier."
  ],
  "weaknesses": [
    "Zéro exploration du budget.",
    "Pas de challenge sur les vraies objections.",
    "Absence d'armement du champion."
  ]
}`;
const corrupted1: Partial<SalesCoachAnalysis> = {
  meeting_kind: "discovery_deeper",
  summary: "Discovery solide mais zéro budget exploré.",
  coaching_priorities: [blob],
};
const repaired1 = repairAnalysis(corrupted1);
expect("coaching_priorities recovered to 3", repaired1.coaching_priorities, (v) => Array.isArray(v) && v.length === 3);
expect("strengths recovered to 3", repaired1.strengths, (v) => Array.isArray(v) && v.length === 3);
expect("weaknesses recovered to 3", repaired1.weaknesses, (v) => Array.isArray(v) && v.length === 3);
expect("risks recovered to 2", repaired1.risks, (v) => Array.isArray(v) && v.length === 2);
expect("key_moments recovered to 2", repaired1.key_moments, (v) => Array.isArray(v) && v.length === 2);
expect("first weakness text", repaired1.weaknesses?.[0], (v) => typeof v === "string" && v.startsWith("Zéro"));

console.log("\n--- TEST 2: JS-literal-as-string with .concat() ---");
const corrupted2: Partial<SalesCoachAnalysis> = {
  coaching_priorities: [`["A", "B"].concat(["C"])`],
};
const repaired2 = repairAnalysis(corrupted2);
expect("coaching_priorities flattened to 3", repaired2.coaching_priorities, (v) => Array.isArray(v) && v.length === 3);

console.log("\n--- TEST 3: char-by-char stringified axes ---");
const axesObj = {
  opening: { score: 7, notes: "ok", evidence: "", explanation: "", recommendation: "" },
  discovery: { score: 6, notes: "ok", evidence: "", explanation: "", recommendation: "" },
};
const axesString = JSON.stringify(axesObj);
const charByChar: Record<string, string> = {};
for (let i = 0; i < axesString.length; i++) charByChar[String(i)] = axesString[i];
const corrupted3 = { axes: charByChar } as unknown as Partial<SalesCoachAnalysis>;
const repaired3 = repairAnalysis(corrupted3);
expect("axes reassembled to named object", repaired3.axes, (v) => !!v && typeof v === "object" && typeof (v as Record<string, unknown>).opening === "object");

console.log("\n--- TEST 4: tool-input leak in summary ---");
const corrupted4: Partial<SalesCoachAnalysis> = {
  summary: `Vrai resume du meeting.", "axes": { "opening": { "score": 7 } }, "meddic": { ... }`,
};
const repaired4 = repairAnalysis(corrupted4);
expect("summary leak stripped", repaired4.summary, (v) => typeof v === "string" && !v.includes("axes"));

console.log("\n--- TEST 5: clean input idempotency ---");
const clean: Partial<SalesCoachAnalysis> = {
  coaching_priorities: ["a", "b", "c"],
  strengths: ["s1", "s2"],
  summary: "Tout est OK.",
};
const repaired5 = repairAnalysis(clean);
expect("clean coaching_priorities unchanged", repaired5.coaching_priorities, (v) => JSON.stringify(v) === JSON.stringify(["a", "b", "c"]));
expect("clean strengths unchanged", repaired5.strengths, (v) => JSON.stringify(v) === JSON.stringify(["s1", "s2"]));
expect("clean summary unchanged", repaired5.summary, (v) => v === "Tout est OK.");
