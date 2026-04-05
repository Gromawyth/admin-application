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
const { getState } = require("./systempanel");
// =========================
// KONFIG
// =========================
const CONFIG = {
  IDEA_FORUM_CHANNEL_ID: "1462418887755829453",
  IDEA_SUMMARY_CHANNEL_ID: "1486143766988324995",

  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: "gpt-5-mini",

  // AI takarékos beállítások
  USE_AI_GROUPING: true,
  USE_AI_DECISIONS: true,
  USE_AI_FOR_LONG_COMMENTS_ONLY: true,
  MIN_COMMENT_LENGTH_FOR_AI: 160,

  AI_MATCH_CONFIDENCE: 0.74,
  FALLBACK_SIMILARITY_THRESHOLD: 0.60,

  MAX_OPEN_IDEAS_FOR_AI: 20,
  MAX_TRAINING_EXAMPLES: 25,

  DELETE_AFTER_MS: 24 * 60 * 60 * 1000,

  MAX_COMMENT_INSIGHTS: 40,
  MAX_COMMENT_CONTEXT_ITEMS: 10,

  TAG_NAMES: {
    OPEN: ["nyitott", "open"],
    WORKING: ["dolgozunk rajta", "folyamatban", "working", "in progress"],
    ACCEPTED: ["elfogadva", "accepted", "approved"],
    REJECTED: ["elutasítva", "rejected", "declined"],
  },
};

const DATA_FILE = path.join(__dirname, "idea-data.json");

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
    ideas: {},
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

function ensureIdeaDefaults(idea) {
  if (!Array.isArray(idea.threads)) idea.threads = [];
  if (!idea.status) idea.status = "Nyitott";
  if (!idea.createdAt) idea.createdAt = Date.now();
  if (!idea.updatedAt) idea.updatedAt = Date.now();
  if (typeof idea.aiSummary !== "string") idea.aiSummary = idea.description || "";
  if (typeof idea.aiDecisionReason !== "string") idea.aiDecisionReason = "";
  if (!idea.lastForumFeedbackAt) idea.lastForumFeedbackAt = null;
  if (!idea.lastForumFeedbackType) idea.lastForumFeedbackType = null;
  if (!idea.threadFeedbackMessages || typeof idea.threadFeedbackMessages !== "object") {
    idea.threadFeedbackMessages = {};
  }
  if (typeof idea.lastManualReason !== "string") idea.lastManualReason = "";
  if (!Array.isArray(idea.commentInsights)) idea.commentInsights = [];
  if (!idea.lastMeaningfulCommentAt) idea.lastMeaningfulCommentAt = null;
  if (typeof idea.communityStatus !== "string") idea.communityStatus = "nincs";
  if (typeof idea.communityNotes !== "string") idea.communityNotes = "-";
  if (typeof idea.supportCount !== "number") idea.supportCount = 0;
  if (typeof idea.opposeCount !== "number") idea.opposeCount = 0;
  if (typeof idea.neutralCount !== "number") idea.neutralCount = 0;
}

function loadData() {
  ensureDataFile();

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    if (!parsed.ideas || typeof parsed.ideas !== "object") {
      parsed.ideas = {};
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

    for (const idea of Object.values(parsed.ideas)) {
      ensureIdeaDefaults(idea);
    }

    return parsed;
  } catch (error) {
    console.error("[IDEAS] Hibás JSON, újra létrehozom:", error);
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

function makeIdeaId() {
  return `idea_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
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

function compactText(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function limitText(text = "", max = 1000) {
  const value = String(text || "").trim();
  if (!value) return "-";
  if (value.length <= max) return value;
  return value.slice(0, max - 3) + "...";
}

function cleanupShortText(text = "", max = 420) {
  let value = compactText(text);

  value = value
    .replace(/koncepció/gi, "ötlet")
    .replace(/implementáció/gi, "bevezetés")
    .replace(/optimalizálás/gi, "javítás")
    .replace(/funkcionalitás/gi, "funkció")
    .replace(/mechanika/gi, "rendszer");

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
  const extra = unique.length > 8 ? `\n+${unique.length - 8} további bejegyzés` : "";

  return shown.join("\n") + extra;
}

function getStatusStyle(status) {
  if (status === "Elfogadva") return { color: 0x2ecc71, emoji: "✅" };
  if (status === "Elutasítva") return { color: 0xe74c3c, emoji: "❌" };
  if (status === "Dolgozunk rajta") return { color: 0x3498db, emoji: "🛠️" };
  return { color: 0xf1c40f, emoji: "💡" };
}

function createButtons(ideaId, status = "Nyitott") {
  if (status === "Elfogadva") {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`idea:accepted:${ideaId}`)
        .setLabel("Elfogadva")
        .setStyle(ButtonStyle.Success)
        .setDisabled(true)
    );
  }

  if (status === "Elutasítva") {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`idea:rejected:${ideaId}`)
        .setLabel("Elutasítva")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true)
    );
  }

  if (status === "Dolgozunk rajta") {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`idea:working:${ideaId}`)
        .setLabel("Elküldve - Dolgozunk rajta")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`idea:accepted:${ideaId}`)
        .setLabel("Elfogadva")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`idea:rejected:${ideaId}`)
        .setLabel("Elutasítva")
        .setStyle(ButtonStyle.Danger)
    );
  }

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`idea:working:${ideaId}`)
      .setLabel("Dolgozunk rajta")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`idea:accepted:${ideaId}`)
      .setLabel("Elfogadva")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`idea:rejected:${ideaId}`)
      .setLabel("Elutasítva")
      .setStyle(ButtonStyle.Danger)
  );
}

function getCommentContextForAI(idea, maxItems = CONFIG.MAX_COMMENT_CONTEXT_ITEMS) {
  if (!idea || !Array.isArray(idea.commentInsights) || !idea.commentInsights.length) {
    return "Nincs érdemi fórumos visszajelzés.";
  }

  return idea.commentInsights
    .slice(-maxItems)
    .map((item) => {
      const typeMap = {
        supports: "támogatja az ötletet",
        opposes: "ellenzi az ötletet",
        extra_info: "plusz információt adott",
        suggests_change: "módosítást javasol",
        other_meaningful: "egyéb érdemi visszajelzés",
        smalltalk: "egyéb",
      };

      return `- [${typeMap[item.type] || "egyéb"}] ${item.authorTag}: ${item.summary}`;
    })
    .join("\n");
}

function rebuildCommunityNotes(idea) {
  const items = Array.isArray(idea.commentInsights) ? idea.commentInsights.slice(-6) : [];

  if (!items.length) {
    idea.communityNotes = "-";
    return;
  }

  idea.communityNotes = items
    .map((item) => `• ${item.authorTag}: ${item.summary}`)
    .join("\n");
}

function deriveCommunityStatus(idea) {
  const support = idea.supportCount || 0;
  const oppose = idea.opposeCount || 0;
  const neutral = idea.neutralCount || 0;
  const total = support + oppose + neutral;

  if (total === 0) return "nincs érdemi közösségi visszajelzés";
  if (support > 0 && oppose === 0) return "a közösség inkább támogatja";
  if (oppose > 0 && support === 0) return "a közösség inkább ellenzi";
  if (support > oppose * 1.6) return "többen támogatják, mint ellenzik";
  if (oppose > support * 1.6) return "többen ellenzik, mint támogatják";
  return "megosztó visszajelzések érkeztek";
}

function getSupportText(idea) {
  const support = idea.supportCount || 0;
  const oppose = idea.opposeCount || 0;
  const neutral = idea.neutralCount || 0;
  return `👍 ${support} • 👎 ${oppose} • 💬 ${neutral}`;
}

// =========================
// EMBED
// =========================
function buildIdeaEmbed(idea) {
  const style = getStatusStyle(idea.status);

  const summaryText = cleanupShortText(
    idea.aiSummary || idea.description || "Nincs összefoglaló.",
    520
  );

  const aiShort = cleanupShortText(
    idea.aiDecisionReason || idea.aiSummary || "Nincs rövid leírás.",
    240
  );

  const manualComment = compactText(idea.lastManualReason || "");

  const decisionText =
    idea.status === "Nyitott"
      ? "-"
      : `${idea.handler || "-"} • ${
          idea.decidedAt ? `<t:${Math.floor(idea.decidedAt / 1000)}:f>` : "-"
        }`;

  const deleteText =
    idea.deleteAt && (idea.status === "Elfogadva" || idea.status === "Elutasítva")
      ? `<t:${Math.floor(idea.deleteAt / 1000)}:R>`
      : "-";

  const communityStatus = limitText(idea.communityStatus || "-", 160);
  const communityNotes = limitText(idea.communityNotes || "-", 1024);
  const lastCommentText = idea.lastMeaningfulCommentAt
    ? `<t:${Math.floor(idea.lastMeaningfulCommentAt / 1000)}:f>`
    : "-";

  const fields = [
    {
      name: "📊 Bejegyzések száma",
      value: String((idea.threads || []).length),
      inline: true,
    },
    {
      name: "📌 Állapot",
      value: idea.status || "Nyitott",
      inline: true,
    },
    {
      name: "👤 Kezelő",
      value: idea.handler || "-",
      inline: true,
    },
    {
      name: "🧠 AI rövid összegzés",
      value: aiShort,
      inline: false,
    },
    {
      name: "🤝 Közösségi reakció",
      value: getSupportText(idea),
      inline: true,
    },
    {
      name: "💬 Hangulat",
      value: communityStatus,
      inline: true,
    },
  ];

  if (manualComment) {
    fields.push({
      name: "📝 Staff hozzászólás",
      value: limitText(manualComment, 1024),
      inline: false,
    });
  }

  fields.push(
    {
      name: "🧾 Utolsó érdemi komment",
      value: lastCommentText,
      inline: true,
    },
    {
      name: "🔗 Kapcsolódó bejegyzések",
      value: getThreadMentions(idea.threads || []),
      inline: false,
    },
    {
      name: "📎 Kiemelt hozzászólások",
      value: communityNotes,
      inline: false,
    },
    {
      name: "🕒 Létrehozva",
      value: idea.createdAt ? `<t:${Math.floor(idea.createdAt / 1000)}:f>` : "-",
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
  );

  return new EmbedBuilder()
    .setTitle(`${style.emoji} ÖTLET: ${limitText(idea.canonicalTitle || idea.title, 200)}`)
    .setDescription(limitText(summaryText, 4000))
    .addFields(fields)
    .setColor(style.color)
    .setFooter({ text: `Ötlet ID: ${idea.id}` })
    .setTimestamp(new Date(idea.updatedAt || Date.now()));
}

function buildForumFeedbackEmbed({ status, reason, handlerTag, idea }) {
  const style = getStatusStyle(status);
  const deleteTimeText =
    idea.deleteAt && (status === "Elfogadva" || status === "Elutasítva")
      ? `<t:${Math.floor(idea.deleteAt / 1000)}:R>`
      : "nincs ütemezve";

  let title = "Ötlet állapot frissítve";
  let description = "Átnéztük az ötletet, és frissítettük az állapotát.";
  let extraInfo = "A thread jelenleg nyitva marad.";

  if (status === "Elfogadva") {
    title = "✅ Ötlet lezárva • Elfogadva";
    description =
      "Átnéztük az ötletet, és elfogadott státuszba került. Köszönjük a javaslatot, mert ezzel sokat segíted a szerver fejlesztését.";
    extraInfo = `A bejegyzés le lett zárva, archiválva lett, és ${deleteTimeText} törölve lesz.`;
  } else if (status === "Elutasítva") {
    title = "❌ Ötlet lezárva • Elutasítva";
    description =
      "Átnéztük az ötletet, de most nem került elfogadásra. Ettől függetlenül köszönjük a javaslatot.";
    extraInfo = `A bejegyzés le lett zárva, archiválva lett, és ${deleteTimeText} törölve lesz.`;
  } else if (status === "Dolgozunk rajta") {
    title = "🛠️ Ötlet állapota • Dolgozunk rajta";
    description =
      "Láttuk az ötletet, átnéztük az első részleteket, és már foglalkozunk vele. Ha végleges döntés születik, ugyanebben a fórumban külön jelezni fogjuk.";
    extraInfo =
      "A thread egyelőre nyitva marad, hogy a végleges döntésig visszanézhető legyen.";
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
        name: "🤖 AI hozzászólás",
        value: limitText(reason || "-", 1024),
        inline: false,
      },
      {
        name: "ℹ️ Tájékoztatás",
        value: extraInfo,
        inline: false,
      }
    )
    .setFooter({ text: `Ötlet ID: ${idea.id}` })
    .setTimestamp(new Date());
}

// =========================
// TANULÁSI PÉLDÁK
// =========================
function addTrainingExample(data, idea, status) {
  if (!Array.isArray(data.trainingExamples)) {
    data.trainingExamples = [];
  }

  const example = {
    title: idea.canonicalTitle || idea.title || "Ismeretlen ötlet",
    summary: cleanupShortText(idea.aiSummary || idea.description || "", 240),
    status,
    decisionReason: cleanupShortText(idea.aiDecisionReason || "", 220),
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
// AI - TAKARÉKOSAN
// =========================
async function aiGroupIdea({ title, description, openIdeas, trainingExamples }) {
    if (!getState("ideas_ai_grouping")) {
    return null;
  }
  if (!openai || !CONFIG.USE_AI_GROUPING) return null;

  const candidates = openIdeas.slice(0, CONFIG.MAX_OPEN_IDEAS_FOR_AI).map((idea) => ({
    id: idea.id,
    title: idea.canonicalTitle || idea.title,
    summary: cleanupShortText(idea.aiSummary || idea.description || "", 220),
    posts: (idea.threads || []).length,
  }));

  const examples = trainingExamples.slice(-CONFIG.MAX_TRAINING_EXAMPLES);

  const prompt = `
Te egy Discord ötletkezelő rendszer segédje vagy.

Feladat:
- döntsd el, hogy az új ötlet ugyanahhoz a meglévő NYITOTT ötlethez tartozik-e
- ha igen, add vissza a meglévő ötlet id-ját
- ha nem, a matchIdeaId legyen null
- a canonicalTitle legyen rövid, tiszta és emberi
- a summary legyen 2-3 rövid, érthető magyar mondat
- a decisionReason legyen 1 rövid mondat

Fontos:
- ne csak szavakat figyelj, hanem a lényeget
- ha az ötlet másképp megfogalmazva, de ugyanarról szól, vond össze
- ne írj túl hivatalosan
- ne írj regényt

Korábbi példák:
${JSON.stringify(examples, null, 2)}

Új ötlet:
Cím: ${title}
Leírás: ${description}

Meglévő nyitott ötletek:
${JSON.stringify(candidates, null, 2)}

Csak JSON-t adj vissza:
{
  "matchIdeaId": "idea_xxx" vagy null,
  "confidence": 0 és 1 közötti szám,
  "canonicalTitle": "rövid cím",
  "summary": "2-3 mondatos összefoglaló",
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
      matchIdeaId: parsed.matchIdeaId || null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      canonicalTitle: limitText(parsed.canonicalTitle || title, 180),
      summary: cleanupShortText(parsed.summary || description || title, 520),
      decisionReason: cleanupShortText(
        parsed.decisionReason || "Az ötlet feldolgozva.",
        150
      ),
    };
  } catch (error) {
    console.error("[IDEAS] AI grouping hiba:", error?.message || error);
    return null;
  }
}

function heuristicAnalyzeComment(content = "") {
  const text = normalizeText(content);
  const raw = compactText(content);

  if (!raw || raw.length < 8) {
    return { meaningful: false, type: "smalltalk", summary: "" };
  }

  const supportWords = [
    "jo otlet",
    "tetszik",
    "tamogatom",
    "legyen",
    "adom",
    "igen jo",
    "szerintem jo",
    "hasznos lenne",
    "kellene",
  ];

  const opposeWords = [
    "nem jo",
    "rossz otlet",
    "nem kell",
    "felesleges",
    "ellene vagyok",
    "ne legyen",
    "nem tamogatom",
  ];

  const changeWords = [
    "inkabb",
    "viszont",
    "de",
    "szerintem ugy lenne jobb",
    "at lehetne",
    "jobb lenne",
    "mashogy",
    "modositanam",
  ];

  for (const word of opposeWords) {
    if (text.includes(word)) {
      return {
        meaningful: true,
        type: "opposes",
        summary: cleanupShortText(raw, 180),
      };
    }
  }

  for (const word of supportWords) {
    if (text.includes(word)) {
      return {
        meaningful: true,
        type: "supports",
        summary: cleanupShortText(raw, 180),
      };
    }
  }

  for (const word of changeWords) {
    if (text.includes(word) && raw.length >= 20) {
      return {
        meaningful: true,
        type: "suggests_change",
        summary: cleanupShortText(raw, 180),
      };
    }
  }

  if (raw.length >= 20) {
    return {
      meaningful: true,
      type: "extra_info",
      summary: cleanupShortText(raw, 180),
    };
  }

  return { meaningful: false, type: "smalltalk", summary: "" };
}

async function aiAnalyzeIdeaComment({ idea, content, authorTag }) {
  const fallback = heuristicAnalyzeComment(content);
  if (!openai) return fallback;

  if (CONFIG.USE_AI_FOR_LONG_COMMENTS_ONLY && compactText(content).length < CONFIG.MIN_COMMENT_LENGTH_FOR_AI) {
    return fallback;
  }

  const prompt = `
Te egy Discord ötletkezelő rendszer kommentelemzője vagy.

Feladat:
- döntsd el, hogy ez a hozzászólás érdemi-e az ötlet szempontjából
- ha igen, osztályozd és foglald össze röviden
- ne írj túl technikusan

Lehetséges type értékek:
- supports
- opposes
- extra_info
- suggests_change
- other_meaningful
- smalltalk

Ötlet címe:
${idea.canonicalTitle || idea.title || "Ismeretlen ötlet"}

Ötlet leírása:
${idea.description || "Nincs leírás."}

Korábbi érdemi kommentek:
${getCommentContextForAI(idea, 4)}

Komment szerzője:
${authorTag || "Ismeretlen"}

Új komment:
${compactText(content)}

Csak JSON:
{
  "meaningful": true vagy false,
  "type": "supports",
  "summary": "rövid összefoglaló"
}
`;

  try {
    const response = await openai.responses.create({
      model: CONFIG.OPENAI_MODEL,
      input: prompt,
      reasoning: { effort: "low" },
    });

    const text = (response.output_text || "").trim();
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) {
      return fallback;
    }

    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
    const allowedTypes = new Set([
      "supports",
      "opposes",
      "extra_info",
      "suggests_change",
      "other_meaningful",
      "smalltalk",
    ]);

    const meaningful = Boolean(parsed.meaningful);
    const type = allowedTypes.has(parsed.type) ? parsed.type : "other_meaningful";
    const summary = meaningful
      ? cleanupShortText(parsed.summary || compactText(content), 180)
      : "";

    return {
      meaningful,
      type: meaningful ? type : "smalltalk",
      summary,
    };
  } catch (error) {
    console.error("[IDEAS] aiAnalyzeIdeaComment hiba:", error?.message || error);
    return fallback;
  }
}

function getFallbackDecisionReason(status, manualReason) {
  const note = compactText(manualReason || "");

  if (status === "Elfogadva") {
    return note
      ? `Átnéztük az ötletet, és elfogadott státuszba került. ${note} Köszönjük a javaslatot.`
      : "Átnéztük az ötletet, és elfogadott státuszba került. Köszönjük a javaslatot, mert ezzel sokat segíted a szerver fejlesztését.";
  }

  if (status === "Elutasítva") {
    return note
      ? `Átnéztük az ötletet, de most nem került elfogadásra. ${note} Ettől függetlenül köszönjük a javaslatot.`
      : "Átnéztük az ötletet, de most nem került elfogadásra. Ettől függetlenül köszönjük a javaslatot.";
  }

  return note
    ? `Átnéztük az ötletet, és már foglalkozunk vele. ${note} Ha végleges döntés születik, ugyanebben a fórumban jelezni fogjuk.`
    : "Átnéztük az ötletet, és már foglalkozunk vele. Ha végleges döntés születik, ugyanebben a fórumban jelezni fogjuk.";
}

async function aiDecisionReason({ idea, status, trainingExamples, manualReason = "" }) {
    if (!getState("ideas_ai_decisions")) {
    return getFallbackDecisionReason(status, manualReason);
  }
  const fallback = getFallbackDecisionReason(status, manualReason);

  if (!openai || !CONFIG.USE_AI_DECISIONS) {
    return fallback;
  }

  const examples = trainingExamples.slice(-12);

  const prompt = `
Te egy Discord ötletkezelő rendszer kedves, rövid magyar válaszgenerátora vagy.

Feladat:
- írj 2-3 rövid magyar mondatot
- legyen barátságos, normális hangnemű
- ne legyen túl hivatalos
- ha van staff hozzászólás, használd fel természetesen
- ha nincs staff hozzászólás, akkor adj rövid, életszerű indoklást
- ne használj felsorolást

Korábbi példák:
${JSON.stringify(examples, null, 2)}

Állapot: ${status}
Ötlet címe: ${idea.canonicalTitle || idea.title}
Ötlet összefoglaló: ${idea.aiSummary || idea.description || ""}
Közösségi hangulat: ${idea.communityStatus || "nincs"}
Staff hozzászólás: ${manualReason || "nincs megadva"}

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
    console.error("[IDEAS] AI decision reason hiba:", error?.message || error);
    return fallback;
  }
}

// =========================
// KERESÉS / OSZTÁLYOZÁS
// =========================
function fallbackFindMatch(data, title, description) {
  const newText = `${title} ${description}`.trim();

  let bestId = null;
  let bestScore = 0;

  for (const idea of Object.values(data.ideas)) {
    if (!["Nyitott", "Dolgozunk rajta"].includes(idea.status)) continue;

    const existingText =
      `${idea.canonicalTitle || idea.title} ${idea.aiSummary || idea.description || ""}`.trim();

    const score = Math.max(
      fallbackSimilarity(title, idea.canonicalTitle || idea.title),
      fallbackSimilarity(newText, existingText)
    );

    if (score > bestScore) {
      bestScore = score;
      bestId = idea.id;
    }
  }

  if (bestScore >= CONFIG.FALLBACK_SIMILARITY_THRESHOLD) {
    return { ideaId: bestId, confidence: bestScore };
  }

  return { ideaId: null, confidence: 0 };
}

async function classifyIdea(data, title, description) {
  const openIdeas = Object.values(data.ideas)
    .filter((idea) => ["Nyitott", "Dolgozunk rajta"].includes(idea.status))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const aiResult = await aiGroupIdea({
    title,
    description,
    openIdeas,
    trainingExamples: getRecentTrainingExamples(data),
  });

  if (
    aiResult &&
    aiResult.matchIdeaId &&
    aiResult.confidence >= CONFIG.AI_MATCH_CONFIDENCE &&
    data.ideas[aiResult.matchIdeaId] &&
    ["Nyitott", "Dolgozunk rajta"].includes(data.ideas[aiResult.matchIdeaId].status)
  ) {
    return {
      type: "match",
      ideaId: aiResult.matchIdeaId,
      canonicalTitle: aiResult.canonicalTitle,
      summary: aiResult.summary,
      decisionReason: aiResult.decisionReason,
      confidence: aiResult.confidence,
      source: "ai",
    };
  }

  const fallback = fallbackFindMatch(data, title, description);
  if (fallback.ideaId) {
    return {
      type: "match",
      ideaId: fallback.ideaId,
      canonicalTitle: title,
      summary: cleanupShortText(description || title, 520),
      decisionReason: "Hasonlít egy meglévő ötletre.",
      confidence: fallback.confidence,
      source: "fallback",
    };
  }

  return {
    type: "new",
    ideaId: null,
    canonicalTitle: aiResult?.canonicalTitle || title,
    summary: cleanupShortText(aiResult?.summary || description || title, 520),
    decisionReason: cleanupShortText(
      aiResult?.decisionReason || "Új ötletként lett felvéve.",
      150
    ),
    confidence: aiResult?.confidence || 0,
    source: aiResult ? "ai_no_match" : "fallback_new",
  };
}

// =========================
// TÖRLÉS
// =========================
async function deleteIdeaAndThreads(client, ideaId) {
  const data = loadData();
  const idea = data.ideas[ideaId];
  if (!idea) return;

  try {
    const summaryChannel = await client.channels
      .fetch(CONFIG.IDEA_SUMMARY_CHANNEL_ID)
      .catch(() => null);

    if (summaryChannel && idea.messageId) {
      const msg = await summaryChannel.messages.fetch(idea.messageId).catch(() => null);
      if (msg) {
        await msg.delete().catch(() => null);
      }
    }

    for (const threadId of idea.threads || []) {
      const thread = await client.channels.fetch(threadId).catch(() => null);
      if (thread) {
        await thread.delete().catch(() => null);
      }
    }
  } catch (error) {
    console.error("[IDEAS] Törlési hiba:", error);
  }

  const latest = loadData();
  if (latest.ideas[ideaId]) {
    delete latest.ideas[ideaId];
    saveData(latest);
  }

  if (deleteTimers.has(ideaId)) {
    clearTimeout(deleteTimers.get(ideaId));
    deleteTimers.delete(ideaId);
  }
}

function scheduleDeletion(client, ideaId, deleteAt) {
    if (!getState("ideas_enabled")) return;
  if (!deleteAt) return;

  if (deleteTimers.has(ideaId)) {
    clearTimeout(deleteTimers.get(ideaId));
    deleteTimers.delete(ideaId);
  }

  const delay = Math.max(0, deleteAt - Date.now());

  const timer = setTimeout(async () => {
    await deleteIdeaAndThreads(client, ideaId);
  }, delay);

  deleteTimers.set(ideaId, timer);
}

function clearDeletionSchedule(ideaId) {
  if (deleteTimers.has(ideaId)) {
    clearTimeout(deleteTimers.get(ideaId));
    deleteTimers.delete(ideaId);
  }
}

function restoreDeletionSchedules(client) {
  const data = loadData();

  for (const idea of Object.values(data.ideas)) {
    if (idea.deleteAt && (idea.status === "Elfogadva" || idea.status === "Elutasítva")) {
      scheduleDeletion(client, idea.id, idea.deleteAt);
    }
  }
}

// =========================
// CÍMKÉK / THREAD ÁLLAPOT
// =========================
function getStatusTagKeywords(status) {
  if (status === "Elfogadva") return CONFIG.TAG_NAMES.ACCEPTED;
  if (status === "Elutasítva") return CONFIG.TAG_NAMES.REJECTED;
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
    ...CONFIG.TAG_NAMES.ACCEPTED,
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

  if (status === "Elfogadva" || status === "Elutasítva") {
    await thread.setLocked(true).catch(() => null);
    await thread.setArchived(true).catch(() => null);
  }
}

// =========================
// KOMMENT FIGYELÉS
// =========================
function findIdeaByThreadId(data, threadId) {
  for (const idea of Object.values(data.ideas)) {
    if (Array.isArray(idea.threads) && idea.threads.includes(threadId)) {
      return idea;
    }
  }
  return null;
}

function incrementReactionCounters(idea, type) {
  if (type === "supports") idea.supportCount += 1;
  else if (type === "opposes") idea.opposeCount += 1;
  else idea.neutralCount += 1;
}

async function processForumReply(client, message) {
  if (!message || !message.channel || message.author?.bot) return;

  const thread = message.channel;

  if (thread.parentId !== CONFIG.IDEA_FORUM_CHANNEL_ID) return;
  if (thread.type !== ChannelType.PublicThread) return;

  const content = compactText(message.content || "");
  if (!content) return;

  const data = loadData();
  const idea = findIdeaByThreadId(data, thread.id);
  if (!idea) return;
if (!getState("ideas_comment_insights")) return;
  ensureIdeaDefaults(idea);

  if (["Elfogadva", "Elutasítva"].includes(idea.status)) return;

  let analysis;
  try {
    analysis = await aiAnalyzeIdeaComment({
      idea,
      content,
      authorTag: message.author?.tag || message.author?.username || "Ismeretlen",
    });
  } catch (error) {
    console.error("[IDEAS] processForumReply -> aiAnalyzeIdeaComment hiba:", error);
    analysis = heuristicAnalyzeComment(content);
  }

  if (!analysis?.meaningful) return;

  idea.commentInsights.push({
    authorId: message.author.id,
    authorTag: message.author.tag || message.author.username || "Ismeretlen",
    messageId: message.id,
    threadId: thread.id,
    type: analysis.type || "other_meaningful",
    summary: cleanupShortText(analysis.summary || content, 180),
    createdAt: Date.now(),
  });

  idea.commentInsights = idea.commentInsights.slice(-CONFIG.MAX_COMMENT_INSIGHTS);
  idea.lastMeaningfulCommentAt = Date.now();
  idea.updatedAt = Date.now();

  incrementReactionCounters(idea, analysis.type);
  idea.communityStatus = deriveCommunityStatus(idea);
  rebuildCommunityNotes(idea);

  try {
    const msg = await updateSummaryMessage(client, idea);
    if (msg) {
      idea.messageId = msg.id;
    }
  } catch (error) {
    console.error("[IDEAS] processForumReply -> updateSummaryMessage hiba:", error);
  }

  saveData(data);
}

// =========================
// DISCORD
// =========================
async function updateSummaryMessage(client, idea) {
  const summaryChannel = await client.channels
    .fetch(CONFIG.IDEA_SUMMARY_CHANNEL_ID)
    .catch(() => null);

  if (!summaryChannel) {
    throw new Error("Az IDEA_SUMMARY_CHANNEL_ID csatorna nem található.");
  }

  const payload = {
    embeds: [buildIdeaEmbed(idea)],
    components: [createButtons(idea.id, idea.status)],
  };

  if (idea.messageId) {
    const oldMsg = await summaryChannel.messages.fetch(idea.messageId).catch(() => null);
    if (oldMsg) {
      return await oldMsg.edit(payload);
    }
  }

  return await summaryChannel.send(payload);
}
async function rebuildAllIdeaSummaries(client) {
  const data = loadData();

  for (const idea of Object.values(data.ideas || {})) {
    ensureIdeaDefaults(idea);

    try {
      if (typeof aiRefreshIdeaSummaryFromComments === "function") {
        idea.aiSummary = await aiRefreshIdeaSummaryFromComments(idea);
      } else {
        idea.aiSummary = cleanupShortText(
          [
            idea.description || "",
            idea.communityStatus && idea.communityStatus !== "nincs"
              ? `Közösségi visszajelzés: ${idea.communityStatus}.`
              : "",
            idea.communityNotes && idea.communityNotes !== "-"
              ? idea.communityNotes
              : "",
          ]
            .filter(Boolean)
            .join(" "),
          520
        ) || "Nincs összefoglaló.";
      }
    } catch (error) {
      console.error("[IDEAS] rebuildAllIdeaSummaries aiSummary hiba:", error);
      idea.aiSummary = cleanupShortText(
        idea.description || idea.title || "Nincs összefoglaló.",
        520
      );
    }

    if (!getState("ideas_ai_decisions")) {
      idea.aiDecisionReason = "⚙️ Kikapcsolva az AI hozzászólás.";
    }

    try {
      const msg = await updateSummaryMessage(client, idea);
      if (msg) {
        idea.messageId = msg.id;
      }
    } catch (error) {
      console.error("[IDEAS] rebuildAllIdeaSummaries updateSummaryMessage hiba:", error);
    }
  }

  saveData(data);
}
function getForumFeedbackRecord(idea, threadId) {
  if (!idea.threadFeedbackMessages || typeof idea.threadFeedbackMessages !== "object") {
    idea.threadFeedbackMessages = {};
  }

  if (
    !idea.threadFeedbackMessages[threadId] ||
    typeof idea.threadFeedbackMessages[threadId] !== "object"
  ) {
    idea.threadFeedbackMessages[threadId] = {};
  }

  return idea.threadFeedbackMessages[threadId];
}

async function deleteTrackedThreadMessage(thread, messageId) {
  if (!thread || !messageId) return;
  const oldMsg = await thread.messages.fetch(messageId).catch(() => null);
  if (oldMsg) {
    await oldMsg.delete().catch(() => null);
  }
}

async function sendFeedbackToAllThreads(client, idea, status, reason, handlerTag) {
  for (const threadId of idea.threads || []) {
    try {
      const thread = await client.channels.fetch(threadId).catch(() => null);
      if (!thread) continue;

      const record = getForumFeedbackRecord(idea, threadId);

      if ((status === "Elfogadva" || status === "Elutasítva") && record.workingMessageId) {
        await deleteTrackedThreadMessage(thread, record.workingMessageId);
        record.workingMessageId = null;
      }

      const embed = buildForumFeedbackEmbed({
        status,
        reason,
        handlerTag,
        idea,
      });

      const sent = await thread.send({ embeds: [embed] }).catch((err) => {
        console.error(`[IDEAS] thread.send hiba (${threadId}):`, err);
        return null;
      });

      if (sent) {
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
      }

      await applyThreadStatusTag(thread, status);
      await syncThreadState(thread, status);
    } catch (error) {
      console.error(`[IDEAS] sendFeedbackToAllThreads hiba (${threadId}):`, error);
    }
  }
}

function createDecisionModal(action, ideaId) {
  const titleMap = {
    accepted: "Ötlet elbírálása • Elfogadva",
    rejected: "Ötlet elbírálása • Elutasítva",
  };

  const input = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("Hozzászólás (nem kötelező)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(800)
    .setPlaceholder(
      action === "accepted"
        ? "Pl.: Jó ötlet, beleillik a szerver irányába."
        : "Pl.: Jelenleg nem fér bele, vagy nem illik a szerverhez."
    );

  return new ModalBuilder()
    .setCustomId(`ideamodal:${action}:${ideaId}`)
    .setTitle(titleMap[action] || "Ötlet elbírálása")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function processNewForumThread(client, thread) {
  if (!thread || thread.parentId !== CONFIG.IDEA_FORUM_CHANNEL_ID) return;
  if (thread.type !== ChannelType.PublicThread) return;

  let starterMessage = null;
  try {
    starterMessage = await thread.fetchStarterMessage();
  } catch {
    starterMessage = null;
  }

  const title = limitText(thread.name || "Ismeretlen ötlet", 180);
  const description = limitText(
    starterMessage?.content ||
      starterMessage?.cleanContent ||
      "Nincs leírás megadva.",
    1800
  );

  const data = loadData();
  const result = await classifyIdea(data, title, description);

  if (result.type === "match" && result.ideaId && data.ideas[result.ideaId]) {
    const idea = data.ideas[result.ideaId];
    ensureIdeaDefaults(idea);

    if (!idea.threads.includes(thread.id)) {
      idea.threads.push(thread.id);
    }

    idea.updatedAt = Date.now();
    idea.description = idea.description || description;

    if (result.source === "ai") {
      idea.canonicalTitle = result.canonicalTitle || idea.canonicalTitle || idea.title;
      idea.aiSummary = cleanupShortText(
        result.summary || idea.aiSummary || idea.description,
        520
      );
      idea.aiDecisionReason = result.decisionReason || idea.aiDecisionReason;
    }

    try {
      const msg = await updateSummaryMessage(client, idea);
      if (msg) {
        idea.messageId = msg.id;
      }
    } catch (error) {
      console.error("[IDEAS] processNewForumThread -> updateSummaryMessage hiba:", error);
    }

    saveData(data);

    await applyThreadStatusTag(thread, idea.status);
    await syncThreadState(thread, idea.status);

    if (idea.status === "Dolgozunk rajta") {
      await sendFeedbackToAllThreads(
        client,
        idea,
        "Dolgozunk rajta",
        idea.aiDecisionReason || "Átnéztük, és dolgozunk rajta.",
        idea.handler || "Staff"
      );
      saveData(data);
    }

    return;
  }

  const ideaId = makeIdeaId();

  const idea = {
    id: ideaId,
    title,
    canonicalTitle: result.canonicalTitle || title,
    description,
    aiSummary: cleanupShortText(result.summary || description, 520),
    aiDecisionReason: cleanupShortText(
      result.decisionReason || "Új ötletként lett felvéve.",
      150
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
    commentInsights: [],
    lastMeaningfulCommentAt: null,
    communityStatus: "nincs",
    communityNotes: "-",
    supportCount: 0,
    opposeCount: 0,
    neutralCount: 0,
  };

  data.ideas[ideaId] = idea;

  try {
    const msg = await updateSummaryMessage(client, idea);
    if (msg) {
      idea.messageId = msg.id;
    }
  } catch (error) {
    console.error("[IDEAS] új ötlet -> updateSummaryMessage hiba:", error);
  }

  saveData(data);
  await applyThreadStatusTag(thread, "Nyitott");
}

async function handleStatusChange(client, interaction, ideaId, status, manualReason = "") {
  const shouldDefer =
    typeof interaction.deferReply === "function" &&
    !interaction.deferred &&
    !interaction.replied;

  if (shouldDefer) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const data = loadData();
  const idea = data.ideas[ideaId];

  if (!idea) {
    const payload = { content: "Ez az ötlet már nem található." };

    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(payload);
    }

    return interaction.reply({
      ...payload,
      flags: MessageFlags.Ephemeral,
    });
  }

  ensureIdeaDefaults(idea);

  const finalStatuses = ["Elfogadva", "Elutasítva"];
  const wasFinal = finalStatuses.includes(idea.status);
  const isFinal = finalStatuses.includes(status);

  let reason;
  try {
    reason = await aiDecisionReason({
      idea,
      status,
      trainingExamples: getRecentTrainingExamples(data),
      manualReason,
    });
  } catch (error) {
    console.error("[IDEAS] aiDecisionReason hiba:", error);
    reason = getFallbackDecisionReason(status, manualReason);
  }

  idea.status = status;
  idea.handler = interaction.user?.tag || idea.handler || "Staff";
  idea.aiDecisionReason = limitText(reason, 700);
  idea.lastManualReason = compactText(manualReason || "");
  idea.decidedAt = Date.now();
  idea.updatedAt = Date.now();
  idea.lastForumFeedbackAt = Date.now();
  idea.lastForumFeedbackType = status;

if (isFinal) {
  idea.deleteAt = getState("ideas_enabled")
    ? Date.now() + CONFIG.DELETE_AFTER_MS
    : null;

  addTrainingExample(data, idea, status);
} else {
  idea.deleteAt = null;
  clearDeletionSchedule(idea.id);
}

  try {
    const msg = await updateSummaryMessage(client, idea);
    if (msg) {
      idea.messageId = msg.id;
    }
  } catch (error) {
    console.error("[IDEAS] updateSummaryMessage hiba:", error);
  }

  try {
    await sendFeedbackToAllThreads(
      client,
      idea,
      status,
      idea.aiDecisionReason,
      interaction.user?.tag || "Staff"
    );
  } catch (error) {
    console.error("[IDEAS] sendFeedbackToAllThreads hiba:", error);
  }

  try {
    saveData(data);
  } catch (error) {
    console.error("[IDEAS] saveData hiba:", error);
    throw error;
  }

  if (isFinal) {
    scheduleDeletion(client, idea.id, idea.deleteAt);
  } else if (wasFinal && !isFinal) {
    clearDeletionSchedule(idea.id);
  }

  const replyTextMap = {
    Elfogadva:
      "Az ötlet állapota sikeresen **Elfogadva** lett. A fórum le lett zárva, archiválva lett, és 1 nap múlva törlődni fog.",
    Elutasítva:
      "Az ötlet állapota sikeresen **Elutasítva** lett. A fórum le lett zárva, archiválva lett, és 1 nap múlva törlődni fog.",
    "Dolgozunk rajta":
      "Az ötlet állapota sikeresen **Dolgozunk rajta** lett. A fórumok frissítve lettek.",
  };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({
      content: replyTextMap[status] || "Az ötlet állapota frissítve lett.",
    });
  }

  return interaction.reply({
    content: replyTextMap[status] || "Az ötlet állapota frissítve lett.",
    flags: MessageFlags.Ephemeral,
  });
}

// =========================
// PARSING
// =========================
function parseIdeaInteraction(customId) {
  if (!customId) return { action: null, ideaId: null };

  if (customId.startsWith("idea:")) {
    const parts = customId.split(":");
    return {
      action: parts[1] || null,
      ideaId: parts.slice(2).join(":"),
    };
  }

  return { action: null, ideaId: null };
}

function parseIdeaModal(customId) {
  if (!customId?.startsWith("ideamodal:")) {
    return { action: null, ideaId: null };
  }

  const parts = customId.split(":");
  return {
    action: parts[1] || null,
    ideaId: parts.slice(2).join(":"),
  };
}

// =========================
// REGISZTRÁLÁS
// =========================
function registerIdeaSystem(client) {
  client.once("ready", async () => {
    console.log("[IDEAS] Ötlet modul betöltve.");
    restoreDeletionSchedules(client);
  });
  client.on("systempanel:ideasAiChanged", async () => {
    try {
      await rebuildAllIdeaSummaries(client);
      console.log("[IDEAS] AI állapot változott, summary frissítve.");
    } catch (error) {
      console.error("[IDEAS] AI refresh hiba:", error);
    }
  });
  client.on("threadCreate", async (thread) => {
        if (!getState("ideas_enabled")) return;
    try {
      await processNewForumThread(client, thread);
    } catch (error) {
      console.error("[IDEAS] threadCreate hiba:", error);
    }
  });

  client.on("messageCreate", async (message) => {
        if (!getState("ideas_enabled")) return;
    try {
      await processForumReply(client, message);
    } catch (error) {
      console.error("[IDEAS] messageCreate hiba:", error);
    }
  });

  client.on("interactionCreate", async (interaction) => {
        if (!getState("ideas_enabled")) return;
    try {
      if (interaction.isButton()) {
        if (!interaction.customId.startsWith("idea:")) return;

        const { action, ideaId } = parseIdeaInteraction(interaction.customId);

        if (!ideaId) {
          return interaction.reply({
            content: "Hibás gombazonosító.",
            flags: MessageFlags.Ephemeral,
          });
        }

        if (action === "working") {
          return await handleStatusChange(client, interaction, ideaId, "Dolgozunk rajta");
        }

        if (action === "accepted" || action === "rejected") {
          const modal = createDecisionModal(action, ideaId);
          return await interaction.showModal(modal);
        }

        return interaction.reply({
          content: "Ismeretlen ötlet gomb.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.isModalSubmit()) {
        if (!interaction.customId.startsWith("ideamodal:")) return;

        const { action, ideaId } = parseIdeaModal(interaction.customId);

        if (!ideaId) {
          return interaction.reply({
            content: "Hibás modal azonosító.",
            flags: MessageFlags.Ephemeral,
          });
        }

        const manualReason = compactText(
          interaction.fields.getTextInputValue("reason") || ""
        );

        if (action === "accepted") {
          return await handleStatusChange(
            client,
            interaction,
            ideaId,
            "Elfogadva",
            manualReason
          );
        }

        if (action === "rejected") {
          return await handleStatusChange(
            client,
            interaction,
            ideaId,
            "Elutasítva",
            manualReason
          );
        }

        return interaction.reply({
          content: "Ismeretlen modal művelet.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      console.error("[IDEAS] interactionCreate hiba:", error);

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
const aiEnabled = getState("ideas_ai_grouping");

if (!aiEnabled) {
  idea.aiSummary = "⚙️ Kikapcsolva az AI megjegyzés.";
}
module.exports = { registerIdeaSystem };