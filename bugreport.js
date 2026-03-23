const {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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

  // OpenAI kulcs közvetlenül a JS-ben
OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  // Modell
  OPENAI_MODEL: "gpt-5-mini",

  // Ha az AI legalább ekkora bizonyossággal mondja, hogy egyezés van, összevonjuk
  AI_MATCH_CONFIDENCE: 0.72,

  // 24 óra
  DELETE_AFTER_MS: 24 * 60 * 60 * 1000,

  // Ha az AI nem elérhető vagy hibázik, ezzel a helyi hasonlósággal próbálkozunk
  FALLBACK_SIMILARITY_THRESHOLD: 0.58,

  // Max ennyi nyitott bugot adunk át az AI-nak összehasonlításhoz
  MAX_OPEN_BUGS_FOR_AI: 25,

  // Max ennyi korábbi tanítási példát kapjon meg az AI
  MAX_TRAINING_EXAMPLES: 30,
};

const DATA_FILE = path.join(__dirname, "bugreport-data.json");

const openai =
  CONFIG.OPENAI_API_KEY && !CONFIG.OPENAI_API_KEY.includes("IDE_IRD")
    ? new OpenAI({ apiKey: CONFIG.OPENAI_API_KEY })
    : null;

const deleteTimers = new Map();

// =========================
// JSON KEZELÉS
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
// SEGÉD FÜGGVÉNYEK
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

function createButtons(bugId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bug_accept_${bugId}`)
      .setLabel("Megoldva")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`bug_reject_${bugId}`)
      .setLabel("Elutasítva")
      .setStyle(ButtonStyle.Danger)
  );
}

function getStatusStyle(status) {
  if (status === "Megoldva") {
    return { color: 0x2ecc71, emoji: "✅" };
  }

  if (status === "Elutasítva") {
    return { color: 0xe74c3c, emoji: "❌" };
  }

  return { color: 0xf1c40f, emoji: "⏳" };
}

function buildBugEmbed(bug) {
  const style = getStatusStyle(bug.status);

  const summaryText = bug.aiSummary || bug.description || "Nincs összefoglaló.";
  const decisionText =
    bug.status === "Nyitott"
      ? "-"
      : `${bug.handler || "-"} • ${
          bug.decidedAt ? `<t:${Math.floor(bug.decidedAt / 1000)}:f>` : "-"
        }`;

  const deleteText =
    bug.deleteAt && bug.status !== "Nyitott"
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
        value: limitText(bug.aiDecisionReason || bug.aiSummary || "-", 1000),
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

function makeDecisionMessage({ accepted, reason, handlerTag }) {
  if (accepted) {
    return [
      "✅ **Elfogadva**",
      "",
      "Köszönjük a visszajelzést!",
      "A hibajelentést elfogadtuk, és a problémát javítottuk.",
      "",
      `**Rövid leírás:** ${reason}`,
      `**Kezelte:** ${handlerTag}`,
      "",
      "Köszönjük, hogy segítetted a fejlesztést! 🙏",
    ].join("\n");
  }

  return [
    "❌ **Elutasítva**",
    "",
    "Köszönjük a visszajelzést!",
    "A jelentést átnéztük, de ez jelenleg nem minősül valós hibának, vagy a leírt jelenség nem reprodukálható hibaként.",
    "",
    `**Rövid leírás:** ${reason}`,
    `**Kezelte:** ${handlerTag}`,
    "",
    "Köszönjük, hogy jelezted felénk! 🙏",
  ].join("\n");
}

// =========================
// TANULÁSI PÉLDÁK
// =========================
function addTrainingExample(data, bug, accepted) {
  if (!Array.isArray(data.trainingExamples)) {
    data.trainingExamples = [];
  }

  const example = {
    title: bug.canonicalTitle || bug.title || "Ismeretlen bug",
    summary: bug.aiSummary || bug.description || "",
    status: accepted ? "Megoldva" : "Elutasítva",
    decisionReason:
      bug.aiDecisionReason ||
      (accepted
        ? "A hibajelentést elfogadtuk, és a probléma javításra került."
        : "A jelentést átnéztük, de ez nem minősül valós hibának."),
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
      summary: bug.aiSummary || bug.description || "",
      reports: (bug.threads || []).length,
    }));

  const examples = trainingExamples.slice(-CONFIG.MAX_TRAINING_EXAMPLES);

  const prompt = `
Te egy Discord bugrendszer segéd-AI vagy.

Feladat:
- állapítsd meg, hogy az új bugjelentés ugyanahhoz a bugtémához tartozik-e, mint valamelyik meglévő NYITOTT bug
- ha igen, add vissza a meglévő bug id-ját
- ha nem, akkor a matchBugId legyen null
- írj egy rövid, fejlesztőbarát magyar összefoglalót 1-3 mondatban
- írj egy rövid, természetes magyar decisionReason szöveget is
- a canonicalTitle legyen rövid, tiszta bugtéma név

Fontos:
- csak akkor vond össze ugyanabba a bugtémába, ha valóban ugyanarról a problémáról van szó
- szigorú legyél, ne vonj össze eltérő hibákat
- a korábbi példákból tanulj stílust és mintát

Korábbi döntési példák:
${JSON.stringify(examples, null, 2)}

Új bug:
Cím: ${title}
Leírás: ${description}

Meglévő nyitott bugok:
${JSON.stringify(candidates, null, 2)}

Kizárólag JSON választ adj ebben a formában:
{
  "matchBugId": "bug_xxx" vagy null,
  "confidence": 0 és 1 közötti szám,
  "canonicalTitle": "rövid bugcím",
  "summary": "rövid összefoglaló",
  "decisionReason": "rövid természetes leírás"
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

    const jsonText = text.slice(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonText);

    return {
      matchBugId: parsed.matchBugId || null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      canonicalTitle: limitText(parsed.canonicalTitle || title, 180),
      summary: limitText(parsed.summary || description || title, 900),
      decisionReason: limitText(
        parsed.decisionReason || "A hibajelentés feldolgozásra került.",
        300
      ),
    };
  } catch (error) {
    console.error("[BUGREPORT] AI grouping hiba:", error?.message || error);
    return null;
  }
}

async function aiDecisionReason({ bug, accepted, trainingExamples }) {
  if (!openai) {
    return accepted
      ? "A hibajelentést elfogadtuk, és a probléma javításra került."
      : "A jelentést átnéztük, de ez nem minősül valós hibának vagy nem reprodukálható hibaként.";
  }

  const examples = trainingExamples.slice(-15);

  const prompt = `
Te egy Discord bugkezelő rendszer rövid magyar válaszgenerátora vagy.

Feladat:
- adj vissza kizárólag 1 rövid magyar mondatot
- legyen természetes, udvarias és tömör
- ne legyen köszönés
- ne legyen emoji
- igazodj a korábbi példák stílusához

Korábbi példák:
${JSON.stringify(examples, null, 2)}

Állapot: ${accepted ? "Megoldva" : "Elutasítva"}
Bug címe: ${bug.canonicalTitle || bug.title}
Bug összefoglaló: ${bug.aiSummary || bug.description || ""}
`;

  try {
    const response = await openai.responses.create({
      model: CONFIG.OPENAI_MODEL,
      input: prompt,
      reasoning: { effort: "low" },
    });

    const text = (response.output_text || "").trim();

    return limitText(
      text ||
        (accepted
          ? "A hibajelentést elfogadtuk, és a probléma javításra került."
          : "A jelentést átnéztük, de ez nem minősül valós hibának."),
      220
    );
  } catch (error) {
    console.error("[BUGREPORT] AI decision hiba:", error?.message || error);
    return accepted
      ? "A hibajelentést elfogadtuk, és a probléma javításra került."
      : "A jelentést átnéztük, de ez nem minősül valós hibának vagy nem reprodukálható hibaként.";
  }
}

// =========================
// BUG KERESÉS / DÖNTÉS
// =========================
function fallbackFindMatch(data, title, description) {
  const newText = `${title} ${description}`.trim();

  let bestId = null;
  let bestScore = 0;

  for (const bug of Object.values(data.bugs)) {
    if (bug.status !== "Nyitott") continue;

    const existingText = `${bug.canonicalTitle || bug.title} ${bug.aiSummary || bug.description || ""}`.trim();

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
    .filter((bug) => bug.status === "Nyitott")
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const trainingExamples = getRecentTrainingExamples(data);
  const aiResult = await aiGroupBug({
    title,
    description,
    openBugs,
    trainingExamples,
  });

  if (
    aiResult &&
    aiResult.matchBugId &&
    aiResult.confidence >= CONFIG.AI_MATCH_CONFIDENCE &&
    data.bugs[aiResult.matchBugId] &&
    data.bugs[aiResult.matchBugId].status === "Nyitott"
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
      summary: description || title,
      decisionReason: "A hibajelentés hasonló egy meglévő bugtémához, ezért ahhoz lett csoportosítva.",
      confidence: fallback.confidence,
      source: "fallback",
    };
  }

  return {
    type: "new",
    bugId: null,
    canonicalTitle: aiResult?.canonicalTitle || title,
    summary: aiResult?.summary || description || title,
    decisionReason:
      aiResult?.decisionReason || "Új hibatémaként került létrehozásra.",
    confidence: aiResult?.confidence || 0,
    source: aiResult ? "ai_no_match" : "fallback_new",
  };
}

// =========================
// TÖRLÉS ÜTEMEZÉS
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

function restoreDeletionSchedules(client) {
  const data = loadData();

  for (const bug of Object.values(data.bugs)) {
    if (bug.deleteAt) {
      scheduleDeletion(client, bug.id, bug.deleteAt);
    }
  }
}

// =========================
// DISCORD MŰVELETEK
// =========================
async function updateSummaryMessage(client, bug) {
  const summaryChannel = await client.channels.fetch(CONFIG.BUG_SUMMARY_CHANNEL_ID);
  if (!summaryChannel) return null;

  const payload = {
    embeds: [buildBugEmbed(bug)],
    components: bug.status === "Nyitott" ? [createButtons(bug.id)] : [],
  };

  if (bug.messageId) {
    const oldMsg = await summaryChannel.messages.fetch(bug.messageId).catch(() => null);
    if (oldMsg) {
      return await oldMsg.edit(payload);
    }
  }

  const newMsg = await summaryChannel.send(payload);
  return newMsg;
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
    return;
  }

  const bugId = makeBugId();

  const bug = {
    id: bugId,
    title,
    canonicalTitle: result.canonicalTitle || title,
    description,
    aiSummary: result.summary || description,
    aiDecisionReason:
      result.decisionReason || "Új hibatémaként került létrehozásra.",
    threads: [thread.id],
    status: "Nyitott",
    handler: null,
    messageId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    decidedAt: null,
    deleteAt: null,
  };

  data.bugs[bugId] = bug;

  const msg = await updateSummaryMessage(client, bug);
  if (msg) {
    bug.messageId = msg.id;
  }

  saveData(data);
}

async function handleDecision(client, interaction, bugId, accepted) {
  const data = loadData();
  const bug = data.bugs[bugId];

  if (!bug) {
    return interaction.reply({
      content: "Ez a bug már nem található.",
      ephemeral: true,
    });
  }

  if (bug.status !== "Nyitott") {
    return interaction.reply({
      content: `Ez a bug már le lett zárva: **${bug.status}**`,
      ephemeral: true,
    });
  }

  const reason =
    (await aiDecisionReason({
      bug,
      accepted,
      trainingExamples: getRecentTrainingExamples(data),
    })) ||
    (accepted
      ? "A hibajelentést elfogadtuk, és a probléma javításra került."
      : "A jelentést átnéztük, de ez nem minősül valós hibának.");

  bug.status = accepted ? "Megoldva" : "Elutasítva";
  bug.handler = interaction.user.tag;
  bug.aiDecisionReason = reason;
  bug.decidedAt = Date.now();
  bug.deleteAt = Date.now() + CONFIG.DELETE_AFTER_MS;
  bug.updatedAt = Date.now();

  addTrainingExample(data, bug, accepted);

  const msg = await updateSummaryMessage(client, bug);
  if (msg) {
    bug.messageId = msg.id;
  }

  saveData(data);

  for (const threadId of bug.threads || []) {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (!thread) continue;

    const decisionMessage = makeDecisionMessage({
      accepted,
      reason,
      handlerTag: interaction.user.tag,
    });

    await thread.send({ content: decisionMessage }).catch(() => null);
    await thread.setLocked(true).catch(() => null);
    await thread.setArchived(true).catch(() => null);
  }

  scheduleDeletion(client, bug.id, bug.deleteAt);

  return interaction.reply({
    content: accepted
      ? "A bug megoldottnak lett jelölve. 1 nap múlva törlődik az embed és a fórumbejegyzés(ek) is."
      : "A bug elutasítva lett. 1 nap múlva törlődik az embed és a fórumbejegyzés(ek) is.",
    ephemeral: true,
  });
}

// =========================
// REGISZTRÁLÁS
// =========================
function registerBugReport(client) {
  client.on("ready", async () => {
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
      if (!interaction.isButton()) return;
      if (!interaction.customId.startsWith("bug_")) return;

      const [, action, bugId] = interaction.customId.split("_");
      if (!bugId) {
        return interaction.reply({
          content: "Hibás gombazonosító.",
          ephemeral: true,
        });
      }

      if (action === "accept") {
        return await handleDecision(client, interaction, bugId, true);
      }

      if (action === "reject") {
        return await handleDecision(client, interaction, bugId, false);
      }
    } catch (error) {
      console.error("[BUGREPORT] interactionCreate hiba:", error);

      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          content: "Hiba történt a művelet közben.",
          ephemeral: true,
        });
      }
    }
  });
}

module.exports = { registerBugReport };