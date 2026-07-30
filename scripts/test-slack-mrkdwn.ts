/**
 * Vérification visuelle de la conversion markdown → mrkdwn Slack.
 *   npx tsx scripts/test-slack-mrkdwn.ts
 * Affiche l'avant/après sur un échantillon couvrant titres, listes, tableaux,
 * liens, code et emphase.
 */
import { toSlackMrkdwn } from "../lib/slack/mrkdwn";

const SAMPLE = `Voici tout ce que j'ai trouvé sur Wingtra.

---

# CLIENT BRIEF - WINGTRA

## Société
- **Wingtra AG** - startup suisse spécialisée dans les drones
- Siège : Zurich, Suisse
  - Stack : Google Suite (SSO Google)
- Pas de deal HubSpot créé

### Contact côté client
1. **Anne Köhler** - Senior People Partner
2. Email : anne.koehler@wingtra.com

*(Source : HubSpot CRM)*

Voir la page [Compte Wingtra](https://notion.so/wingtra) et le guide \`notion_knowledge\`.

| Deal | Montant | Stage |
| --- | --- | --- |
| Renew 2026 | 24 000 € | **Negotiation** |
| Upsell IA | 8 000 € | Discovery |

- [x] Brief envoyé
- [ ] QBR planifié

~~Ancien contact : Leon~~

\`\`\`json
{ "amount": 24000 }
\`\`\``;

console.log("──────── AVANT (markdown Claude) ────────");
console.log(SAMPLE);
console.log("\n──────── APRÈS (mrkdwn Slack) ────────");
console.log(toSlackMrkdwn(SAMPLE));
