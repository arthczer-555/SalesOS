// Contexte d'écriture d'une campagne, chargé UNE fois par batch : persona,
// connaissance (snapshot DB), guide de style, roster clients, expéditeur et
// modèle. Tous les prospects du batch partagent donc les mêmes blocs système,
// ce qui maximise les lectures du cache Anthropic.
import { db } from "@/lib/db";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/guides/prospection";
import { getModelPreference } from "@/lib/models/get-model-preference";
import { formatClientsRoster, loadClientsRoster } from "@/lib/watchlist/clients-roster";
import { getMailbox } from "../store/mailbox";
import { getPersona } from "../store/personas";
import { listSteps } from "../store/campaigns";
import type { CampaignRow, Persona, StepRow } from "../types";
import { loadKnowledgeForPersona, type PersonaKnowledge } from "./knowledge";
import { WRITE_MODEL_DEFAULT } from "./llm";
import { buildBaseBlocks, buildSequenceSystem, type PromptStep } from "./prompt";
import type Anthropic from "@anthropic-ai/sdk";

export interface WritingContext {
  campaign: CampaignRow;
  steps: StepRow[];
  persona: Persona | null;
  knowledge: PersonaKnowledge;
  houseStyle: string;
  roster: string;
  senderName: string;
  model: string;
}

export function toPromptSteps(steps: StepRow[]): PromptStep[] {
  return steps.map((s) => ({ position: s.position, kind: s.kind, threadMode: s.thread_mode, delayDays: s.delay_days, config: s.config }));
}

/** Nom d'expéditeur : celui de la boîte d'envoi, sinon le nom du user. */
export async function loadSender(userId: string): Promise<{ senderName: string; houseStyle: string }> {
  const [{ data: user }, { data: globalGuide }, mailbox] = await Promise.all([
    db.from("users").select("name, email, prospection_guide").eq("id", userId).maybeSingle(),
    db.from("guide_defaults").select("content").eq("key", "prospection").maybeSingle(),
    getMailbox(userId).catch(() => null),
  ]);
  const u = user as { name: string | null; email: string | null; prospection_guide: string | null } | null;
  const senderName = mailbox?.from_name?.trim() || u?.name?.trim() || u?.email?.split("@")[0] || "The Coachello team";
  const houseStyle = u?.prospection_guide ?? (globalGuide as { content: string | null } | null)?.content ?? DEFAULT_PROSPECTION_GUIDE;
  return { senderName, houseStyle };
}

export async function loadRosterText(): Promise<string> {
  try {
    return formatClientsRoster(await loadClientsRoster());
  } catch {
    return "Roster indisponible : pas de social proof client.";
  }
}

export async function loadWritingContext(campaign: CampaignRow, opts: { steps?: StepRow[]; persona?: Persona | null } = {}): Promise<WritingContext> {
  const [steps, persona, sender, roster, model] = await Promise.all([
    opts.steps ? Promise.resolve(opts.steps) : listSteps(campaign.id),
    opts.persona !== undefined ? Promise.resolve(opts.persona) : getPersona(campaign.persona_id),
    loadSender(campaign.user_id),
    loadRosterText(),
    getModelPreference("prospecting_write", WRITE_MODEL_DEFAULT),
  ]);
  const knowledge = await loadKnowledgeForPersona(persona);
  return { campaign, steps, persona, knowledge, roster, model, ...sender };
}

export function sequenceSystem(ctx: WritingContext): Anthropic.TextBlockParam[] {
  return buildSequenceSystem({
    persona: ctx.persona,
    knowledge: ctx.knowledge,
    houseStyle: ctx.houseStyle,
    campaign: {
      name: ctx.campaign.name,
      goal: ctx.campaign.goal,
      instructions: ctx.campaign.instructions,
      language: ctx.campaign.language,
      softOptOut: ctx.campaign.settings.softOptOut,
    },
    steps: toPromptSteps(ctx.steps),
    roster: ctx.roster,
    senderName: ctx.senderName,
  });
}

export function baseSystem(ctx: Pick<WritingContext, "persona" | "knowledge" | "roster">): Anthropic.TextBlockParam[] {
  return buildBaseBlocks({ persona: ctx.persona, knowledge: ctx.knowledge, roster: ctx.roster });
}
