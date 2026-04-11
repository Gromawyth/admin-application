"use strict";

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const openai =
  process.env.OPENAI_API_KEY && !String(process.env.OPENAI_API_KEY).includes("IDE_IRD")
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const CONFIG = {
  BRAND_NAME: "internalGaming",
  AI_MODEL: "gpt-5-mini",
  DATA_DIR: process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data"),
  DATA_FILE: path.join(
    process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data"),
    "embedstudio-data.json"
  ),
  PREVIEW_EXPIRE_MS: 15 * 60 * 1000,
  DEFAULT_COLOR: 0x16a34a,
  LOG_CHANNEL_ID: process.env.EMBED_STUDIO_LOG_CHANNEL_ID || "",
  MAX_SAVED_PRESETS: 60,
};

fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });

const PRESETS = {
  kozlemeny: {
    name: "Közlemény",
    emoji: "📢",
    color: 0x16a34a,
    author: "internalGaming • Közlemény",
    footer: "internalGaming • Hivatalos közlemény",
    tone: "hivatalos, tiszta, emberi, prémium",
  },
  frissites: {
    name: "Frissítés",
    emoji: "🛠️",
    color: 0x2563eb,
    author: "internalGaming • Frissítés",
    footer: "internalGaming • Fejlesztési információ",
    tone: "informatív, modern, jól tagolt",
  },
  esemeny: {
    name: "Esemény",
    emoji: "🎉",
    color: 0xd97706,
    author: "internalGaming • Esemény",
    footer: "internalGaming • Esemény információ",
    tone: "lendületes, figyelemfelkeltő, közösségi",
  },
  szabaly: {
    name: "Szabályzat",
    emoji: "📜",
    color: 0xdc2626,
    author: "internalGaming • Szabályzat",
    footer: "internalGaming • Szabályzati tájékoztató",
    tone: "határozott, világos, félreérthetetlen",
  },
  toborzas: {
    name: "Toborzás",
    emoji: "🧩",
    color: 0x7c3aed,
    author: "internalGaming • Toborzás",
    footer: "internalGaming • Jelentkezési információ",
    tone: "motiváló, prémium, emberközeli",
  },
  figyelmeztetes: {
    name: "Figyelmeztetés",
    emoji: "⚠️",
    color: 0xea580c,
    author: "internalGaming • Figyelmeztetés",
    footer: "internalGaming • Fontos információ",
    tone: "erős, rövid, sürgős",
  },
  premium: {
    name: "Premium",
    emoji: "✦",
    color: 0x0f172a,
    author: "internalGaming • Premium",
    footer: "internalGaming • Exkluzív információ",
    tone: "nagyon prémium, elegáns, sötétebb, vizuálisan erős",
  },
  sheriff: {
    name: "Sheriff",
    emoji: "⭐",
    color: 0x1e3a8a,
    author: "internalGaming • Sheriff Update",
    footer: "internalGaming • Sheriff Division",
    tone: "tekintélyes, hivatalos, komoly",
  },
};

const BUILT_IN_TEMPLATES = {
  maintenance: {
    preset: "figyelmeztetes",
    title: "Karbantartás",
    description:
      "A szerveren hamarosan karbantartás indul. A munkálatok ideje alatt előfordulhat rövid ideig tartó instabilitás vagy átmeneti elérhetetlenség.",
    content: "",
    mood: "komoly, hivatalos, tiszta",
  },
  restart: {
    preset: "frissites",
    title: "Szerver újraindítás",
    description:
      "Hamarosan újraindítás történik. Kérünk mindenkit, hogy időben zárja le a folyamatban lévő dolgait, és készüljön fel a rövid kiesésre.",
    content: "",
    mood: "informatív, rövid, tiszta",
  },
  recruitment: {
    preset: "toborzas",
    title: "Jelentkezés megnyitva",
    description:
      "Megnyitottuk a jelentkezést. Ha úgy érzed, hogy hozzá tudsz tenni a közösség működéséhez, most itt a lehetőség, hogy csatlakozz hozzánk.",
    content: "",
    mood: "motiváló, prémium, emberi",
  },
  rules: {
    preset: "szabaly",
    title: "Fontos szabályzati emlékeztető",
    description:
      "Kérünk mindenkit, hogy fokozottan figyeljen a szabályok betartására. A visszatérő vagy egyértelmű szabályszegések esetén a staff következetesen fog eljárni.",
    content: "",
    mood: "határozott, tiszta, komoly",
  },
  event: {
    preset: "esemeny",
    title: "Közelgő esemény",
    description:
      "Hamarosan indul egy új közösségi esemény. Érdemes figyelni a bejelentéseket, mert rövidesen több információ is érkezik.",
    content: "",
    mood: "izgalmas, közösségi, figyelemfelkeltő",
  },
  update: {
    preset: "frissites",
    title: "Új fejlesztések érkeztek",
    description:
      "Az elmúlt időszakban több javítás és finomhangolás is bekerült. A cél most is az volt, hogy stabilabb, átláthatóbb és élvezhetőbb legyen az egész rendszer.",
    content: "",
    mood: "modern, informatív, igényes",
  },
};

function defaultStore() {
  return {
    previews: {},
    savedTemplates: {},
    meta: {
      lastRegisteredAt: 0,
    },
  };
}

function loadStore() {
  try {
    if (!fs.existsSync(CONFIG.DATA_FILE)) {
      const fresh = defaultStore();
      fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(fresh, null, 2), "utf8");
      return fresh;
    }

    const raw = fs.readFileSync(CONFIG.DATA_FILE, "utf8");
    if (!raw.trim()) return defaultStore();

    const parsed = JSON.parse(raw);
    return {
      previews: parsed.previews || {},
      savedTemplates: parsed.savedTemplates || {},
      meta: parsed.meta || { lastRegisteredAt: 0 },
    };
  } catch (error) {
    console.error("[EMBEDSTUDIO] loadStore hiba:", error);
    return defaultStore();
  }
}

let store = loadStore();

function saveStore() {
  try {
    fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    console.error("[EMBEDSTUDIO] saveStore hiba:", error);
  }
}

function cleanupExpiredPreviews() {
  const now = Date.now();
  for (const [id, item] of Object.entries(store.previews || {})) {
    if (!item || !item.expiresAt || item.expiresAt < now) {
      delete store.previews[id];
    }
  }
}

function hasStaffPermission(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ||
      interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)
  );
}

function text(value, max = 4000) {
  const v = String(value || "").trim();
  if (!v) return "";
  return v.length > max ? `${v.slice(0, max - 3)}...` : v;
}

function normalizeColor(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const hex = raw.replace("#", "");

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return parseInt(hex, 16);
}

function safeChannel(channel) {
  return Boolean(
    channel &&
      typeof channel.send === "function" &&
      [
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread,
      ].includes(channel.type)
  );
}

function divider() {
  return "━━━━━━━━━━━━━━━━━━━━━━";
}

function compactParagraphs(input = "") {
  return String(input || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
}

function applyVisualDescription(description = "", cta = "") {
  const body = compactParagraphs(description);
  const parts = [];

  if (body) parts.push(divider(), body, divider());
  if (cta) parts.push(`**${cta}**`);

  return parts.join("\n");
}

function getPresetMeta(key) {
  return PRESETS[key] || PRESETS.kozlemeny;
}

function serializePreview(data) {
  return JSON.parse(JSON.stringify(data));
}

function buildEmbed(data) {
  const preset = getPresetMeta(data.presetKey);
  const embed = new EmbedBuilder()
    .setColor(
      typeof data.color === "number" ? data.color : preset.color || CONFIG.DEFAULT_COLOR
    )
    .setTitle(
      text(
        data.title
          ? `${preset.emoji} ${data.title}`
          : `${preset.emoji} ${preset.name}`,
        256
      )
    );

  const desc = applyVisualDescription(data.description, data.aiCta || "");
  if (desc) embed.setDescription(text(desc, 4096));

  embed.setAuthor({
    name: text(data.author || preset.author || CONFIG.BRAND_NAME, 256),
  });

  embed.setFooter({
    text: text(data.footer || preset.footer || CONFIG.BRAND_NAME, 2048),
  });

  if (data.thumbnailUrl) embed.setThumbnail(data.thumbnailUrl);
  if (data.imageUrl) embed.setImage(data.imageUrl);
  if (data.timestamp) embed.setTimestamp(new Date());

  if (data.fields?.length) {
    embed.addFields(
      data.fields
        .filter((f) => f && f.name && f.value)
        .slice(0, 8)
        .map((f) => ({
          name: text(f.name, 256),
          value: text(f.value, 1024),
          inline: Boolean(f.inline),
        }))
    );
  }

  return embed;
}

function buildPayload(data) {
  const mentionBits = [];
  if (data.everyone) mentionBits.push("@everyone");
  if (data.roleId) mentionBits.push(`<@&${data.roleId}>`);

  const topContent = [mentionBits.join(" ").trim(), text(data.contentText, 2000)]
    .filter(Boolean)
    .join("\n")
    .trim();

  return {
    content: topContent || undefined,
    embeds: [buildEmbed(data)],
    allowedMentions: {
      parse: data.everyone ? ["everyone"] : [],
      roles: data.roleId ? [data.roleId] : [],
    },
  };
}

function previewButtons(previewId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`embedstudio:publish:${previewId}`)
        .setLabel("Küldés")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`embedstudio:cancel:${previewId}`)
        .setLabel("Mégse")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

async function aiRewrite({
  title,
  description,
  presetKey,
  mood,
  mode = "rewrite",
}) {
  const fallback = {
    title: title || "",
    description: description || "",
    cta: "",
    fields: [],
  };

  if (!openai) return fallback;

  const preset = getPresetMeta(presetKey);

  const prompt = `
Te egy Discord announcement / embed szövegíró vagy.

Feladat:
- írj természetes, emberi, magyar szöveget
- ne legyen AI szagú
- Discord embedhez illő legyen
- jól nézzen ki vizuálisan
- ne legyen túl hosszú
- legyen prémium hatása
- a stílus igazodjon a megadott presethez

Mód: ${mode}
Szerver: ${CONFIG.BRAND_NAME}
Preset: ${preset.name}
Preset hangulat: ${preset.tone}
Extra hangulat: ${mood || "nincs"}

Cím:
${title || "-"}

Leírás:
${description || "-"}

Csak JSON:
{
  "title": "új cím",
  "description": "új leírás",
  "cta": "egy rövid call-to-action vagy üres",
  "fields": [
    { "name": "mező neve", "value": "mező értéke", "inline": true }
  ]
}

Szabályok:
- a fields tömb lehet üres
- maximum 3 mezőt adj
- ha nincs szükség mezőre, adj üres tömböt
- a cta legyen rövid
`;

  try {
    const response = await openai.responses.create({
      model: CONFIG.AI_MODEL,
      input: prompt,
      reasoning: { effort: "low" },
    });

    const raw = String(response.output_text || "").trim();
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1) return fallback;

    const parsed = JSON.parse(raw.slice(first, last + 1));

    return {
      title: text(parsed.title || title || "", 256),
      description: text(parsed.description || description || "", 3500),
      cta: text(parsed.cta || "", 220),
      fields: Array.isArray(parsed.fields)
        ? parsed.fields.slice(0, 3).map((f) => ({
            name: text(f?.name || "", 256),
            value: text(f?.value || "", 1024),
            inline: Boolean(f?.inline),
          }))
        : [],
    };
  } catch (error) {
    console.error("[EMBEDSTUDIO] aiRewrite hiba:", error?.message || error);
    return fallback;
  }
}

async function aiImproveOnlyDescription({
  title,
  description,
  presetKey,
  mood,
}) {
  return aiRewrite({
    title,
    description,
    presetKey,
    mood,
    mode: "description_polish",
  });
}

function getAllTemplateNames() {
  return [
    ...Object.keys(BUILT_IN_TEMPLATES),
    ...Object.keys(store.savedTemplates || {}),
  ];
}

function getTemplateByName(name) {
  if (store.savedTemplates?.[name]) return store.savedTemplates[name];
  return BUILT_IN_TEMPLATES[name] || null;
}

function buildCommand() {
  const presetChoices = Object.entries(PRESETS).map(([value, meta]) => ({
    name: `${meta.emoji} ${meta.name}`,
    value,
  }));

  const templateChoices = getAllTemplateNames()
    .slice(0, 25)
    .map((name) => ({
      name,
      value: name,
    }));

  return new SlashCommandBuilder()
    .setName("embedstudio")
    .setDescription("Prémium embed kezelő rendszer")

    .addSubcommand((sub) =>
      sub
        .setName("preview")
        .setDescription("Előnézet gombos kiküldéssel")
        .addStringOption((o) =>
          o
            .setName("stilus")
            .setDescription("Embed stílus")
            .setRequired(true)
            .addChoices(...presetChoices)
        )
        .addChannelOption((o) =>
          o.setName("csatorna").setDescription("Hova menjen majd").setRequired(false)
        )
        .addStringOption((o) =>
          o.setName("cim").setDescription("Cím").setRequired(false).setMaxLength(256)
        )
        .addStringOption((o) =>
          o
            .setName("leiras")
            .setDescription("Leírás")
            .setRequired(false)
            .setMaxLength(3500)
        )
        .addStringOption((o) =>
          o
            .setName("uzenet")
            .setDescription("Sima szöveg az embed fölé")
            .setRequired(false)
            .setMaxLength(2000)
        )
        .addStringOption((o) =>
          o.setName("szin").setDescription("Hex szín pl. #16A34A").setRequired(false)
        )
        .addStringOption((o) =>
          o
            .setName("labjegyzet")
            .setDescription("Footer")
            .setRequired(false)
            .setMaxLength(2048)
        )
        .addStringOption((o) =>
          o
            .setName("szerzo")
            .setDescription("Author")
            .setRequired(false)
            .setMaxLength(256)
        )
        .addStringOption((o) =>
          o
            .setName("hangulat")
            .setDescription("Extra hangulat az AI-nak")
            .setRequired(false)
            .setMaxLength(300)
        )
        .addAttachmentOption((o) =>
          o.setName("kep").setDescription("Nagy kép").setRequired(false)
        )
        .addAttachmentOption((o) =>
          o.setName("thumbnail").setDescription("Sarokkép").setRequired(false)
        )
        .addRoleOption((o) =>
          o.setName("rang").setDescription("Pingelhető rang").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("everyone").setDescription("@everyone ping").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("idobelyeg").setDescription("Legyen timestamp").setRequired(false)
        )
        .addBooleanOption((o) =>
          o
            .setName("ai_formazas")
            .setDescription("AI szebbre formázza")
            .setRequired(false)
        )
        .addBooleanOption((o) =>
          o
            .setName("ai_mezok")
            .setDescription("AI javasoljon mezőket is")
            .setRequired(false)
        )
    )

    .addSubcommand((sub) =>
      sub
        .setName("send")
        .setDescription("Azonnali küldés")
        .addChannelOption((o) =>
          o.setName("csatorna").setDescription("Célcsatorna").setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("stilus")
            .setDescription("Embed stílus")
            .setRequired(true)
            .addChoices(...presetChoices)
        )
        .addStringOption((o) =>
          o.setName("cim").setDescription("Cím").setRequired(false).setMaxLength(256)
        )
        .addStringOption((o) =>
          o
            .setName("leiras")
            .setDescription("Leírás")
            .setRequired(false)
            .setMaxLength(3500)
        )
        .addStringOption((o) =>
          o
            .setName("uzenet")
            .setDescription("Sima szöveg az embed fölé")
            .setRequired(false)
            .setMaxLength(2000)
        )
        .addStringOption((o) =>
          o.setName("szin").setDescription("Hex szín").setRequired(false)
        )
        .addStringOption((o) =>
          o
            .setName("labjegyzet")
            .setDescription("Footer")
            .setRequired(false)
            .setMaxLength(2048)
        )
        .addStringOption((o) =>
          o
            .setName("szerzo")
            .setDescription("Author")
            .setRequired(false)
            .setMaxLength(256)
        )
        .addStringOption((o) =>
          o
            .setName("hangulat")
            .setDescription("Extra hangulat")
            .setRequired(false)
            .setMaxLength(300)
        )
        .addAttachmentOption((o) =>
          o.setName("kep").setDescription("Nagy kép").setRequired(false)
        )
        .addAttachmentOption((o) =>
          o.setName("thumbnail").setDescription("Sarokkép").setRequired(false)
        )
        .addRoleOption((o) =>
          o.setName("rang").setDescription("Pingelhető rang").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("everyone").setDescription("@everyone ping").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("idobelyeg").setDescription("Legyen timestamp").setRequired(false)
        )
        .addBooleanOption((o) =>
          o
            .setName("ai_formazas")
            .setDescription("AI szebbre formázza")
            .setRequired(false)
        )
        .addBooleanOption((o) =>
          o
            .setName("ai_mezok")
            .setDescription("AI javasoljon mezőket is")
            .setRequired(false)
        )
    )

    .addSubcommand((sub) =>
      sub
        .setName("template")
        .setDescription("Sablon preview gombokkal")
        .addStringOption((o) =>
          o
            .setName("sablon")
            .setDescription("Sablon neve")
            .setRequired(true)
            .addChoices(...templateChoices)
        )
        .addChannelOption((o) =>
          o.setName("csatorna").setDescription("Hova menjen majd").setRequired(false)
        )
        .addStringOption((o) =>
          o.setName("cim").setDescription("Felülírt cím").setRequired(false).setMaxLength(256)
        )
        .addStringOption((o) =>
          o
            .setName("leiras")
            .setDescription("Felülírt leírás")
            .setRequired(false)
            .setMaxLength(3500)
        )
        .addStringOption((o) =>
          o
            .setName("uzenet")
            .setDescription("Sima szöveg")
            .setRequired(false)
            .setMaxLength(2000)
        )
        .addStringOption((o) =>
          o.setName("hangulat").setDescription("Extra hangulat").setRequired(false)
        )
        .addAttachmentOption((o) =>
          o.setName("kep").setDescription("Nagy kép").setRequired(false)
        )
        .addAttachmentOption((o) =>
          o.setName("thumbnail").setDescription("Sarokkép").setRequired(false)
        )
        .addRoleOption((o) =>
          o.setName("rang").setDescription("Pingelhető rang").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("everyone").setDescription("@everyone ping").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("ai_formazas").setDescription("AI formázás").setRequired(false)
        )
    )

    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Bot üzenet szerkesztése")
        .addStringOption((o) =>
          o.setName("uzenet_id").setDescription("Üzenet ID").setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("stilus")
            .setDescription("Új stílus")
            .setRequired(true)
            .addChoices(...presetChoices)
        )
        .addChannelOption((o) =>
          o.setName("csatorna").setDescription("Az üzenet csatornája").setRequired(false)
        )
        .addStringOption((o) =>
          o.setName("cim").setDescription("Új cím").setRequired(false).setMaxLength(256)
        )
        .addStringOption((o) =>
          o.setName("leiras").setDescription("Új leírás").setRequired(false).setMaxLength(3500)
        )
        .addStringOption((o) =>
          o.setName("uzenet").setDescription("Új sima szöveg").setRequired(false).setMaxLength(2000)
        )
        .addStringOption((o) =>
          o.setName("szin").setDescription("Új hex szín").setRequired(false)
        )
        .addStringOption((o) =>
          o.setName("labjegyzet").setDescription("Új footer").setRequired(false).setMaxLength(2048)
        )
        .addStringOption((o) =>
          o.setName("szerzo").setDescription("Új author").setRequired(false).setMaxLength(256)
        )
        .addStringOption((o) =>
          o.setName("hangulat").setDescription("Extra hangulat").setRequired(false)
        )
        .addAttachmentOption((o) =>
          o.setName("kep").setDescription("Új nagy kép").setRequired(false)
        )
        .addAttachmentOption((o) =>
          o.setName("thumbnail").setDescription("Új sarokkép").setRequired(false)
        )
        .addRoleOption((o) =>
          o.setName("rang").setDescription("Új pingelhető rang").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("everyone").setDescription("@everyone ping").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("idobelyeg").setDescription("Timestamp").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("ai_formazas").setDescription("AI formázás").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("ai_mezok").setDescription("AI mezők").setRequired(false)
        )
    )

    .addSubcommand((sub) =>
      sub
        .setName("clone")
        .setDescription("Meglévő bot embed lemásolása másik csatornába")
        .addStringOption((o) =>
          o.setName("uzenet_id").setDescription("Forrás üzenet ID").setRequired(true)
        )
        .addChannelOption((o) =>
          o.setName("cel_csatorna").setDescription("Célcsatorna").setRequired(true)
        )
        .addChannelOption((o) =>
          o.setName("forras_csatorna").setDescription("Forrás csatorna").setRequired(false)
        )
    )

    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Bot embed törlése")
        .addStringOption((o) =>
          o.setName("uzenet_id").setDescription("Üzenet ID").setRequired(true)
        )
        .addChannelOption((o) =>
          o.setName("csatorna").setDescription("Csatorna").setRequired(false)
        )
    )

    .addSubcommand((sub) =>
      sub
        .setName("savetheme")
        .setDescription("Egyéni sablon mentése")
        .addStringOption((o) =>
          o.setName("nev").setDescription("Sablon neve").setRequired(true).setMaxLength(32)
        )
        .addStringOption((o) =>
          o
            .setName("stilus")
            .setDescription("Alap stílus")
            .setRequired(true)
            .addChoices(...presetChoices)
        )
        .addStringOption((o) =>
          o.setName("cim").setDescription("Alap cím").setRequired(false).setMaxLength(256)
        )
        .addStringOption((o) =>
          o.setName("leiras").setDescription("Alap leírás").setRequired(false).setMaxLength(3500)
        )
        .addStringOption((o) =>
          o.setName("uzenet").setDescription("Alap sima szöveg").setRequired(false).setMaxLength(2000)
        )
        .addStringOption((o) =>
          o.setName("hangulat").setDescription("Alap hangulat").setRequired(false).setMaxLength(300)
        )
    )

    .addSubcommand((sub) =>
      sub
        .setName("listthemes")
        .setDescription("Mentett sablonok listázása")
    )

    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);
}

async function registerSlashCommand() {
  const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.warn("[EMBEDSTUDIO] Hiányzó ENV a slash regisztrációhoz.");
    return;
  }

  const command = buildCommand().toJSON();
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: [command],
    });

    store.meta.lastRegisteredAt = Date.now();
    saveStore();
    console.log("[EMBEDSTUDIO] Slash command regisztrálva.");
  } catch (error) {
    console.error("[EMBEDSTUDIO] Slash regisztráció hiba:", error);
  }
}

async function sendLog(client, guild, title, description, extraFields = []) {
  try {
    if (!CONFIG.LOG_CHANNEL_ID) return;

    const channel =
      guild?.channels?.cache?.get(CONFIG.LOG_CHANNEL_ID) ||
      (guild ? await guild.channels.fetch(CONFIG.LOG_CHANNEL_ID).catch(() => null) : null);

    if (!safeChannel(channel)) return;

    const embed = new EmbedBuilder()
      .setColor(0x0f172a)
      .setTitle(`🧩 ${title}`)
      .setDescription(text(description, 4096))
      .addFields(extraFields.slice(0, 6))
      .setFooter({ text: `${CONFIG.BRAND_NAME} • Embed Studio` })
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => null);
  } catch (error) {
    console.error("[EMBEDSTUDIO] sendLog hiba:", error);
  }
}

async function prepareData(interaction, subName) {
  const colorInput = interaction.options.getString("szin");
  const customColor = normalizeColor(colorInput);

  if (colorInput && customColor === null) {
    throw new Error("Hibás színkód. Példa: #16A34A vagy 16A34A");
  }

  let presetKey = interaction.options.getString("stilus") || "kozlemeny";
  let title = text(interaction.options.getString("cim"), 256);
  let description = text(interaction.options.getString("leiras"), 3500);
  let contentText = text(interaction.options.getString("uzenet"), 2000);
  let mood = text(interaction.options.getString("hangulat"), 300);

  if (subName === "template") {
    const tplName = interaction.options.getString("sablon");
    const tpl = getTemplateByName(tplName);
    if (!tpl) throw new Error("Nem található a kiválasztott sablon.");

    presetKey = tpl.preset || presetKey;
    title = title || tpl.title || "";
    description = description || tpl.description || "";
    contentText = contentText || tpl.content || "";
    mood = mood || tpl.mood || "";
  }

  const footer = text(interaction.options.getString("labjegyzet"), 2048);
  const author = text(interaction.options.getString("szerzo"), 256);
  const role = interaction.options.getRole("rang");
  const everyone = interaction.options.getBoolean("everyone") || false;
  const timestamp = interaction.options.getBoolean("idobelyeg") ?? true;
  const imageAttachment = interaction.options.getAttachment("kep");
  const thumbnailAttachment = interaction.options.getAttachment("thumbnail");
  const aiFormatting = interaction.options.getBoolean("ai_formazas") ?? false;
  const aiFields = interaction.options.getBoolean("ai_mezok") ?? false;

  if (!title && !description && !imageAttachment && !thumbnailAttachment) {
    throw new Error("Adj meg legalább címet, leírást vagy képet.");
  }

  let aiCta = "";
  let fields = [];

  if (aiFormatting || aiFields) {
    const ai = await aiRewrite({
      title,
      description,
      presetKey,
      mood,
      mode: aiFields ? "rewrite_with_fields" : "rewrite",
    });

    if (aiFormatting) {
      title = ai.title || title;
      description = ai.description || description;
      aiCta = ai.cta || "";
    } else if (aiFields) {
      aiCta = ai.cta || "";
    }

    if (aiFields) {
      fields = Array.isArray(ai.fields) ? ai.fields : [];
    }
  }

  return {
    targetChannelId:
      interaction.options.getChannel("csatorna")?.id || interaction.channelId,
    presetKey,
    title,
    description,
    contentText,
    footer,
    author,
    color: customColor || getPresetMeta(presetKey).color || CONFIG.DEFAULT_COLOR,
    roleId: role?.id || null,
    everyone,
    timestamp,
    imageUrl: imageAttachment?.url || null,
    thumbnailUrl: thumbnailAttachment?.url || null,
    aiCta,
    fields,
  };
}

async function createPreview(interaction, prepared) {
  cleanupExpiredPreviews();

  const previewId = `${interaction.user.id}_${Date.now()}`;
  store.previews[previewId] = {
    ownerId: interaction.user.id,
    guildId: interaction.guildId,
    expiresAt: Date.now() + CONFIG.PREVIEW_EXPIRE_MS,
    data: serializePreview(prepared),
  };
  saveStore();

  const embed = buildEmbed(prepared);

  await interaction.editReply({
    content:
      `👀 **Embed előnézet**\n` +
      `Ez csak neked látszik.\n` +
      `A lenti gombbal azonnal kiküldheted.`,
    embeds: [embed],
    components: previewButtons(previewId),
  });
}

async function publishPreview(interaction, previewId) {
  cleanupExpiredPreviews();

  const preview = store.previews[previewId];
  if (!preview) {
    await interaction.reply({
      content: "❌ Ez az előnézet már lejárt vagy nem található.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (preview.ownerId !== interaction.user.id) {
    await interaction.reply({
      content: "❌ Ezt az előnézetet nem te hoztad létre.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const data = preview.data || {};
  const channel =
    interaction.guild.channels.cache.get(data.targetChannelId) ||
    (data.targetChannelId
      ? await interaction.guild.channels.fetch(data.targetChannelId).catch(() => null)
      : null);

  if (!safeChannel(channel)) {
    await interaction.reply({
      content: "❌ A célcsatornába nem tudok üzenetet küldeni.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const payload = buildPayload(data);
  const sent = await channel.send(payload);

  delete store.previews[previewId];
  saveStore();

  await interaction.update({
    content: `✅ Embed elküldve ide: ${channel}\n🆔 Üzenet ID: \`${sent.id}\``,
    embeds: [buildEmbed(data)],
    components: [],
  });

  await sendLog(
    interaction.client,
    interaction.guild,
    "Embed kiküldve",
    `${interaction.user} kiküldött egy embedet.`,
    [
      { name: "Csatorna", value: `${channel}`, inline: true },
      { name: "Üzenet ID", value: sent.id, inline: true },
      { name: "Stílus", value: data.presetKey || "-", inline: true },
    ]
  );
}

async function cancelPreview(interaction, previewId) {
  const preview = store.previews[previewId];
  if (!preview) {
    await interaction.reply({
      content: "❌ Ez az előnézet már nem érhető el.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (preview.ownerId !== interaction.user.id) {
    await interaction.reply({
      content: "❌ Ezt az előnézetet nem te hoztad létre.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  delete store.previews[previewId];
  saveStore();

  await interaction.update({
    content: "🗑️ Előnézet törölve.",
    embeds: [],
    components: [],
  });
}

async function handlePreview(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const prepared = await prepareData(interaction, interaction.options.getSubcommand());
  await createPreview(interaction, prepared);
}

async function handleSend(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const prepared = await prepareData(interaction, "send");
  const channel =
    interaction.guild.channels.cache.get(prepared.targetChannelId) ||
    (prepared.targetChannelId
      ? await interaction.guild.channels.fetch(prepared.targetChannelId).catch(() => null)
      : null);

  if (!safeChannel(channel)) {
    return interaction.editReply({
      content: "❌ A kiválasztott csatornába nem tudok üzenetet küldeni.",
    });
  }

  const payload = buildPayload(prepared);
  const sent = await channel.send(payload);

  await interaction.editReply({
    content:
      `✅ Embed elküldve ide: ${channel}\n` +
      `🆔 Üzenet ID: \`${sent.id}\``,
    embeds: [buildEmbed(prepared)],
  });

  await sendLog(
    interaction.client,
    interaction.guild,
    "Embed kiküldve",
    `${interaction.user} azonnal kiküldött egy embedet.`,
    [
      { name: "Csatorna", value: `${channel}`, inline: true },
      { name: "Üzenet ID", value: sent.id, inline: true },
      { name: "Stílus", value: prepared.presetKey || "-", inline: true },
    ]
  );
}

async function handleEdit(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = interaction.options.getChannel("csatorna") || interaction.channel;
  if (!safeChannel(channel)) {
    return interaction.editReply({
      content: "❌ A kiválasztott csatorna nem megfelelő.",
    });
  }

  const messageId = text(interaction.options.getString("uzenet_id"), 120);
  const message = await channel.messages.fetch(messageId).catch(() => null);

  if (!message) {
    return interaction.editReply({ content: "❌ Nem találom ezt az üzenetet." });
  }

  if (message.author?.id !== interaction.client.user.id) {
    return interaction.editReply({
      content: "❌ Csak a bot saját üzenetét tudod szerkeszteni.",
    });
  }

  const prepared = await prepareData(interaction, "send");
  const payload = buildPayload(prepared);
  await message.edit(payload);

  await interaction.editReply({
    content: `✅ Az üzenet frissítve lett.\n🆔 Üzenet ID: \`${message.id}\``,
    embeds: [buildEmbed(prepared)],
  });

  await sendLog(
    interaction.client,
    interaction.guild,
    "Embed szerkesztve",
    `${interaction.user} szerkesztett egy bot embedet.`,
    [
      { name: "Csatorna", value: `${channel}`, inline: true },
      { name: "Üzenet ID", value: message.id, inline: true },
    ]
  );
}

async function handleClone(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sourceChannel = interaction.options.getChannel("forras_csatorna") || interaction.channel;
  const targetChannel = interaction.options.getChannel("cel_csatorna");
  const messageId = text(interaction.options.getString("uzenet_id"), 120);

  if (!safeChannel(sourceChannel) || !safeChannel(targetChannel)) {
    return interaction.editReply({
      content: "❌ A forrás vagy célcsatorna nem megfelelő.",
    });
  }

  const message = await sourceChannel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    return interaction.editReply({ content: "❌ Nem találom a forrás üzenetet." });
  }

  if (message.author?.id !== interaction.client.user.id) {
    return interaction.editReply({
      content: "❌ Csak a bot saját üzenetét tudod klónozni.",
    });
  }

  await targetChannel.send({
    content: message.content || undefined,
    embeds: message.embeds?.length ? [message.embeds[0].data] : [],
  });

  await interaction.editReply({
    content: `✅ Az embed klónozva lett ide: ${targetChannel}`,
  });
}

async function handleDelete(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = interaction.options.getChannel("csatorna") || interaction.channel;
  const messageId = text(interaction.options.getString("uzenet_id"), 120);

  if (!safeChannel(channel)) {
    return interaction.editReply({ content: "❌ A csatorna nem megfelelő." });
  }

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    return interaction.editReply({ content: "❌ Nem találom ezt az üzenetet." });
  }

  if (message.author?.id !== interaction.client.user.id) {
    return interaction.editReply({
      content: "❌ Csak a bot saját üzenetét törölheted ezzel.",
    });
  }

  await message.delete().catch(() => null);

  await interaction.editReply({
    content: "🗑️ Az embed törölve lett.",
  });
}

async function handleSaveTheme(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name = text(interaction.options.getString("nev"), 32).toLowerCase();
  const preset = interaction.options.getString("stilus");
  const title = text(interaction.options.getString("cim"), 256);
  const description = text(interaction.options.getString("leiras"), 3500);
  const content = text(interaction.options.getString("uzenet"), 2000);
  const mood = text(interaction.options.getString("hangulat"), 300);

  const keys = Object.keys(store.savedTemplates || {});
  if (!store.savedTemplates[name] && keys.length >= CONFIG.MAX_SAVED_PRESETS) {
    return interaction.editReply({
      content: "❌ Elérted a menthető sablonok maximumát.",
    });
  }

  store.savedTemplates[name] = {
    preset,
    title,
    description,
    content,
    mood,
    createdAt: Date.now(),
    authorId: interaction.user.id,
  };
  saveStore();

  await interaction.editReply({
    content: `✅ Sablon elmentve: \`${name}\``,
  });
}

async function handleListThemes(interaction) {
  await interaction.reply({
    content:
      Object.keys(store.savedTemplates || {}).length
        ? `💾 Mentett sablonok:\n${Object.keys(store.savedTemplates)
            .sort()
            .map((k) => `• \`${k}\``)
            .join("\n")}`
        : "Nincs még mentett sablon.",
    flags: MessageFlags.Ephemeral,
  });
}

async function handleButton(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId?.startsWith("embedstudio:")) return false;

  const [, action, previewId] = interaction.customId.split(":");

  if (action === "publish") {
    await publishPreview(interaction, previewId);
    return true;
  }

  if (action === "cancel") {
    await cancelPreview(interaction, previewId);
    return true;
  }

  return false;
}

async function handleSlash(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== "embedstudio") return false;

  if (!hasStaffPermission(interaction)) {
    await interaction.reply({
      content: "❌ Ehhez nincs jogosultságod.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  try {
    const sub = interaction.options.getSubcommand();

    if (sub === "preview" || sub === "template") {
      await handlePreview(interaction);
      return true;
    }

    if (sub === "send") {
      await handleSend(interaction);
      return true;
    }

    if (sub === "edit") {
      await handleEdit(interaction);
      return true;
    }

    if (sub === "clone") {
      await handleClone(interaction);
      return true;
    }

    if (sub === "delete") {
      await handleDelete(interaction);
      return true;
    }

    if (sub === "savetheme") {
      await handleSaveTheme(interaction);
      return true;
    }

    if (sub === "listthemes") {
      await handleListThemes(interaction);
      return true;
    }
  } catch (error) {
    console.error("[EMBEDSTUDIO] handleSlash hiba:", error);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: `❌ ${error.message || "Ismeretlen hiba történt."}`,
      }).catch(() => null);
    } else {
      await interaction.reply({
        content: `❌ ${error.message || "Ismeretlen hiba történt."}`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
    }

    return true;
  }

  return false;
}

function registerEmbedStudio(client) {
  if (!client) throw new Error("Hiányzik a client.");

  client.once("ready", async () => {
    cleanupExpiredPreviews();
    saveStore();
    await registerSlashCommand();
    console.log("[EMBEDSTUDIO] Modul betöltve.");
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      const buttonHandled = await handleButton(interaction);
      if (buttonHandled) return;

      const slashHandled = await handleSlash(interaction);
      if (slashHandled) return;
    } catch (error) {
      console.error("[EMBEDSTUDIO] interactionCreate hiba:", error);
    }
  });
}

module.exports = {
  registerEmbedStudio,
};