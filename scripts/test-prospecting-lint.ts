// Tests du linter Prospecting (messages + séquences). Lancer : npx tsx scripts/test-prospecting-lint.ts
import { lintMessage, lintSequence, wordCount } from "../lib/prospecting/lint";
import { DEFAULT_STEP_CONFIG } from "../lib/prospecting/settings";
import { SYSTEM_TEMPLATES } from "../lib/prospecting/templates";
import type { StepDraft } from "../lib/prospecting/types";

let failed = 0;
function check(name: string, cond: boolean) {
  if (!cond) failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
}
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

// Messages
check("empty body is an error", codes(lintMessage({ kind: "email", position: 1, isReply: false, isFirstEmail: true, subject: "Hi", body: "" })).includes("empty_body"));
check("missing subject on a new email", codes(lintMessage({ kind: "email", position: 1, isReply: false, isFirstEmail: true, subject: "", body: "Hello there" })).includes("missing_subject"));
check("no subject needed in thread", !codes(lintMessage({ kind: "email", position: 2, isReply: true, isFirstEmail: false, subject: "", body: "Hello there" })).includes("missing_subject"));
check("unresolved variable blocks", lintMessage({ kind: "email", position: 1, isReply: false, isFirstEmail: true, subject: "Hi", body: "Hi {{firstName}}" }).some((i) => i.level === "error" && i.code === "unresolved_variable"));
check("[first name] token blocks", codes(lintMessage({ kind: "email", position: 1, isReply: false, isFirstEmail: true, subject: "Hi", body: "Hi [first name]," })).includes("unresolved_variable"));
check("long first email warns", codes(lintMessage({ kind: "email", position: 1, isReply: false, isFirstEmail: true, subject: "Hi", body: words(130) })).includes("long"));
check("very long first email warns too_long", codes(lintMessage({ kind: "email", position: 1, isReply: false, isFirstEmail: true, subject: "Hi", body: words(170) })).includes("too_long"));
check("filler phrase flagged", codes(lintMessage({ kind: "email", position: 2, isReply: true, isFirstEmail: false, subject: "", body: "Just checking in on my last email." })).includes("filler_followup"));
check("link in first email flagged", codes(lintMessage({ kind: "email", position: 1, isReply: false, isFirstEmail: true, subject: "Hi", body: "See https://coachello.io" })).includes("link_first_email"));
check("multiple questions flagged", codes(lintMessage({ kind: "email", position: 1, isReply: false, isFirstEmail: true, subject: "Hi", body: "A? B? C?" })).includes("multiple_ctas"));
check("spam word flagged", codes(lintMessage({ kind: "email", position: 1, isReply: false, isFirstEmail: true, subject: "Free trial", body: "Hello" })).includes("spam_words"));
check("spam word not matched inside a word", !codes(lintMessage({ kind: "email", position: 1, isReply: false, isFirstEmail: true, subject: "Freedom", body: "Hello" })).includes("spam_words"));
check("subject exclamation flagged", codes(lintMessage({ kind: "email", position: 1, isReply: false, isFirstEmail: true, subject: "Hey!", body: "Hello" })).includes("subject_exclamation"));
check("invite over 300 chars blocks", lintMessage({ kind: "linkedin_invite", position: 2, isReply: false, isFirstEmail: false, subject: null, body: "x".repeat(310) }).some((i) => i.level === "error"));
check("invite 250 chars warns", codes(lintMessage({ kind: "linkedin_invite", position: 2, isReply: false, isFirstEmail: false, subject: null, body: "x".repeat(250) })).includes("linkedin_invite_long"));
check("profile visit has no checks", lintMessage({ kind: "linkedin_visit", position: 2, isReply: false, isFirstEmail: false, subject: null, body: null }).length === 0);
check("quoted lines are not counted", wordCount("one two three\n> four five six seven") === 3);

// Séquences
const step = (kind: StepDraft["kind"], delayDays: number, angle: StepDraft["config"]["angle"] = "problem", threadMode: "new" | "reply" = "new"): StepDraft => ({
  kind,
  delayDays,
  threadMode,
  config: { ...DEFAULT_STEP_CONFIG, angle },
});
check("empty sequence is an error", lintSequence([]).issues.some((i) => i.code === "empty_sequence"));
check("sequence without email is an error", lintSequence([step("call", 0), step("task", 2)]).issues.some((i) => i.code === "no_email"));
check("two emails too close", codes(lintSequence([step("email", 0), step("email", 1, "insight", "reply")]).issues).includes("emails_too_close"));
check("repeated angle", codes(lintSequence([step("email", 0, "problem"), step("email", 3, "problem", "reply"), step("email", 4, "insight", "reply")]).issues).includes("repeated_angle"));
check("first follow-up as new thread is an info", codes(lintSequence([step("email", 0), step("email", 3, "insight")]).issues).includes("first_followup_new_thread"));
check("reply without previous email warns", codes(lintSequence([step("call", 0), step("email", 2, "problem", "reply")]).issues).includes("reply_without_thread"));
for (const t of SYSTEM_TEMPLATES) {
  const h = lintSequence(t.steps, { timezone: "Europe/Paris", days: [1, 2, 3, 4], start: "08:30", end: "17:30" });
  check(`template "${t.name}" has no error (score ${h.score})`, !h.issues.some((i) => i.level === "error") && h.score >= 70);
}

console.log(failed ? `\n${failed} test(s) failed` : "\nAll lint tests passed");
process.exit(failed ? 1 : 0);
