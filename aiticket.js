const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionsBitField,
  MessageFlags,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const knowledge = require("./ticketKnowledge");

// =========================
// ⚙️ KONFIG
// =========================

const CONFIG = {
  TICKET_CATEGORY_ID: "1460215371666686077",
  STAFF_PING_ROLE_ID: "1403401954712883200",
  STAFF_PING_MODE: "everyone", // "role" vagy "everyone"

  // Ezek zárhatják le a ticketet a tulajdonoson kívül
  CLOSE_ALLOWED_ROLE_IDS: [
    "1322545317995876397",
    
  ],

  // Ezek kezelhetik az Átveszem + AI ki/be gombokat
  CONTROL_ALLOWED_ROLE_IDS: [
    "1322545317995876397",
    
  ],

  AI_MODEL: "gpt-5-mini",

  DATA_DIR: path.join(__dirname, "data"),
  MEMORY_FILE: path.join(__dirname, "data", "ticket_memory.json"),
  CASES_FILE: path.join(__dirname, "data", "ticket_cases.json"),
  RULES_FILE: path.join(__dirname, "serverRules.txt"),

  MAX_CONTEXT_MESSAGES: 12,
  MAX_SIMILAR_CASES: 4,
  MAX_AI_REPLY_CHARS: 1800,
  MAX_STAFF_SUMMARY_CHARS: 1500,
  MAX_FACTS: 20,

  USER_RATE_LIMIT_MS: 5000,
  SMALLTALK_COOLDOWN_MS: 12000,

  PANEL_BUTTON_ID: "aiticket_open",
  TAKEOVER_BUTTON_ID: "aiticket_takeover",
  TOGGLE_BUTTON_ID: "aiticket_toggle",
  CLOSE_BUTTON_ID: "aiticket_close",

  CHANNEL_PREFIX: "ai-ticket",
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================
// 📁 FÁJLKEZELÉS
// =========================

ensureDataFiles();

function ensureDataFiles() {
  if (!fs.existsSync(CONFIG.DATA_DIR)) {
    fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(CONFIG.MEMORY_FILE)) {
    fs.writeFileSync(
      CONFIG.MEMORY_FILE,
      JSON.stringify({ tickets: {}, cooldowns: {} }, null, 2),
      "utf8"
    );
  }

  if (!fs.existsSync(CONFIG.CASES_FILE)) {
    fs.writeFileSync(
      CONFIG.CASES_FILE,
      JSON.stringify({ cases: [] }, null, 2),
      "utf8"
    );
  }
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function loadMemory() {
  return readJSON(CONFIG.MEMORY_FILE, { tickets: {}, cooldowns: {} });
}

function saveMemory(data) {
  writeJSON(CONFIG.MEMORY_FILE, data);
}

function loadCases() {
  return readJSON(CONFIG.CASES_FILE, { cases: [] });
}

function saveCases(data) {
  writeJSON(CONFIG.CASES_FILE, data);
}

function loadServerRules() {
  try {
    if (!fs.existsSync(CONFIG.RULES_FILE)) return "";
    return fs.readFileSync(CONFIG.RULES_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

// =========================
// 🧰 SEGÉDEK
// =========================

function normalize(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function compact(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function truncate(text = "", max = 1000) {
  const t = compact(text);
  if (!t) return "-";
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 3))}...`;
}

function nowIso() {
  return new Date().toISOString();
}

function isTicketChannel(channel) {
  return Boolean(channel?.name?.startsWith(`${CONFIG.CHANNEL_PREFIX}-`));
}

function sanitizeChannelName(text = "") {
  return normalize(text)
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70) || "ticket";
}

function containsAny(text, words = []) {
  const n = normalize(text);
  return words.some((w) => n.includes(normalize(w)));
}

function hasAnyRole(member, roleIds = []) {
  if (!member?.roles?.cache) return false;
  return roleIds.some((id) => member.roles.cache.has(id));
}

function canControl(member) {
  return (
    hasAnyRole(member, CONFIG.CONTROL_ALLOWED_ROLE_IDS) ||
    member?.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

function canClose(member, ticket) {
  if (!member || !ticket) return false;
  if (member.id === ticket.ownerId) return true;

  return (
    hasAnyRole(member, CONFIG.CLOSE_ALLOWED_ROLE_IDS) ||
    member?.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

function getTicket(channelId) {
  const memory = loadMemory();
  return memory.tickets[channelId] || null;
}

function setTicket(channelId, patch) {
  const memory = loadMemory();
  memory.tickets[channelId] = {
    ...(memory.tickets[channelId] || {}),
    ...patch,
  };
  saveMemory(memory);
  return memory.tickets[channelId];
}

function deleteTicket(channelId) {
  const memory = loadMemory();
  delete memory.tickets[channelId];
  saveMemory(memory);
}

function pushTicketMessage(channelId, entry) {
  const memory = loadMemory();
  if (!memory.tickets[channelId]) return;

  if (!Array.isArray(memory.tickets[channelId].messages)) {
    memory.tickets[channelId].messages = [];
  }

  memory.tickets[channelId].messages.push(entry);

  if (memory.tickets[channelId].messages.length > 50) {
    memory.tickets[channelId].messages = memory.tickets[channelId].messages.slice(-50);
  }

  saveMemory(memory);
}

function addFact(channelId, fact) {
  const memory = loadMemory();
  if (!memory.tickets[channelId]) return;

  if (!Array.isArray(memory.tickets[channelId].facts)) {
    memory.tickets[channelId].facts = [];
  }

  const cleaned = compact(fact);
  if (!cleaned) return;

  if (!memory.tickets[channelId].facts.includes(cleaned)) {
    memory.tickets[channelId].facts.push(cleaned);
  }

  memory.tickets[channelId].facts = memory.tickets[channelId].facts.slice(-CONFIG.MAX_FACTS);
  saveMemory(memory);
}

function getCooldownKey(channelId, userId, type = "reply") {
  return `${channelId}:${userId}:${type}`;
}

function allowByCooldown(channelId, userId, type, ms) {
  const memory = loadMemory();
  const key = getCooldownKey(channelId, userId, type);
  const last = memory.cooldowns[key] || 0;

  if (Date.now() - last < ms) {
    return false;
  }

  memory.cooldowns[key] = Date.now();
  saveMemory(memory);
  return true;
}

function getRecentContext(channelId, max = CONFIG.MAX_CONTEXT_MESSAGES) {
  const ticket = getTicket(channelId);
  if (!ticket?.messages?.length) return [];
  return ticket.messages.slice(-max);
}

function similarity(a = "", b = "") {
  const sa = new Set(normalize(a).split(/\s+/).filter(Boolean));
  const sb = new Set(normalize(b).split(/\s+/).filter(Boolean));
  if (!sa.size || !sb.size) return 0;

  let common = 0;
  for (const item of sa) {
    if (sb.has(item)) common++;
  }

  return common / Math.max(sa.size, sb.size);
}

function getSimilarCases(inputText, category) {
  const db = loadCases();
  return db.cases
    .filter((c) => !category || c.category === category)
    .map((c) => ({
      ...c,
      score: similarity(
        inputText,
        `${c.userProblem} ${c.aiSummary} ${c.staffAnswerSummary} ${c.finalOutcome}`
      ),
    }))
    .filter((c) => c.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, CONFIG.MAX_SIMILAR_CASES);
}

function buildControlRow(ticket) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CONFIG.TAKEOVER_BUTTON_ID)
      .setLabel("Átveszem")
      .setEmoji("🛡️")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(CONFIG.TOGGLE_BUTTON_ID)
      .setLabel(ticket?.aiEnabled === false ? "AI bekapcsolása" : "AI kikapcsolása")
      .setEmoji(ticket?.aiEnabled === false ? "🟢" : "📴")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(CONFIG.CLOSE_BUTTON_ID)
      .setLabel("Lezárás")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );
}

function classifyText(text = "") {
  const n = normalize(text);

  let bestKey = "segitseg";
  let bestScore = 0;

  for (const [key, meta] of Object.entries(knowledge.categories || {})) {
    let score = 0;
    for (const hint of meta.hints || []) {
      if (n.includes(normalize(hint))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }

  return {
    category: bestKey,
    score: bestScore,
  };
}

function findQuickReply(text = "") {
  for (const item of knowledge.quickReplies || []) {
    if (containsAny(text, item.triggers || [])) return item.reply;
  }
  return null;
}

function isSmallTalk(text = "") {
  return containsAny(text, knowledge.smallTalkTriggers || []);
}

function needsForcedEscalation(text = "") {
  return containsAny(text, knowledge.forcedEscalationTriggers || []);
}

function buildRulesSnippet(fullRules = "") {
  const trimmed = compact(fullRules);
  if (!trimmed) return "Nincs külön beolvasott teljes szabályzat.";
  return truncate(trimmed, 9000);
}

function systemPrompt() {
  const fullRules = loadServerRules();

  return `
${compact(knowledge.assistantIdentity || "")}

Fő szabályok:
${(knowledge.safetyRules || []).map((r, i) => `${i + 1}. ${r}`).join("\n")}

Szigorú korlátok:
${(knowledge.hardLimits || []).map((r, i) => `${i + 1}. ${r}`).join("\n")}

Eszkalációs irányelvek:
${(knowledge.escalationGuidelines || []).map((r, i) => `${i + 1}. ${r}`).join("\n")}

Szerverszabályzat kivonat:
${Object.entries(knowledge.ruleSummary || {})
  .map(([key, arr]) => `- ${key}: ${(arr || []).join(" ")}`)
  .join("\n")}

Teljes beolvasott szerverszabályzat:
${buildRulesSnippet(fullRules)}

Válasz stílus:
- Mindig magyarul válaszolj.
- Rövid, tiszta, ügyintéző jellegű legyen.
- Ne chatelj feleslegesen.
- Egyszerű help kérdésnél röviden segíts.
- Vitás, szabályértelmezési vagy bizonyítékos ügyben ne dönts, hanem kérdezz vissza vagy irányíts staffhoz.
- Soha ne tegyél úgy, mintha végleges admin döntést hoznál.
- Soha ne mondj biztos ítéletet DM/RDM/MG/RK/ForceRP/FearRP ügyben.
- Minden kontextus GTA 5 RP szerveres, nem IRL.
`;
}

function buildConversationForAI(ticket, userMessage, category, similarCases) {
  const recent = getRecentContext(ticket.channelId, CONFIG.MAX_CONTEXT_MESSAGES);
  const facts = Array.isArray(ticket.facts) ? ticket.facts : [];
  const categoryMeta = knowledge.categories?.[category] || knowledge.categories?.segitseg || {};

  const contextText = recent
    .map((m) => `${String(m.role || "user").toUpperCase()}: ${truncate(m.content, 240)}`)
    .join("\n");

  const factsText = facts.length
    ? facts.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "Nincs még rögzített fontos tény.";

  const similarText = similarCases.length
    ? similarCases
        .map(
          (c, i) => `${i + 1}. Kategória: ${c.categoryLabel || c.category}
- Játékos probléma: ${truncate(c.userProblem, 180)}
- AI összegzés: ${truncate(c.aiSummary, 180)}
- Staff válasz összegzés: ${truncate(c.staffAnswerSummary, 180)}
- Végkimenetel: ${truncate(c.finalOutcome, 120)}`
        )
        .join("\n\n")
    : "Nincs hasonló korábbi eset.";

  return `
Ticket meta:
- Kategória: ${categoryMeta.label || "Segítségkérés"}
- Staff szükséges alapból: ${categoryMeta.staffRequired ? "igen" : "nem"}
- Ticket tulajdonos: ${ticket.ownerTag}
- AI engedélyezve: ${ticket.aiEnabled === false ? "nem" : "igen"}

Fontos tények:
${factsText}

Közelmúlt beszélgetés:
${contextText || "Nincs előzmény."}

Hasonló korábbi lezárt esetek:
${similarText}

Ha még hiányos az ügy, ezekből kérdezz:
${(categoryMeta.collect || []).map((q, i) => `${i + 1}. ${q}`).join("\n") || "Nincs megadott kérdéssor."}

Jelenlegi játékos üzenet:
${userMessage}

Feladat:
- válaszolj magyarul
- maximum 6-7 mondat
- ha kell, kérdezz vissza
- ha staff szükséges, mondd ki kulturáltan
- ne írj technikai elemzést
`;
}

async function generateAIReply(ticket, userMessage, category, similarCases) {
  const completion = await openai.chat.completions.create({
    model: CONFIG.AI_MODEL,
    temperature: 0.35,
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: buildConversationForAI(ticket, userMessage, category, similarCases) },
    ],
  });

  let reply =
    completion.choices?.[0]?.message?.content ||
    "Kérlek írd le részletesebben a problémát, hogy pontosabban tudjak segíteni.";

  reply = compact(reply);

  if (reply.length > CONFIG.MAX_AI_REPLY_CHARS) {
    reply = `${reply.slice(0, CONFIG.MAX_AI_REPLY_CHARS - 3)}...`;
  }

  return reply;
}

function buildTicketSummary(ticket) {
  const facts = Array.isArray(ticket.facts) && ticket.facts.length
    ? ticket.facts.map((f) => `• ${truncate(f, 180)}`).join("\n")
    : "• Még nincs külön rögzített tény.";

  return [
    `**Kategória:** ${ticket.categoryLabel || "Ismeretlen"}`,
    `**Tulajdonos:** <@${ticket.ownerId}>`,
    `**AI által jelzett ok:** ${ticket.escalationReason || "Staff vagy emberi ellenőrzés szükséges."}`,
    "",
    `**Fontos tények:**`,
    facts,
  ].join("\n");
}

async function escalateToStaff(channel, ticket, reason) {
  if (!ticket || ticket.escalated) return;

  const updated = setTicket(channel.id, {
    escalated: true,
    escalationReason: reason || "Emberi ellenőrzés szükséges.",
  });

  const embed = new EmbedBuilder()
    .setTitle("📌 AI átadás staffnak")
    .setColor(0xf1c40f)
    .setDescription(buildTicketSummary(updated))
    .setFooter({
      text: "Az AI nem hoz végleges döntést. Az ügyet az illetékes staff kezeli tovább.",
    })
    .setTimestamp();

  await channel.send({
    content: "@everyone",
    allowedMentions: {
      parse: ["everyone"],
    },
    embeds: [embed],
    components: [buildControlRow(updated)],
  });
}

function storeClosedCase(ticket, closingSummary = "") {
  const db = loadCases();

  db.cases.push({
    id: ticket.caseId || `${ticket.channelId}-${Date.now()}`,
    closedAt: nowIso(),
    category: ticket.categoryKey || "segitseg",
    categoryLabel: ticket.categoryLabel || "Segítségkérés",
    userProblem: truncate(ticket.firstProblem || ticket.lastUserMessage || "", 500),
    aiSummary: truncate(ticket.aiSummary || ticket.escalationReason || "", 500),
    staffAnswerSummary: truncate(
      closingSummary || ticket.staffAnswerSummary || "",
      CONFIG.MAX_STAFF_SUMMARY_CHARS
    ),
    finalOutcome: truncate(
      ticket.takenOverBy
        ? `Staff átvette: ${ticket.takenOverByTag || ticket.takenOverBy}`
        : ticket.escalated
          ? "Közös ping után staff kezelés"
          : "AI megválaszolta vagy normál lezárás történt",
      220
    ),
  });

  if (db.cases.length > 500) {
    db.cases = db.cases.slice(-500);
  }

  saveCases(db);
}

// =========================
// 🎫 SLASH COMMAND
// =========================

function getSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName("sendaiticketpanel")
      .setDescription("AI ticket panel kiküldése.")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  ];
}

async function handleSlashCommand(interaction) {
  if (interaction.commandName !== "sendaiticketpanel") return false;

  const embed = new EmbedBuilder()
    .setTitle("🎫 Ügyintézés indítása")
    .setColor(0x1f8f4e)
    .setDescription(
      [
        "Kattints a gombra, és létrejön egy privát szöveges ticket csatorna.",
        "",
        "Az AI asszisztens tud:",
        "• eligazítani egyszerű kérdésekben",
        "• összegyűjteni az ügy részleteit",
        "• szükség esetén staffot hívni",
        "",
        "Fontos: az AI nem hoz végleges staff döntést.",
      ].join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CONFIG.PANEL_BUTTON_ID)
      .setLabel("Ügyintézés indítása")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Success)
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
  });

  return true;
}

// =========================
// 🟢 TICKET NYITÁS
// =========================

async function handleOpenButton(interaction) {
  if (interaction.customId !== CONFIG.PANEL_BUTTON_ID) return false;

  const existingChannel = interaction.guild.channels.cache.find((ch) => {
    const t = getTicket(ch.id);
    return t && t.ownerId === interaction.user.id;
  });

  if (existingChannel) {
    await interaction.reply({
      content: `Már van nyitott AI ticketed: ${existingChannel}`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const baseName = sanitizeChannelName(
    interaction.user.username || interaction.user.displayName || "jatekos"
  );

  const channel = await interaction.guild.channels.create({
    name: `${CONFIG.CHANNEL_PREFIX}-${baseName}`,
    type: ChannelType.GuildText,
    parent: CONFIG.TICKET_CATEGORY_ID,
    permissionOverwrites: [
      {
        id: interaction.guild.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: CONFIG.STAFF_PING_ROLE_ID,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ManageMessages,
        ],
      },
    ],
  });

  const ticket = setTicket(channel.id, {
    channelId: channel.id,
    ownerId: interaction.user.id,
    ownerTag: interaction.user.tag,
    aiEnabled: true,
    escalated: false,
    facts: [],
    messages: [],
    categoryKey: "segitseg",
    categoryLabel: "Segítségkérés",
    firstProblem: "",
    lastUserMessage: "",
    aiSummary: "",
    takenOverBy: null,
    takenOverByTag: null,
    createdAt: nowIso(),
    caseId: `${channel.id}-${Date.now()}`,
  });

  const embed = new EmbedBuilder()
    .setTitle("🤖 AI ügyintéző ticket")
    .setColor(0x1f8f4e)
    .setDescription(
      [
        `Szia ${interaction.user}!`,
        "",
        "Létrejött a privát szöveges ticket csatornád.",
        "Itt leírhatod a problémádat, és az AI megpróbál segíteni vagy staffot hívni.",
        "",
        "Fontos:",
        "• nem hozok végleges admin döntést",
        "• nem ítélkezem vitás ügyben",
        "• komoly ügyet átadok staffnak",
        "",
        "Írd le röviden, miben segíthetek.",
      ].join("\n")
    )
    .setTimestamp();

  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [embed],
    components: [buildControlRow(ticket)],
  });

  await interaction.reply({
    content: `A ticketed létrejött itt: ${channel}`,
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

// =========================
// 🛡️ GOMBOK
// =========================

async function handleTakeover(interaction) {
  if (interaction.customId !== CONFIG.TAKEOVER_BUTTON_ID) return false;

  const ticket = getTicket(interaction.channel.id);
  if (!ticket) {
    await interaction.reply({
      content: "Ehhez a csatornához nem találok ticket adatot.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!canControl(interaction.member)) {
    await interaction.reply({
      content: "Ehhez a gombhoz nincs jogosultságod.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const updated = setTicket(interaction.channel.id, {
    takenOverBy: interaction.user.id,
    takenOverByTag: interaction.user.tag,
    aiEnabled: false,
  });

  await interaction.reply({
    content: `Átvetted az ügyet. Az AI kikapcsolt ebben a ticketben. (${interaction.user})`,
  });

  try {
    const msg = await interaction.message.fetch();
    await msg.edit({ components: [buildControlRow(updated)] });
  } catch {}

  return true;
}

async function handleToggle(interaction) {
  if (interaction.customId !== CONFIG.TOGGLE_BUTTON_ID) return false;

  const ticket = getTicket(interaction.channel.id);
  if (!ticket) {
    await interaction.reply({
      content: "Ehhez a csatornához nem találok ticket adatot.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!canControl(interaction.member)) {
    await interaction.reply({
      content: "Ehhez a gombhoz nincs jogosultságod.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const updated = setTicket(interaction.channel.id, {
    aiEnabled: !ticket.aiEnabled,
  });

  await interaction.reply({
    content: updated.aiEnabled
      ? "Az AI vissza lett kapcsolva ebben a ticketben."
      : "Az AI ki lett kapcsolva ebben a ticketben.",
    flags: MessageFlags.Ephemeral,
  });

  try {
    const msg = await interaction.message.fetch();
    await msg.edit({ components: [buildControlRow(updated)] });
  } catch {}

  return true;
}

async function handleClose(interaction) {
  if (interaction.customId !== CONFIG.CLOSE_BUTTON_ID) return false;

  const ticket = getTicket(interaction.channel.id);
  if (!ticket) {
    await interaction.reply({
      content: "Ehhez a csatornához nem találok ticket adatot.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!canClose(interaction.member, ticket)) {
    await interaction.reply({
      content: "Ezt a ticketet csak a létrehozója vagy a megadott staff rang zárhatja le.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const closerText = `${interaction.user.tag} (${interaction.user.id})`;
  storeClosedCase(ticket, `A ticketet lezárta: ${closerText}`);

  await interaction.reply({
    content: "A ticket lezárásra került.",
  });

  deleteTicket(interaction.channel.id);

  setTimeout(async () => {
    try {
      await interaction.channel.delete("AI ticket lezárva");
    } catch {}
  }, 1500);

  return true;
}

// =========================
// 💬 MESSAGE CREATE
// =========================

async function maybeReplyInTicket(message) {
  if (!isTicketChannel(message.channel)) return;
  if (message.author.bot) return;

  const ticket = getTicket(message.channel.id);
  if (!ticket) return;

  const authorIsOwner = message.author.id === ticket.ownerId;
  const authorIsStaff =
    canControl(message.member) ||
    hasAnyRole(message.member, CONFIG.CLOSE_ALLOWED_ROLE_IDS);

  pushTicketMessage(message.channel.id, {
    role: authorIsStaff ? "staff" : authorIsOwner ? "user" : "other",
    authorId: message.author.id,
    authorTag: message.author.tag,
    content: message.content,
    createdAt: nowIso(),
  });

  // staff üzenetekből ment minta
  if (authorIsStaff && !authorIsOwner) {
    const oldSummary = ticket.staffAnswerSummary || "";
    const joined = compact(`${oldSummary} ${message.content}`);
    setTicket(message.channel.id, {
      staffAnswerSummary: truncate(joined, CONFIG.MAX_STAFF_SUMMARY_CHARS),
    });
    return;
  }

  // csak a ticket tulajdonosára reagál az AI
  if (!authorIsOwner) return;

  if (ticket.aiEnabled === false) return;

  if (!allowByCooldown(message.channel.id, message.author.id, "reply", CONFIG.USER_RATE_LIMIT_MS)) {
    return;
  }

  const userText = compact(message.content);
  if (!userText) return;

  if (!ticket.firstProblem) {
    setTicket(message.channel.id, {
      firstProblem: truncate(userText, 500),
    });
  }

  setTicket(message.channel.id, {
    lastUserMessage: truncate(userText, 1000),
  });

  if (isSmallTalk(userText)) {
    if (!allowByCooldown(message.channel.id, message.author.id, "smalltalk", CONFIG.SMALLTALK_COOLDOWN_MS)) {
      return;
    }

    const reply =
      "Ez egy ügyintéző ticket csatorna. Kérlek írd le röviden a problémádat, és segítek eligazodni.";

    await message.reply(reply);

    pushTicketMessage(message.channel.id, {
      role: "assistant",
      authorId: "ai",
      authorTag: "AI",
      content: reply,
      createdAt: nowIso(),
    });
    return;
  }

  const quick = findQuickReply(userText);
  const classified = classifyText(userText);
  const categoryMeta =
    knowledge.categories?.[classified.category] || knowledge.categories?.segitseg || {
      label: "Segítségkérés",
      staffRequired: false,
      collect: [],
    };

  setTicket(message.channel.id, {
    categoryKey: classified.category,
    categoryLabel: categoryMeta.label,
  });

  addFact(message.channel.id, `Legutóbbi játékos üzenet: ${truncate(userText, 250)}`);

  if (needsForcedEscalation(userText) || categoryMeta.staffRequired) {
    const similarCases = getSimilarCases(userText, classified.category);
    const aiReply = await generateAIReply(
      { ...getTicket(message.channel.id), channelId: message.channel.id },
      userText,
      classified.category,
      similarCases
    );

    setTicket(message.channel.id, {
      aiSummary: truncate(aiReply, 700),
    });

    await message.reply(aiReply);

    pushTicketMessage(message.channel.id, {
      role: "assistant",
      authorId: "ai",
      authorTag: "AI",
      content: aiReply,
      createdAt: nowIso(),
    });

    await escalateToStaff(
      message.channel,
      getTicket(message.channel.id),
      `${categoryMeta.label} kategória vagy eszkalációs trigger miatt staff szükséges.`
    );

    return;
  }

  if (quick) {
    await message.reply(quick);

    pushTicketMessage(message.channel.id, {
      role: "assistant",
      authorId: "ai",
      authorTag: "AI",
      content: quick,
      createdAt: nowIso(),
    });

    setTicket(message.channel.id, {
      aiSummary: truncate(quick, 700),
    });

    return;
  }

  const similarCases = getSimilarCases(userText, classified.category);
  const aiReply = await generateAIReply(
    { ...getTicket(message.channel.id), channelId: message.channel.id },
    userText,
    classified.category,
    similarCases
  );

  setTicket(message.channel.id, {
    aiSummary: truncate(aiReply, 700),
  });

  await message.reply(aiReply);

  pushTicketMessage(message.channel.id, {
    role: "assistant",
    authorId: "ai",
    authorTag: "AI",
    content: aiReply,
    createdAt: nowIso(),
  });
}

// =========================
// 🔌 INTERACTION ROUTER
// =========================

async function handleInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    return handleSlashCommand(interaction);
  }

  if (interaction.isButton()) {
    if (await handleOpenButton(interaction)) return true;
    if (await handleTakeover(interaction)) return true;
    if (await handleToggle(interaction)) return true;
    if (await handleClose(interaction)) return true;
  }

  return false;
}

module.exports = {
  getSlashCommands,
  handleInteraction,
  maybeReplyInTicket,
};