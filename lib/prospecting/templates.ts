// Templates de séquence système, presets d'angles et métadonnées des types
// d'étapes. Module pur (libellés produit en anglais).
import { DEFAULT_STEP_CONFIG } from "./settings";
import type { AngleKey, SequenceTemplate, StepConfig, StepDraft, StepKind } from "./types";

export const STEP_KIND_META: Record<StepKind, { label: string; short: string; manual: boolean; description: string }> = {
  email: { label: "Email", short: "Email", manual: false, description: "Sent automatically from your Gmail." },
  linkedin_visit: { label: "LinkedIn profile visit", short: "Visit", manual: true, description: "Manual task: open their profile so they see you." },
  linkedin_invite: { label: "LinkedIn invitation", short: "Invite", manual: true, description: "Manual task: connect with a short note (max 300 characters)." },
  linkedin_message: { label: "LinkedIn message", short: "Message", manual: true, description: "Manual task: send a DM once connected." },
  call: { label: "Phone call", short: "Call", manual: true, description: "Manual task with an AI talk track and voicemail." },
  task: { label: "Custom task", short: "Task", manual: true, description: "Any manual action (gift, video, comment on a post...)." },
};

export const ANGLES: Record<AngleKey, { label: string; description: string; hint: string }> = {
  problem: {
    label: "Problem-first",
    description: "Name a pain they likely have before mentioning Coachello.",
    hint: "Lead with the problem, one line on how we solve it, one soft question.",
  },
  timeline: {
    label: "Case study / timeline",
    description: "How a similar company went from A to B in a given time. Best performing hook (about 10% reply).",
    hint: "Use ONLY a proof point from the persona or client roster. If none fits, fall back to problem-first.",
  },
  numbers: {
    label: "Numbers",
    description: "One sharp metric (market insight or proof point) that makes them think.",
    hint: "One number max, sourced from the persona insights or proof points.",
  },
  social_proof: {
    label: "Social proof",
    description: "Peers in their industry already work with us.",
    hint: "Cite clients from the roster in the same industry only.",
  },
  insight: {
    label: "Insight / resource",
    description: "Share a useful idea or observation, no ask beyond a light question.",
    hint: "Give value first: an idea they can use even if they never reply.",
  },
  trigger: {
    label: "Trigger event",
    description: "Anchor on something that just happened: new role, funding, hiring, post.",
    hint: "Use the strongest dated hook from the research brief.",
  },
  referral: {
    label: "Referral ask",
    description: "Ask who owns the topic if it is not them.",
    hint: "Short, humble, one question: who would be the right person?",
  },
  breakup: {
    label: "Break-up",
    description: "Last touch: close the loop politely, easy yes/no.",
    hint: "Two to three lines, no guilt, binary question, leave the door open.",
  },
  custom: {
    label: "Custom",
    description: "Your own instructions only.",
    hint: "Follow the step instructions.",
  },
};

function step(kind: StepKind, delayDays: number, config: Partial<StepConfig> = {}, threadMode: "new" | "reply" = "new"): StepDraft {
  return {
    kind,
    delayDays,
    threadMode: kind === "email" ? threadMode : "new",
    config: { ...DEFAULT_STEP_CONFIG, ...config, template: { ...DEFAULT_STEP_CONFIG.template, ...(config.template ?? {}) } },
  };
}

export const SYSTEM_TEMPLATES: SequenceTemplate[] = [
  {
    key: "sales_leaders_roleplay",
    name: "Sales leaders, AI roleplay",
    description: "8 touches over about 3 weeks. Email + LinkedIn + call, built for Heads of Sales and Enablement.",
    personaId: "sales_leaders",
    system: true,
    steps: [
      step("email", 0, { angle: "trigger", instructions: "Open on the strongest hook (hiring reps, new role, growth, post). If no hook, use 'managers have no time to coach'. Mention AI roleplays built on their ICP in one line." }),
      step("linkedin_invite", 1, { angle: "custom", instructions: "Short connection note, no pitch, refer to their sales team or a post." }),
      step("email", 2, { angle: "numbers", instructions: "Reply in thread. One market insight about quota attainment or manager coaching time, tie it to practice." }, "reply"),
      step("linkedin_message", 2, { angle: "insight", instructions: "If connected: offer to build a sample roleplay on one of their real objections." }),
      step("email", 2, { angle: "social_proof", instructions: "Reply in thread. Ramp of new hires or SKO follow-through. Social proof only from the roster." }, "reply"),
      step("call", 2, { angle: "problem", instructions: "Talk track: 20-second opener, one question about how reps practice today, ask for 15 minutes." }),
      step("email", 2, { angle: "referral", instructions: "New thread, new short subject. Ask if someone else owns enablement or rep training." }),
      step("email", 2, { angle: "breakup", instructions: "Reply in thread. Close the loop politely, binary question." }, "reply"),
    ],
  },
  {
    key: "hr_ld_coaching",
    name: "HR & L&D, coaching at scale",
    description: "7 touches over about 3 weeks. Leadership development pitch for CHROs and L&D leaders.",
    personaId: "hr_ld",
    system: true,
    steps: [
      step("email", 0, { angle: "trigger", instructions: "Open on a real signal (new role, initiative, post, growth). Name the manager development problem before Coachello." }),
      step("linkedin_invite", 1, { angle: "custom", instructions: "Short connection note, no pitch." }),
      step("email", 2, { angle: "social_proof", instructions: "Reply in thread. Peers in their industry, only from the roster." }, "reply"),
      step("email", 3, { angle: "insight", instructions: "Reply in thread. Practice over theory: how managers learn by doing (AI roleplays + coaching)." }, "reply"),
      step("linkedin_message", 1, { angle: "insight", instructions: "If connected: short DM, one idea, light question." }),
      step("call", 2, { angle: "problem", instructions: "Talk track: opener, one question about how they develop first-time managers, ask for 20 minutes." }),
      step("email", 3, { angle: "breakup", instructions: "New thread. Close the loop politely, binary question." }),
    ],
  },
  {
    key: "reengage",
    name: "Re-engage past conversations",
    description: "3 emails over about 2 weeks for closed lost deals or old conversations.",
    personaId: null,
    system: true,
    steps: [
      step("email", 0, { angle: "trigger", instructions: "Reference the past conversation lightly (from CRM history). What changed since: a new capability or a signal on their side." }),
      step("email", 4, { angle: "insight", instructions: "Reply in thread. One useful idea, light question." }, "reply"),
      step("email", 6, { angle: "breakup", instructions: "Reply in thread. Close the loop." }, "reply"),
    ],
  },
  {
    key: "quick_test",
    name: "Quick 3-email test",
    description: "A minimal sequence to test a message on a small cohort (under 50 people).",
    personaId: null,
    system: true,
    steps: [
      step("email", 0, { angle: "problem" }),
      step("email", 3, { angle: "social_proof" }, "reply"),
      step("email", 4, { angle: "breakup" }, "reply"),
    ],
  },
];

export function templateForPersona(personaId: string | null): SequenceTemplate | null {
  return SYSTEM_TEMPLATES.find((t) => t.personaId === personaId) ?? null;
}

export function cloneSteps(steps: StepDraft[]): StepDraft[] {
  return steps.map((s) => ({ ...s, id: undefined, config: { ...s.config, template: { ...s.config.template } } }));
}
