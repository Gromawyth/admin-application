const {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

// =========================
// KONFIG
// =========================
const CONFIG = {
  BUG_FORUM_CHANNEL_ID: "1461015207315767428",
  BUG_SUMMARY_CHANNEL_ID: "1485746594333589657",

  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: "gpt-5-mini",

  AI_MATCH_CONFIDENCE: 0.72,
  FALLBACK_SIMILARITY_THRESHOLD: 0.58,

  MAX_OPEN_BUGS_FOR_AI: 25,
  MAX_TRAINING_EXAMPLES: 30,

  DELETE_AFTER_MS: 24 * 60 * 60 * 1000,

  TAG_NAMES: {
    OPEN: ["nyitott", "open"],
    WORKING: ["dolgozunk rajta", "folyamatban", "in progress", "working"],
    SOLVED: ["megoldás", "megoldva", "solved", "fixed", "javítva"],
    REJECTED: ["elutasítás", "elutasítva", "rejected", "invalid"],
  },
};

const DATA_FILE = path.join(__dirname, "bugreport-data.json");

const openai =
  CONFIG.OPENAI_API_KEY && !String(CONFIG.OPENAI_API_KEY).includes("IDE_IRD")
    ? new OpenAI({ apiKey: CONFIG.OPENAI_API_KEY })
    : null;

const deleteTimers = new Map();

// =========================
// JSON
// =========================
function createDefaultData() {
  return {
    bugs: {},
    trainingExamples: [],
    meta: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(createDefaultData(), null, 2));
  }
}

function loadData() {
  ensureDataFile();

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    if (!parsed.bugs || typeof parsed.bugs !== "object") {
      parsed.bugs = {};
    }

    if (!Array.isArray(parsed.trainingExamples)) {
      parsed.trainingExamples = [];
    }

    if (!parsed.meta || typeof parsed.meta !== "object") {
      parsed.meta = {
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    for (const bug of Object.values(parsed.bugs)) {
      if (!Array.isArray(bug.threads)) bug.threads = [];
      if (!bug.status) bug.status = "Nyitott";
      if (!bug.createdAt) bug.createdAt = Date.now();
      if (!bug.updatedAt) bug.updatedAt = Date.now();
      if (typeof bug.aiSummary !== "string") bug.aiSummary = bug.description || "";
      if (typeof bug.aiDecisionReason !== "string") bug.aiDecisionReason = "";
      if (!bug.lastForumFeedbackAt) bug.lastForumFeedbackAt = null;
      if (!bug.lastForumFeedbackType) bug.lastForumFeedbackType = null;
      if (!bug.threadFeedbackMessages || typeof bug.threadFeedbackMessages !== "object") {
        bug.threadFeedbackMessages = {};
      }
      if (typeof bug.lastManualReason !== "string") bug.lastManualReason = "";
    }

    return parsed;
  } catch (error) {
    console.error("[BUGREPORT] Hibás JSON, újra létrehozom:", error);
    const fresh = createDefaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function saveData(data) {
  data.meta = data.meta || {};
  data.meta.updatedAt = Date.now();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function makeBugId() {
  return `bug_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

// =========================
// SEGÉDEK
// =========================
function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function limitText(text = "", max = 1000) {
  const value = String(text || "").trim();
  if (!value) return "-";
  if (value.length <= max) return value;
  return value.slice(0, max - 3) + "...";
}

function compactText(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupShortText(text = "", max = 140) {
  let value = compactText(text);

  value = value
    .replace(/Szükséges reprodukciós lépések és környezeti adatok a hiba izolálásához\.?/gi, "Érdemes még pár részletet írni róla.")
    .replace(/nem minősül valós hibának, vagy a leírt jelenség nem reprodukálható hibaként\.?/gi, "nem tudtuk hibának elfogadni.")
    .replace(/reprodukálható/gi, "előjön")
    .replace(/nem reprodukálható/gi, "nem tudtuk előhozni")
    .replace(/izolálásához/gi, "pontosításához")
    .replace(/környezeti adatok/gi, "plusz információk")
    .replace(/fejlesztőbarát/gi, "rövid")
    .replace(/folyamatosan/gi, "többször")
    .replace(/mappból/gi, "pályáról");

  value = compactText(value);

  if (!value) return "-";
  if (value.length <= max) return value;
  return value.slice(0, max - 3) + "...";
}

function fallbackSimilarity(a = "", b = "") {
  const aa = normalizeText(a).split(" ").filter(Boolean);
  const bb = new Set(normalizeText(b).split(" ").filter(Boolean));

  if (!aa.length) return 0;

  let same = 0;
  for (const word of aa) {
    if (bb.has(word)) same++;
  }

  return same / aa.length;
}

function getThreadMentions(threadIds = []) {
  if (!Array.isArray(threadIds) || !threadIds.length) return "-";

  const unique = [...new Set(threadIds)];
  const shown = unique.slice(0, 8).map((id) => `<#${id}>`);
  const extra = unique.length > 8 ? `\n+${unique.length - 8} további bejelentés` : "";

  return shown.join("\n") + extra;
}

function getStatusStyle(status) {
  if (status === "Megoldás") {
    return { color: 0x2ecc71, emoji: "✅" };
  }

  if (status === "Elutasítás") {
    return { color: 0xe74c3c, emoji: "❌" };
  }

  if (status === "Dolgozunk rajta") {
    return { color: 0x3498db, emoji: "🛠️" };
  }

  return { color: 0xf1c40f, emoji: "⏳" };
}

function createButtons(bugId, status = "Nyitott") {
  if (status === "Megoldás") {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bug:solved:${bugId}`)
        .setLabel("Megoldás")
        .setStyle(ButtonStyle.Success)
        .setDisabled(true)
    );
  }

  if (status === "Elutasítás") {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bug:rejected:${bugId}`)
        .setLabel("Elutasítás")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true)
    );
  }

  if (status === "Dolgozunk rajta") {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bug:working:${bugId}`)
        .setLabel("Elküldve - Dolgozunk rajta")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),

      new ButtonBuilder()
        .setCustomId(`bug:solved:${bugId}`)
        .setLabel("Megoldás")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`bug:rejected:${bugId}`)
        .setLabel("Elutasítás")
        .setStyle(ButtonStyle.Danger)
    );
  }

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bug:working:${bugId}`)
      .setLabel("Dolgozunk rajta")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`bug:solved:${bugId}`)
      .setLabel("Megoldás")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`bug:rejected:${bugId}`)
      .setLabel("Elutasítás")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildBugEmbed(bug) {
  const style = getStatusStyle(bug.status);

  const summaryText = cleanupShortText(
    bug.aiSummary || bug.description || "Nincs összefoglaló.",
    220
  );

  const aiShort = cleanupShortText(
    bug.aiDecisionReason || bug.aiSummary || "Nincs rövid leírás.",
    160
  );

  const decisionText =
    bug.status === "Nyitott"
      ? "-"
      : `${bug.handler || "-"} • ${
          bug.decidedAt ? `<t:${Math.floor(bug.decidedAt / 1000)}:f>` : "-"
        }`;

  const deleteText =
    bug.deleteAt && (bug.status === "Megoldás" || bug.status === "Elutasítás")
      ? `<t:${Math.floor(bug.deleteAt / 1000)}:R>`
      : "-";

  return new EmbedBuilder()
    .setTitle(`${style.emoji} BUG: ${limitText(bug.canonicalTitle || bug.title, 200)}`)
    .setDescription(limitText(summaryText, 4000))
    .addFields(
      {
        name: "📊 Jelentések száma",
        value: String((bug.threads || []).length),
        inline: true,
      },
      {
        name: "📌 Állapot",
        value: bug.status || "Nyitott",
        inline: true,
      },
      {
        name: "👤 Kezelő",
        value: bug.handler || "-",
        inline: true,
      },
      {
        name: "🧠 AI rövid leírás",
        value: aiShort,
        inline: false,
      },
      {
        name: "🔗 Kapcsolódó fórumbejegyzések",
        value: getThreadMentions(bug.threads || []),
        inline: false,
      },
      {
        name: "🕒 Létrehozva",
        value: bug.createdAt ? `<t:${Math.floor(bug.createdAt / 1000)}:f>` : "-",
        inline: true,
      },
      {
        name: "🛠️ Elbírálva",
        value: decisionText,
        inline: true,
      },
      {
        name: "🗑️ Törlés",
        value: deleteText,
        inline: true,
      }
    )
    .setColor(style.color)
    .setFooter({
      text: `Bug ID: ${bug.id}`,
    })
    .setTimestamp(new Date(bug.updatedAt || Date.now()));
}

function buildForumFeedbackEmbed({ status, reason, handlerTag, bug }) {
  const style = getStatusStyle(status);
  const deleteTimeText =
    bug.deleteAt && (status === "Megoldás" || status === "Elutasítás")
      ? `<t:${Math.floor(bug.deleteAt / 1000)}:R>`
      : "nincs ütemezve";

  let title = "Bug állapot frissítve";
  let description = "A bejelentést átnéztük, és frissítettük az állapotát.";
  let extraInfo = "A thread jelenleg nyitva marad.";

  if (status === "Megoldás") {
    title = "✅ Bejelentés lezárva • Megoldás";
    description =
      "Átnéztük a bejelentést, és a jelzett hibát megoldottnak jelöltük. Köszönjük, hogy jelezted, ezzel sokat segítettél a szerver javításában.";
    extraInfo = `A fórumbejegyzés archiválva lett, és ${deleteTimeText} törölve lesz.`;
  } else if (status === "Elutasítás") {
    title = "❌ Bejelentés lezárva • Elutasítás";
    description =
      "Átnéztük a bejelentést, de ezt most nem tudtuk hibaként elfogadni. Ettől függetlenül köszönjük a jelzést, mert segít pontosabban átnézni a hasonló eseteket is.";
    extraInfo = `A fórumbejegyzés archiválva lett, és ${deleteTimeText} törölve lesz.`;
  } else if (status === "Dolgozunk rajta") {
    title = "🛠️ Bejelentés állapota • Dolgozunk rajta";
    description =
      "Láttuk a bejelentést, átnéztük az első részleteket, és már foglalkozunk vele. Ha végleges döntés születik, ugyanebben a fórumban külön jelezni fogjuk.";
    extraInfo = "A thread egyelőre nyitva marad, hogy a végleges döntésig visszanézhető legyen.";
  }

  return new EmbedBuilder()
    .setColor(style.color)
    .setTitle(title)
    .setDescription(description)
    .addFields(
      {
        name: "📌 Állapot",
        value: status,
        inline: true,
      },
      {
        name: "👤 Kezelte",
        value: handlerTag || "Staff",
        inline: true,
      },
      {
        name: "🕒 Frissítve",
        value: `<t:${Math.floor(Date.now() / 1000)}:f>`,
        inline: true,
      },
      {
        name: "📝 Indoklás",
        value: limitText(reason || "-", 1024),
        inline: false,
      },
      {
        name: "ℹ️ Tájékoztatás",
        value: extraInfo,
        inline: false,
      }
    )
    .setFooter({
      text: `Bug ID: ${bug.id}`,
    })
    .setTimestamp(new Date());
}

function getForumFeedbackRecord(bug, threadId) {
  if (!bug.threadFeedbackMessages || typeof bug.threadFeedbackMessages !== "object") {
    bug.threadFeedbackMessages = {};
  }

  if (!bug.threadFeedbackMessages[threadId] || typeof bug.threadFeedbackMessages[threadId] !== "object") {
    bug.threadFeedbackMessages[threadId] = {};
  }

  return bug.threadFeedbackMessages[threadId];
}

async function deleteTrackedThreadMessage(thread, messageId) {
  if (!thread || !messageId) return;
  const oldMsg = await thread.messages.fetch(messageId).catch(() => null);
  if (oldMsg) {
    await oldMsg.delete().catch(() => null);
  }
}

function createDecisionModal(action, bugId) {
  const titleMap = {
    solved: "Bug elbírálása • Megoldás",
    rejected: "Bug elbírálása • Elutasítás",
  };

  const input = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Indoklás (nem kötelező)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(800)
    .setPlaceholder(
      action === "solved"
        ? "Pl.: A hibát javítottuk, a frissítés kikerült, már nem jelentkezik."
        : "Pl.: Ezt nem tudtuk hibaként elfogadni, mert már javítva volt vagy nem volt reprodukálható a jelenség."
    );

  return new ModalBuilder()
    .setCustomId(`bugmodal:${action}:${bugId}`)
    .setTitle(titleMap[action] || "Bug elbírálása")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

// =========================
// TANULÁSI PÉLDÁK
// =========================
function addTrainingExample(data, bug, status) {
  if (!Array.isArray(data.trainingExamples)) {
    data.trainingExamples = [];
  }

  const example = {
    title: bug.canonicalTitle || bug.title || "Ismeretlen bug",
    summary: cleanupShortText(bug.aiSummary || bug.description || "", 220),
    status,
    decisionReason: cleanupShortText(bug.aiDecisionReason || "", 220),
    createdAt: Date.now(),
  };

  const duplicateIndex = data.trainingExamples.findIndex(
    (item) =>
      normalizeText(item.title) === normalizeText(example.title) &&
      normalizeText(item.summary) === normalizeText(example.summary) &&
      item.status === example.status
  );

  if (duplicateIndex !== -1) {
    data.trainingExamples[duplicateIndex] = example;
  } else {
    data.trainingExamples.push(example);
  }

  if (data.trainingExamples.length > 200) {
    data.trainingExamples = data.trainingExamples.slice(-200);
  }
}

function getRecentTrainingExamples(data) {
  if (!Array.isArray(data.trainingExamples)) return [];
  return data.trainingExamples.slice(-CONFIG.MAX_TRAINING_EXAMPLES);
}

// =========================
// AI
// =========================
async function aiGroupBug({ title, description, openBugs, trainingExamples }) {
  if (!openai) return null;

  const candidates = openBugs
    .slice(0, CONFIG.MAX_OPEN_BUGS_FOR_AI)
    .map((bug) => ({
      id: bug.id,
      title: bug.canonicalTitle || bug.title,
      summary: cleanupShortText(bug.aiSummary || bug.description || "", 220),
      reports: (bug.threads || []).length,
    }));

  const examples = trainingExamples.slice(-CONFIG.MAX_TRAINING_EXAMPLES);

  const prompt = `
Te egy Discord bugrendszer segédje vagy.

Feladat:
- döntsd el, hogy az új hibajelentés ugyanahhoz a meglévő NYITOTT bughoz tartozik-e
- ha igen, add vissza a meglévő bug id-ját
- ha nem, a matchBugId legyen null
- a summary legyen nagyon rövid, egyszerű magyar szöveg
- a decisionReason legyen rövid, hétköznapi, könnyen érthető magyar szöveg
- a canonicalTitle legyen rövid és tiszta

Fontos:
- ne használj bonyolult vagy technikai szavakat
- ne írj okoskodó stílusban
- ne használd azt, hogy reprodukálható / nem reprodukálható
- maximum 1 rövid mondat summary
- maximum 1 rövid mondat decisionReason

Korábbi példák:
${JSON.stringify(examples, null, 2)}

Új bug:
Cím: ${title}
Leírás: ${description}

Meglévő nyitott bugok:
${JSON.stringify(candidates, null, 2)}

Csak JSON-t adj vissza:
{
  "matchBugId": "bug_xxx" vagy null,
  "confidence": 0 és 1 közötti szám,
  "canonicalTitle": "rövid bugcím",
  "summary": "rövid egyszerű összefoglaló",
  "decisionReason": "rövid egyszerű leírás"
}
`;

  try {
    const response = await openai.responses.create({
      model: CONFIG.OPENAI_MODEL,
      input: prompt,
      reasoning: { effort: "low" },
    });

    const text = (response.output_text || "").trim();
    if (!text) return null;

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) return null;

    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));

    return {
      matchBugId: parsed.matchBugId || null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      canonicalTitle: limitText(parsed.canonicalTitle || title, 180),
      summary: cleanupShortText(parsed.summary || description || title, 220),
      decisionReason: cleanupShortText(
        parsed.decisionReason || "A hibajelentés feldolgozva.",
        140
      ),
    };
  } catch (error) {
    console.error("[BUGREPORT] AI grouping hiba:", error?.message || error);
    return null;
  }
}

function getFallbackDecisionReason(status, manualReason) {
  const note = compactText(manualReason || "");

  if (status === "Megoldás") {
    return note
      ? `Átnéztük a bejelentést, és a jelzett hibát javítottnak jelöltük. ${note} Köszönjük, hogy jelezted, ezzel sokat segítettél.`
      : "Átnéztük a bejelentést, és a jelzett hibát javítottnak jelöltük. A probléma már nem jelentkezik a jelenlegi állapot szerint. Köszönjük, hogy jelezted, ezzel sokat segítettél.";
  }

  if (status === "Elutasítás") {
    return note
      ? `Átnéztük a bejelentést, de ezt most nem tudtuk hibaként elfogadni. ${note} Ettől függetlenül köszönjük a jelzést, mert segít pontosabban átnézni a hasonló eseteket is.`
      : "Átnéztük a bejelentést, de ezt most nem tudtuk hibaként elfogadni. Előfordulhat, hogy a jelzett jelenség már megoldódott, nem áll fenn, vagy nem hiba okozta. Ettől függetlenül köszönjük a jelzést.";
  }

  return note
    ? `Átnéztük a bejelentést, és már foglalkozunk vele. ${note} Ha végleges döntés születik, ugyanebben a fórumban jelezni fogjuk.`
    : "Átnéztük a bejelentést, és már foglalkozunk vele. A jelenlegi információk alapján további ellenőrzést igényel, ezért még nem zártuk le. Ha végleges döntés születik, ugyanebben a fórumban jelezni fogjuk.";
}

async function aiDecisionReason({ bug, status, trainingExamples, manualReason = "" }) {
  const fallback = getFallbackDecisionReason(status, manualReason);

  if (!openai) {
    return fallback;
  }

  const examples = trainingExamples.slice(-15);

  const prompt = `
Te egy Discord bugkezelő rendszer kedves, rövid magyar válaszgenerátora vagy.

Feladat:
- írj 2-3 rövid magyar mondatot
- legyen barátságos, szimpatikus, normális hangnemű
- ne legyen túl hivatalos
- ne legyen túl hosszú
- könnyen érthető legyen
- ha van staff indoklás, használd fel természetesen
- ha nincs staff indoklás, akkor adj életszerű rövid okot
- ne használj felsorolást
- ne írj megszólítást a játékos nevével
- ne írj aláírást

Korábbi példák:
${JSON.stringify(examples, null, 2)}

Állapot: ${status}
Bug címe: ${bug.canonicalTitle || bug.title}
Bug összefoglaló: ${bug.aiSummary || bug.description || ""}
Bug eredeti leírás: ${bug.description || ""}
Staff indoklás: ${manualReason || "nincs megadva"}

A válasz csak maga a szöveg legyen.
`;

  try {
    const response = await openai.responses.create({
      model: CONFIG.OPENAI_MODEL,
      input: prompt,
      reasoning: { effort: "low" },
    });

    const text = compactText(response.output_text || "");
    if (!text) return fallback;
    return limitText(text, 700);
  } catch (error) {
    console.error("[BUGREPORT] AI decision reason hiba:", error?.message || error);
    return fallback;
  }
}

// =========================
// BUG KERESÉS
// =========================
function fallbackFindMatch(data, title, description) {
  const newText = `${title} ${description}`.trim();

  let bestId = null;
  let bestScore = 0;

  for (const bug of Object.values(data.bugs)) {
    if (!["Nyitott", "Dolgozunk rajta"].includes(bug.status)) continue;

    const existingText =
      `${bug.canonicalTitle || bug.title} ${bug.aiSummary || bug.description || ""}`.trim();

    const score = Math.max(
      fallbackSimilarity(title, bug.canonicalTitle || bug.title),
      fallbackSimilarity(newText, existingText)
    );

    if (score > bestScore) {
      bestScore = score;
      bestId = bug.id;
    }
  }

  if (bestScore >= CONFIG.FALLBACK_SIMILARITY_THRESHOLD) {
    return { bugId: bestId, confidence: bestScore };
  }

  return { bugId: null, confidence: 0 };
}

async function classifyBug(data, title, description) {
  const openBugs = Object.values(data.bugs)
    .filter((bug) => ["Nyitott", "Dolgozunk rajta"].includes(bug.status))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const aiResult = await aiGroupBug({
    title,
    description,
    openBugs,
    trainingExamples: getRecentTrainingExamples(data),
  });

  if (
    aiResult &&
    aiResult.matchBugId &&
    aiResult.confidence >= CONFIG.AI_MATCH_CONFIDENCE &&
    data.bugs[aiResult.matchBugId] &&
    ["Nyitott", "Dolgozunk rajta"].includes(data.bugs[aiResult.matchBugId].status)
  ) {
    return {
      type: "match",
      bugId: aiResult.matchBugId,
      canonicalTitle: aiResult.canonicalTitle,
      summary: aiResult.summary,
      decisionReason: aiResult.decisionReason,
      confidence: aiResult.confidence,
      source: "ai",
    };
  }

  const fallback = fallbackFindMatch(data, title, description);
  if (fallback.bugId) {
    return {
      type: "match",
      bugId: fallback.bugId,
      canonicalTitle: title,
      summary: cleanupShortText(description || title, 220),
      decisionReason: "Hasonlít egy meglévő hibára.",
      confidence: fallback.confidence,
      source: "fallback",
    };
  }

  return {
    type: "new",
    bugId: null,
    canonicalTitle: aiResult?.canonicalTitle || title,
    summary: cleanupShortText(aiResult?.summary || description || title, 220),
    decisionReason: cleanupShortText(
      aiResult?.decisionReason || "Új hibaként lett felvéve.",
      140
    ),
    confidence: aiResult?.confidence || 0,
    source: aiResult ? "ai_no_match" : "fallback_new",
  };
}

// =========================
// TÖRLÉS
// =========================
async function deleteBugAndThreads(client, bugId) {
  const data = loadData();
  const bug = data.bugs[bugId];
  if (!bug) return;

  try {
    const summaryChannel = await client.channels
      .fetch(CONFIG.BUG_SUMMARY_CHANNEL_ID)
      .catch(() => null);

    if (summaryChannel && bug.messageId) {
      const msg = await summaryChannel.messages.fetch(bug.messageId).catch(() => null);
      if (msg) {
        await msg.delete().catch(() => null);
      }
    }

    for (const threadId of bug.threads || []) {
      const thread = await client.channels.fetch(threadId).catch(() => null);
      if (thread) {
        await thread.delete().catch(() => null);
      }
    }
  } catch (error) {
    console.error("[BUGREPORT] Törlési hiba:", error);
  }

  const latest = loadData();
  if (latest.bugs[bugId]) {
    delete latest.bugs[bugId];
    saveData(latest);
  }

  if (deleteTimers.has(bugId)) {
    clearTimeout(deleteTimers.get(bugId));
    deleteTimers.delete(bugId);
  }
}

function scheduleDeletion(client, bugId, deleteAt) {
  if (!deleteAt) return;

  if (deleteTimers.has(bugId)) {
    clearTimeout(deleteTimers.get(bugId));
    deleteTimers.delete(bugId);
  }

  const delay = Math.max(0, deleteAt - Date.now());

  const timer = setTimeout(async () => {
    await deleteBugAndThreads(client, bugId);
  }, delay);

  deleteTimers.set(bugId, timer);
}

function clearDeletionSchedule(bugId) {
  if (deleteTimers.has(bugId)) {
    clearTimeout(deleteTimers.get(bugId));
    deleteTimers.delete(bugId);
  }
}

function restoreDeletionSchedules(client) {
  const data = loadData();

  for (const bug of Object.values(data.bugs)) {
    if (bug.deleteAt && (bug.status === "Megoldás" || bug.status === "Elutasítás")) {
      scheduleDeletion(client, bug.id, bug.deleteAt);
    }
  }
}

// =========================
// CÍMKÉK / THREAD ÁLLAPOT
// =========================
function getStatusTagKeywords(status) {
  if (status === "Megoldás") return CONFIG.TAG_NAMES.SOLVED;
  if (status === "Elutasítás") return CONFIG.TAG_NAMES.REJECTED;
  if (status === "Dolgozunk rajta") return CONFIG.TAG_NAMES.WORKING;
  return CONFIG.TAG_NAMES.OPEN;
}

function findForumTagIdByKeywords(parentChannel, keywords = []) {
  if (!parentChannel?.availableTags?.length) return null;

  const normalizedKeywords = keywords.map((k) => normalizeText(k));

  const tag = parentChannel.availableTags.find((t) =>
    normalizedKeywords.includes(normalizeText(t.name))
  );

  return tag?.id || null;
}

async function applyThreadStatusTag(thread, status) {
  if (!thread || !thread.parentId) return;

  const parent = await thread.guild.channels.fetch(thread.parentId).catch(() => null);
  if (!parent?.availableTags?.length) return;

  const allKnownKeywords = [
    ...CONFIG.TAG_NAMES.OPEN,
    ...CONFIG.TAG_NAMES.WORKING,
    ...CONFIG.TAG_NAMES.SOLVED,
    ...CONFIG.TAG_NAMES.REJECTED,
  ].map((x) => normalizeText(x));

  const removableTagIds = parent.availableTags
    .filter((tag) => allKnownKeywords.includes(normalizeText(tag.name)))
    .map((tag) => tag.id);

  const targetTagId = findForumTagIdByKeywords(parent, getStatusTagKeywords(status));

  let current = Array.isArray(thread.appliedTags) ? [...thread.appliedTags] : [];
  current = current.filter((id) => !removableTagIds.includes(id));

  if (targetTagId) {
    current.push(targetTagId);
  }

  const unique = [...new Set(current)];
  await thread.setAppliedTags(unique).catch(() => null);
}

async function syncThreadState(thread, status) {
  if (!thread) return;

  if (status === "Dolgozunk rajta" || status === "Nyitott") {
    await thread.setArchived(false).catch(() => null);
    await thread.setLocked(false).catch(() => null);
    return;
  }

  if (status === "Megoldás" || status === "Elutasítás") {
    await thread.setLocked(true).catch(() => null);
    await thread.setArchived(true).catch(() => null);
  }
}

// =========================
// DISCORD
// =========================
async function updateSummaryMessage(client, bug) {
  const summaryChannel = await client.channels.fetch(CONFIG.BUG_SUMMARY_CHANNEL_ID).catch(() => null);
  if (!summaryChannel) return null;

  const payload = {
    embeds: [buildBugEmbed(bug)],
    components: [createButtons(bug.id, bug.status)],
  };

if (bug.messageId) {
  const oldMsg = await summaryChannel.messages.fetch(bug.messageId).catch(() => null);

  if (oldMsg) {
    return await oldMsg.edit(payload).catch(() => null);
  }
}

return await summaryChannel.send(payload).catch(() => null);
}

async function sendFeedbackToAllThreads(client, bug, status, reason, handlerTag) {
  for (const threadId of bug.threads || []) {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (!thread) continue;

    const record = getForumFeedbackRecord(bug, threadId);

    if ((status === "Megoldás" || status === "Elutasítás") && record.workingMessageId) {
      await deleteTrackedThreadMessage(thread, record.workingMessageId);
      record.workingMessageId = null;
    }

    const embed = buildForumFeedbackEmbed({
      status,
      reason,
      handlerTag,
      bug,
    });

    const sent = await thread.send({ embeds: [embed] }).catch(() => null);
    if (!sent) {
      await applyThreadStatusTag(thread, status);
      await syncThreadState(thread, status);
      continue;
    }

    if (status === "Dolgozunk rajta") {
      if (record.workingMessageId && record.workingMessageId !== sent.id) {
        await deleteTrackedThreadMessage(thread, record.workingMessageId);
      }
      record.workingMessageId = sent.id;
    } else {
      if (record.finalMessageId && record.finalMessageId !== sent.id) {
        await deleteTrackedThreadMessage(thread, record.finalMessageId);
      }
      record.finalMessageId = sent.id;
    }

    await applyThreadStatusTag(thread, status);
    await syncThreadState(thread, status);
  }
}

async function processNewForumThread(client, thread) {
  if (!thread || thread.parentId !== CONFIG.BUG_FORUM_CHANNEL_ID) return;
  if (thread.type !== ChannelType.PublicThread) return;

  let starterMessage = null;
  try {
    starterMessage = await thread.fetchStarterMessage();
  } catch {
    starterMessage = null;
  }

  const title = limitText(thread.name || "Ismeretlen bug", 180);
  const description = limitText(
    starterMessage?.content ||
      starterMessage?.cleanContent ||
      "Nincs leírás megadva.",
    1500
  );

  const data = loadData();
  const result = await classifyBug(data, title, description);

  if (result.type === "match" && result.bugId && data.bugs[result.bugId]) {
    const bug = data.bugs[result.bugId];

    if (!bug.threads.includes(thread.id)) {
      bug.threads.push(thread.id);
    }

    bug.updatedAt = Date.now();

    if (!bug.threadFeedbackMessages || typeof bug.threadFeedbackMessages !== "object") {
      bug.threadFeedbackMessages = {};
    }

    if (result.source === "ai") {
      bug.canonicalTitle = result.canonicalTitle || bug.canonicalTitle || bug.title;
      bug.aiSummary = result.summary || bug.aiSummary || bug.description;
      bug.aiDecisionReason = result.decisionReason || bug.aiDecisionReason;
    }

    const msg = await updateSummaryMessage(client, bug);
    if (msg) {
      bug.messageId = msg.id;
    }

    saveData(data);

    await applyThreadStatusTag(thread, bug.status);
    await syncThreadState(thread, bug.status);

    if (bug.status === "Dolgozunk rajta") {
      await sendFeedbackToAllThreads(
        client,
        bug,
        "Dolgozunk rajta",
        bug.aiDecisionReason || "Átnéztük, és dolgozunk rajta.",
        bug.handler || "Staff"
      );
      saveData(data);
    }

    return;
  }

  const bugId = makeBugId();

  const bug = {
    id: bugId,
    title,
    canonicalTitle: result.canonicalTitle || title,
    description,
    aiSummary: cleanupShortText(result.summary || description, 220),
    aiDecisionReason: cleanupShortText(
      result.decisionReason || "Új hibaként lett felvéve.",
      140
    ),
    threads: [thread.id],
    status: "Nyitott",
    handler: null,
    messageId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    decidedAt: null,
    deleteAt: null,
    lastForumFeedbackAt: null,
    lastForumFeedbackType: null,
    lastManualReason: "",
    threadFeedbackMessages: {},
  };

  data.bugs[bugId] = bug;

  const msg = await updateSummaryMessage(client, bug);
  if (msg) {
    bug.messageId = msg.id;
  }

  saveData(data);
  await applyThreadStatusTag(thread, "Nyitott");
}

async function handleStatusChange(client, interaction, bugId, status, manualReason = "") {
  const shouldDefer =
    typeof interaction.deferReply === "function" &&
    !interaction.deferred &&
    !interaction.replied;

  if (shouldDefer) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const data = loadData();
  const bug = data.bugs[bugId];

  if (!bug) {
    const payload = { content: "Ez a bug már nem található." };

    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(payload);
    }

    return interaction.reply({
      ...payload,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!bug.threadFeedbackMessages || typeof bug.threadFeedbackMessages !== "object") {
    bug.threadFeedbackMessages = {};
  }

  const finalStatuses = ["Megoldás", "Elutasítás"];
  const wasFinal = finalStatuses.includes(bug.status);
  const isFinal = finalStatuses.includes(status);

  const reason = await aiDecisionReason({
    bug,
    status,
    trainingExamples: getRecentTrainingExamples(data),
    manualReason,
  });

  bug.status = status;
  bug.handler = interaction.user?.tag || bug.handler || "Staff";
  bug.aiDecisionReason = limitText(reason, 700);
  bug.lastManualReason = compactText(manualReason || "");
  bug.decidedAt = Date.now();
  bug.updatedAt = Date.now();
  bug.lastForumFeedbackAt = Date.now();
  bug.lastForumFeedbackType = status;

  if (isFinal) {
    bug.deleteAt = Date.now() + CONFIG.DELETE_AFTER_MS;
    addTrainingExample(data, bug, status);
  } else {
    bug.deleteAt = null;
    clearDeletionSchedule(bug.id);
  }

  const msg = await updateSummaryMessage(client, bug);
if (msg) {
  bug.messageId = msg.id;
}

await sendFeedbackToAllThreads(
  client,
  bug,
  status,
  bug.aiDecisionReason,
  interaction.user?.tag || "Staff"
);

saveData(data);

  if (isFinal) {
    scheduleDeletion(client, bug.id, bug.deleteAt);
  } else if (wasFinal && !isFinal) {
    clearDeletionSchedule(bug.id);
  }

  const replyTextMap = {
    "Megoldás": "A bug állapota sikeresen **Megoldás** lett. A fórumok frissítve, archiválva és időzítve lettek.",
    "Elutasítás": "A bug állapota sikeresen **Elutasítás** lett. A fórumok frissítve, archiválva és időzítve lettek.",
    "Dolgozunk rajta": "A bug állapota sikeresen **Dolgozunk rajta** lett. A fórumok frissítve lettek.",
  };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({
      content: replyTextMap[status] || "A bug állapota frissítve lett.",
    });
  }

  return interaction.reply({
    content: replyTextMap[status] || "A bug állapota frissítve lett.",
    flags: MessageFlags.Ephemeral,
  });
}

function parseBugInteraction(customId) {
  if (!customId) return { action: null, bugId: null };

  if (customId.startsWith("bug:")) {
    const parts = customId.split(":");
    return {
      action: parts[1] || null,
      bugId: parts.slice(2).join(":"),
    };
  }

  if (customId.startsWith("bug_")) {
    const parts = customId.split("_");
    return {
      action: parts[1] || null,
      bugId: parts.slice(2).join("_"),
    };
  }

  return { action: null, bugId: null };
}

function parseBugModal(customId) {
  if (!customId?.startsWith("bugmodal:")) {
    return { action: null, bugId: null };
  }

  const parts = customId.split(":");
  return {
    action: parts[1] || null,
    bugId: parts.slice(2).join(":"),
  };
}

// =========================
// REGISZTRÁLÁS
// =========================
function registerBugReport(client) {
  client.once("ready", async () => {
    console.log("[BUGREPORT] Bugreport modul betöltve.");
    restoreDeletionSchedules(client);
  });

  client.on("threadCreate", async (thread) => {
    try {
      await processNewForumThread(client, thread);
    } catch (error) {
      console.error("[BUGREPORT] threadCreate hiba:", error);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isButton()) {
        if (!interaction.customId.startsWith("bug:") && !interaction.customId.startsWith("bug_")) {
          return;
        }

        const { action, bugId } = parseBugInteraction(interaction.customId);

        if (!bugId) {
          return interaction.reply({
            content: "Hibás gombazonosító.",
            flags: MessageFlags.Ephemeral,
          });
        }

        // Working: azonnal mehet, nincs modal
        if (action === "working") {
          return await handleStatusChange(client, interaction, bugId, "Dolgozunk rajta");
        }

        // Solved / Rejected: modal nyílik
        if (action === "solved" || action === "rejected") {
          const modal = createDecisionModal(action, bugId);
          return await interaction.showModal(modal);
        }

        return interaction.reply({
          content: "Ismeretlen bug gomb.",
          flags: MessageFlags.Ephemeral,
        });
      }

      // MODAL
      if (interaction.isModalSubmit()) {
        if (!interaction.customId.startsWith("bugmodal:")) return;

        const { action, bugId } = parseBugModal(interaction.customId);

        if (!bugId) {
          return interaction.reply({
            content: "Hibás modal azonosító.",
            flags: MessageFlags.Ephemeral,
          });
        }

        const manualReason = compactText(
          interaction.fields.getTextInputValue("reason") || ""
        );

        if (action === "solved") {
          return await handleStatusChange(
            client,
            interaction,
            bugId,
            "Megoldás",
            manualReason
          );
        }

        if (action === "rejected") {
          return await handleStatusChange(
            client,
            interaction,
            bugId,
            "Elutasítás",
            manualReason
          );
        }

        return interaction.reply({
          content: "Ismeretlen modal művelet.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      console.error("[BUGREPORT] interactionCreate hiba:", error);

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: "Hiba történt a művelet közben.",
          });
        } else if (interaction.isRepliable()) {
          await interaction.reply({
            content: "Hiba történt a művelet közben.",
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch {}
    }
  });
}

module.exports = { registerBugReport };