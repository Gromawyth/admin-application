const {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
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

  DELETE_AFTER_MS: 24 * 60 * 60 * 1000, // csak Megoldás / Elutasítás esetén
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
    .replace(/nem minősül valós hibának, vagy a leírt jelenség nem reprodukálható hibaként\.?/gi, "nem tudtuk hibaként elfogadni.")
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

function createButtons(bugId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bug:solved:${bugId}`)
      .setLabel("Megoldás")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`bug:rejected:${bugId}`)
      .setLabel("Elutasítás")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(`bug:working:${bugId}`)
      .setLabel("Dolgozunk rajta")
      .setStyle(ButtonStyle.Primary)
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
    120
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

function makeForumFeedbackMessage({ status, reason, handlerTag }) {
  const shortReason = cleanupShortText(reason, 140);

  if (status === "Megoldás") {
    return [
      "✅ **Megoldás**",
      "",
      "Átnéztük a hibát, és javítva lett.",
      `**Röviden:** ${shortReason}`,
      `**Kezelte:** ${handlerTag}`,
    ].join("\n");
  }

  if (status === "Elutasítás") {
    return [
      "❌ **Elutasítás**",
      "",
      "Átnéztük a jelentést, de ezt most nem fogadtuk el hibának.",
      `**Röviden:** ${shortReason}`,
      `**Kezelte:** ${handlerTag}`,
    ].join("\n");
  }

  return [
    "🛠️ **Dolgozunk rajta**",
    "",
    "Láttuk a jelentést, és dolgozunk a hiba megoldásán.",
    `**Röviden:** ${shortReason}`,
    `**Kezeli:** ${handlerTag}`,
  ].join("\n");
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
    decisionReason: cleanupShortText(bug.aiDecisionReason || "", 140),
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

async function aiStatusReason({ bug, status, trainingExamples }) {
  const fallbackMap = {
    "Megoldás": "A hibát javítottuk.",
    "Elutasítás": "Ezt most nem fogadtuk el hibának.",
    "Dolgozunk rajta": "A hibát átnéztük, és dolgozunk rajta.",
  };

  if (!openai) {
    return fallbackMap[status] || "A hibajelentést átnéztük.";
  }

  const examples = trainingExamples.slice(-15);

  const prompt = `
Te egy Discord bugkezelő rendszer rövid magyar válaszgenerátora vagy.

Feladat:
- kizárólag 1 rövid magyar mondatot írj
- legyen egyszerű, hétköznapi, könnyen érthető
- ne legyen túl hivatalos
- ne használj bonyolult szavakat
- ne használd azt, hogy reprodukálható / nem reprodukálható
- ne legyen köszönés
- ne legyen emoji
- maximum 12 szó legyen

Korábbi példák:
${JSON.stringify(examples, null, 2)}

Állapot: ${status}
Bug címe: ${bug.canonicalTitle || bug.title}
Bug összefoglaló: ${bug.aiSummary || bug.description || ""}
`;

  try {
    const response = await openai.responses.create({
      model: CONFIG.OPENAI_MODEL,
      input: prompt,
      reasoning: { effort: "low" },
    });

    const text = cleanupShortText(response.output_text || fallbackMap[status], 140);
    return text || fallbackMap[status];
  } catch (error) {
    console.error("[BUGREPORT] AI status reason hiba:", error?.message || error);
    return fallbackMap[status] || "A hibajelentést átnéztük.";
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

function restoreDeletionSchedules(client) {
  const data = loadData();

  for (const bug of Object.values(data.bugs)) {
    if (bug.deleteAt && (bug.status === "Megoldás" || bug.status === "Elutasítás")) {
      scheduleDeletion(client, bug.id, bug.deleteAt);
    }
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
    components:
      bug.status === "Megoldás" || bug.status === "Elutasítás"
        ? []
        : [createButtons(bug.id)],
  };

  if (bug.messageId) {
    const oldMsg = await summaryChannel.messages.fetch(bug.messageId).catch(() => null);
    if (oldMsg) {
      return await oldMsg.edit(payload);
    }
  }

  return await summaryChannel.send(payload);
}

async function sendFeedbackToAllThreads(client, bug, feedbackText, lockAfter = false) {
  for (const threadId of bug.threads || []) {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (!thread) continue;

    await thread.send({ content: feedbackText }).catch(() => null);

    if (lockAfter) {
      await thread.setLocked(true).catch(() => null);
      await thread.setArchived(true).catch(() => null);
    }
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

    if (bug.status === "Dolgozunk rajta") {
      const text = makeForumFeedbackMessage({
        status: "Dolgozunk rajta",
        reason: bug.aiDecisionReason || "A hibával foglalkozunk.",
        handlerTag: bug.handler || "Staff",
      });

      await thread.send({ content: text }).catch(() => null);
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
  };

  data.bugs[bugId] = bug;

  const msg = await updateSummaryMessage(client, bug);
  if (msg) {
    bug.messageId = msg.id;
  }

  saveData(data);
}

async function handleStatusChange(client, interaction, bugId, status) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const data = loadData();
  const bug = data.bugs[bugId];

  if (!bug) {
    return interaction.editReply({
      content: "Ez a bug már nem található.",
    });
  }

  if (["Megoldás", "Elutasítás"].includes(bug.status)) {
    return interaction.editReply({
      content: `Ez a bug már le lett zárva: **${bug.status}**`,
    });
  }

  const reason = await aiStatusReason({
    bug,
    status,
    trainingExamples: getRecentTrainingExamples(data),
  });

  bug.status = status;
  bug.handler = interaction.user.tag;
  bug.aiDecisionReason = cleanupShortText(reason, 140);
  bug.decidedAt = Date.now();
  bug.updatedAt = Date.now();
  bug.lastForumFeedbackAt = Date.now();
  bug.lastForumFeedbackType = status;

  if (status === "Megoldás" || status === "Elutasítás") {
    bug.deleteAt = Date.now() + CONFIG.DELETE_AFTER_MS;
    addTrainingExample(data, bug, status);
  } else {
    bug.deleteAt = null;
  }

  const msg = await updateSummaryMessage(client, bug);
  if (msg) {
    bug.messageId = msg.id;
  }

  saveData(data);

  const forumText = makeForumFeedbackMessage({
    status,
    reason: bug.aiDecisionReason,
    handlerTag: interaction.user.tag,
  });

  await sendFeedbackToAllThreads(
    client,
    bug,
    forumText,
    status === "Megoldás" || status === "Elutasítás"
  );

  if (status === "Megoldás" || status === "Elutasítás") {
    scheduleDeletion(client, bug.id, bug.deleteAt);
  }

  if (status === "Megoldás") {
    return interaction.editReply({
      content: "A bug állapota: Megoldás. A kapcsolódó fórumok értesítve lettek.",
    });
  }

  if (status === "Elutasítás") {
    return interaction.editReply({
      content: "A bug állapota: Elutasítás. A kapcsolódó fórumok értesítve lettek.",
    });
  }

  return interaction.editReply({
    content: "A bug állapota: Dolgozunk rajta. A kapcsolódó fórumok értesítve lettek.",
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
      if (
        !interaction.customId.startsWith("bug_") &&
        !interaction.customId.startsWith("bug:")
      ) {
        return;
      }

      let action = null;
      let bugId = null;

      if (interaction.customId.startsWith("bug:")) {
        const parts = interaction.customId.split(":");
        action = parts[1];
        bugId = parts.slice(2).join(":");
      } else {
        const parts = interaction.customId.split("_");
        action = parts[1];
        bugId = parts.slice(2).join("_");
      }

      if (!bugId) {
        if (interaction.deferred || interaction.replied) {
          return interaction.editReply({
            content: "Hibás gombazonosító."
          });
        }

        return interaction.reply({
          content: "Hibás gombazonosító.",
          flags: MessageFlags.Ephemeral
        });
      }

      if (action === "solved") {
        return await handleStatusChange(client, interaction, bugId, "Megoldás");
      }

      if (action === "rejected") {
        return await handleStatusChange(client, interaction, bugId, "Elutasítás");
      }

      if (action === "working") {
        return await handleStatusChange(client, interaction, bugId, "Dolgozunk rajta");
      }

      return interaction.reply({
        content: "Ismeretlen bug gomb.",
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      console.error("[BUGREPORT] interactionCreate hiba:", error);

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: "Hiba történt a művelet közben."
          });
        } else {
          await interaction.reply({
            content: "Hiba történt a művelet közben.",
            flags: MessageFlags.Ephemeral
          });
        }
      } catch {}
    }
  });
}

module.exports = { registerBugReport };