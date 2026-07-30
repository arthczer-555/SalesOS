/**
 * Conversion du markdown produit par Claude vers le mrkdwn de Slack.
 *
 * Slack ne connaît ni les titres `#`, ni `**gras**`, ni `[texte](url)`, ni les
 * tableaux : sans conversion l'utilisateur lit les marqueurs bruts dans son DM.
 * Ce module est la passe unique à appliquer à tout texte LLM avant un
 * `chat.postMessage` / `chat.update`.
 *
 * Ce que Slack comprend réellement : `*gras*`, `_italique_`, `~barré~`,
 * `` `code` ``, ```` ``` ```` , `> citation`, `<url|texte>`. Tout le reste doit
 * être traduit ou aplati ici.
 */

/** Sentinelle interne pour le gras, jamais présente dans du texte Claude. */
const BOLD = "\u0001";

type Vault = string[];

function stash(vault: Vault, value: string): string {
  vault.push(value);
  return `\u0000${vault.length - 1}\u0000`;
}

function unstashAll(text: string, vault: Vault): string {
  let out = text;
  // Un tableau mis de côté peut lui-même contenir un placeholder de code
  // inline : on repasse tant qu'il reste des sentinelles (borné par sécurité).
  for (let pass = 0; pass < 3 && out.includes("\u0000"); pass++) {
    out = out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => vault[Number(i)] ?? "");
  }
  return out;
}

const BULLETS = ["•", "◦", "▪"];

/** Deux espaces de markdown = un niveau d'imbrication. */
function listLevel(indent: string): number {
  return Math.min(Math.floor(indent.replace(/\t/g, "  ").length / 2), BULLETS.length - 1);
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableDivider(line: string): boolean {
  return /^\s*\|[\s:|-]*-[\s:|-]*\|\s*$/.test(line);
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.replace(/\*\*|__|`/g, "").trim());
}

/**
 * Slack n'affiche pas les tableaux markdown (mur de `|` illisible). On les
 * rend en bloc de code : la police monospace permet d'aligner les colonnes.
 */
function renderTable(rows: string[]): string {
  const grid = rows.map(tableCells);
  const cols = Math.max(...grid.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(...grid.map((r) => (r[c] ?? "").length)),
  );
  const lines = grid.map((r) =>
    Array.from({ length: cols }, (_, c) => (r[c] ?? "").padEnd(widths[c]))
      .join("  ")
      .trimEnd(),
  );
  // Souligne l'en-tête pour qu'il se distingue des données.
  lines.splice(1, 0, widths.map((w) => "-".repeat(w)).join("  "));
  return "```\n" + lines.join("\n") + "\n```";
}

function convertTables(text: string, vault: Vault): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isTableRow(lines[i]) && isTableDivider(lines[i + 1] ?? "")) {
      const rows = [lines[i]];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) rows.push(lines[j++]);
      out.push(stash(vault, renderTable(rows)));
      i = j - 1;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** Titres, séparateurs et listes : tout ce qui se décide ligne par ligne. */
function convertBlocks(text: string): string {
  const out: string[] = [];

  for (const line of text.split("\n")) {
    // `---`, `***`, `___` : Slack n'a pas de séparateur, une ligne vide suffit.
    if (/^ {0,3}([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
      out.push("");
      continue;
    }

    // `# Titre` → `*Titre*`, précédé d'une ligne vide pour la respiration.
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*$/);
    if (heading) {
      const title = heading[1].replace(/\*\*|__/g, "").trim();
      if (out.length && out[out.length - 1].trim() !== "") out.push("");
      // Sentinelle plutôt que `*` : la passe italique retransformerait le titre
      // en `_titre_`. `convertInline` la restaure en gras à la toute fin.
      out.push(`${BOLD}${title}${BOLD}`);
      continue;
    }

    const task = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s*(.*)$/);
    if (task) {
      const box = task[2] === " " ? "☐" : "☑";
      out.push(`${"  ".repeat(listLevel(task[1]))}${box} ${task[3]}`.trimEnd());
      continue;
    }

    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) {
      const level = listLevel(bullet[1]);
      out.push(`${"  ".repeat(level)}${BULLETS[level]} ${bullet[2]}`.trimEnd());
      continue;
    }

    // Listes numérotées : Slack les rend telles quelles, on normalise juste
    // l'indentation et le `1)` en `1.`.
    const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      out.push(`${"  ".repeat(listLevel(numbered[1]))}${numbered[2]}. ${numbered[3]}`.trimEnd());
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}

/** Liens, gras, italique, barré. */
function convertInline(text: string): string {
  return (
    text
      // Liens et images markdown → `<url|texte>`. Le label est aplati : Slack
      // ne rend aucun style à l'intérieur d'un lien.
      .replace(
        /!?\[([^\]\n]*)\]\(\s*<?([^)\s]+)>?(?:\s+"[^"]*")?\s*\)/g,
        (_m, label: string, url: string) => {
          const clean = label.replace(/\*\*|__|\*|`/g, "").trim();
          return clean ? `<${url}|${clean}>` : `<${url}>`;
        },
      )
      // Gras mis sous sentinelle : sinon la passe italique reprendrait le `*x*`
      // fraîchement produit et transformerait tout le gras en italique.
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, `${BOLD}$1${BOLD}`)
      .replace(/(?<!\w)__(?=\S)([\s\S]*?\S)__(?!\w)/g, `${BOLD}$1${BOLD}`)
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "~$1~")
      // `*italique*` → `_italique_` (le `_x_` de Claude est déjà du mrkdwn).
      .replace(/(?<![\w*])\*(?=[^\s*])([^*\n]*?)\*(?![\w*])/g, "_$1_")
      .split(BOLD)
      .join("*")
  );
}

/** Slack affiche la langue d'un bloc de code comme du contenu : on la retire. */
function normalizeFence(block: string): string {
  return block.replace(/^```[^\n`]*\n/, "```\n");
}

export function toSlackMrkdwn(input: string): string {
  const vault: Vault = [];
  let text = input.replace(/\r\n/g, "\n");

  // Code d'abord : son contenu ne doit subir aucune transformation.
  text = text.replace(/```[\s\S]*?```/g, (m) => stash(vault, normalizeFence(m)));
  text = text.replace(/`[^`\n]+`/g, (m) => stash(vault, m));

  text = convertTables(text, vault);
  text = convertBlocks(text);
  text = convertInline(text);

  return unstashAll(text, vault).replace(/\n{3,}/g, "\n\n").trim();
}
