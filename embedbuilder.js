"use strict";

const fs = require("fs");
const path = require("path");
const {
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const OpenAI = require("openai");

const openai =
  process.env.OPENAI_API_KEY && !String(process.env.OPENAI_API_KEY).includes("IDE_IRD")
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const CONFIG = {
  AI_MODEL: "gpt-5-mini",
  BRAND_NAME: "internalGaming",
  DEFAULT_COLOR: 0x16a34a,
  PREVIEW_EXPIRE_MS: 15 * 60 * 1000,
};

const DATA_DIR =
  process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");

const DATA_FILE = path.join(DATA_DIR, "embedstudio-data.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

const PRESETS = {
  kozlemeny: {
    name: "Közlemény",
    color: 0x16a34a,
    emoji: "📢",
    author: "internalGaming • Közlemény",
    footer: "internalGaming • Hivatalos közlemény",
    styleNote: "letisztult, hivatalos, rendezett, erős kiemelésekkel",
  },
  frissites: {
    name: "Frissítés",
    color: 0x2563eb,
    emoji: "🛠️",
    author: "internalGaming • Frissítés",
    footer: "internalGaming • Fejlesztési információ",
    styleNote: "informatív, modern, jól tagolt",
  },
  esemeny: {
    name: "Esemény",
    color: 0xd97706,
    emoji: "🎉",
    author: "internalGaming • Esemény",
    footer: "internalGaming • Esemény információ",
    styleNote: "figyelemfelkeltő, közösségi, lendületes",
  },
  szabaly: {
    name: "Szabályzat",
    color: 0xdc2626,
    emoji: "📜",
    author: "internalGaming • Szabályzat",
    footer: "internalGaming • Szabályzati tájékoztató",
    styleNote: "határozott, tiszta, félreérthetetlen",
  },
  toborzas: {
    name: "Toborzás",
    color: 0x7c3aed,
    emoji: "🧩",
    author: "internalGaming • Toborzás",
    footer: "internalGaming • Jelentkezési információ",
    styleNote: "motiváló, prémium, közösségi",
  },
  figyelmeztetes: {
    name: "Figyelmeztetés",
    color: 0xea580c,
    emoji: "⚠️",
    author: "internalGaming • Figyelmeztetés",
    footer: "internalGaming • Fontos információ",
    styleNote: "erős, rövid, sürgős, jól észrevehető",
  },
  premium: {
    name: "Premium",
    color: 0x0f172a,
    emoji: "✦",
    author: "internalGaming • Premium",
    footer: "internalGaming • Exkluzív információ",
    styleNote: "nagyon prémium, elegáns, sötétebb, vizuálisan erős",
  },
};

const TEMPLATES = {
  maintenance: {
    stilus: "figyelmeztetes",
    cim: "Karbantartás",
    leiras:
      "A szerveren hamarosan karbantartás indul. A munkálatok ideje alatt előfordulhat átmeneti elérhetetlenség, újracsatlakozás vagy rövid ideig tartó instabilitás.",
    uzenet: "",
    hangulat: "komoly, hivatalos, tiszta",
  },
  restart: {
    stilus: "frissites",
    cim: "Szerver újraindítás",
    leiras:
      "Hamarosan újraindítás történik. Kérünk mindenkit, hogy időben zárja le a folyamatban lévő dolgait, és készüljön fel a rövid kiesésre.",
    uzenet: "",
    hangulat: "informatív, rövid, tiszta",
  },
  recruitment: {
    stilus: "toborzas",
    cim: "Jelentkezés megnyitva",
    leiras:
      "Megnyitottuk a jelentkezést. Ha úgy érzed, hogy hozzá tudsz tenni a közösség működéséhez, most itt a lehetőség, hogy csatlakozz hozzánk.",
    uzenet: "",
    hangulat: "motiváló, prémium, emberi",
  },
  rules: {
    stilus: "szabaly",
    cim: "Fontos szabályzati emlékeztető",
    leiras:
      "Kérünk mindenkit, hogy fokozottan figyeljen a szabályok betartására. A visszatérő vagy egyértelmű szabályszegések esetén a staff a jövőben is következetesen fog eljárni.",
    uzenet: "",
    hangulat: "határozott, tiszta, komoly",
  },
  event: {
    stilus: "esemeny",
    cim: "Közelgő esemény",
    leiras:
      "Hamarosan indul egy új közösségi esemény. Részletek rövidesen, érdemes figyelni a bejelentéseket, mert több információ is érkezik.",
    uzenet: "",
    hangulat: "izgalmas, közösségi, figyelemfelkeltő",
  },
  update: {
    stilus: "frissites",
    cim: "Új fejlesztések érkeztek",
    leiras:
      "Az elmúlt időszakban több javítás és finomhangolás is bekerült. A cél most is az volt, hogy stabilabb, átláthatóbb és élvezhetőbb legyen az egész rendszer.",
    uzenet: "",
    hangulat: "modern, igényes, fejlesztői",
  },
};

function createDefaultStore() {
  return {
    previews: {},
  };
}

function loadStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const fresh = createDefaultStore();
      fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2), "utf8");
      return fresh;
    }

    const raw = fs.readFileSync(DATA_FILE, "utf8");
    if (!raw.trim()) return createDefaultStore();

    const parsed = JSON.parse(raw);
    return {
      previews: parsed.previews || {},
    };
  } catch (error) {
    console.error("[EMBEDSTUDIO] loadStore hiba:", error);
    return createDefaultStore();
  }
}

let store = loadStore();

function saveStore() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    console.error("[EMBEDSTUDIO] saveStore hiba:", error);
  }
}

function cleanupExpiredPreviews() {
  const now = Date.now();

  for (const [key, preview] of Object.entries(store.previews || {})) {
    if (!preview || !preview.expiresAt || preview.expiresAt < now) {
      delete store.previews[key];
    }
  }
}

function hasPermission(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ||
      interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)
  );
}

function limit(text, max = 4000) {
  const value = String(text || "").trim();
  if (!value) return "";
  return value.length > max ? value.slice(0, max - 3) + "..." : value;
}

function normalizeColor(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const hex = raw.replace("#", "").trim();

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return null;
  }

  return parseInt(hex, 16);
}

function isSendableTextChannel(channel) {
  if (!channel) return false;
  if (typeof channel.send !== "function") return false;

  return [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
  ].includes(channel.type);
}

function buildDivider() {
  return "━━━━━━━━━━━━━━━━━━━━━━";
}

function makePrettyDescription(description) {
  const text = limit(description || "", 3500);
  if (!text) return "";

  return [buildDivider(), text, buildDivider()].join("\n");
}

async function aiPolishEmbed({
  rawTitle,
  rawDescription,
  presetKey,
  extraTone,
}) {
  const fallback = {
    title: rawTitle || "",
    description: rawDescription || "",
  };

  if (!openai) return fallback;

  const preset = PRESETS[presetKey] || PRESETS.kozlemeny;

  try {
    const response = await openai.responses.create({
      model: CONFIG.AI_MODEL,
      input: `
Te egy Discord szerver bejelentésíró vagy.

Feladat:
- a megadott magyar címet és leírást alakítsd át szebb, prémiumabb, emberibb Discord embed szöveggé
- ne legyen AI szagú
- ne legyen túl hosszú
- legyen jól olvasható
- maradjon természetes
- a cím legyen ütős
- a leírás legyen kulturált, vizuálisan is jól működő szöveg

Szerver neve: ${CONFIG.BRAND_NAME}
Stílus: ${preset.name}
Stílus jellege: ${preset.styleNote}
Extra hangulat: ${extraTone || "nincs"}

Eredeti cím:
${rawTitle || "-"}

Eredeti leírás:
${rawDescription || "-"}

Kizárólag JSON választ adj:
{
  "title": "új cím",
  "description": "új leírás"
}
      `,
      reasoning: { effort: "low" },
    });

    const text = String(response.output_text || "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1) return fallback;

    const parsed = JSON.parse(text.slice(start, end + 1));

    return {
      title: limit(parsed.title || rawTitle || "", 256),
      description: limit(parsed.description || rawDescription || "", 3500),
    };
  } catch (error) {
    console.error("[EMBEDSTUDIO] aiPolishEmbed hiba:", error?.message || error);
    return fallback;
  }
}

function buildEmbed({
  presetKey,
  title,
  description,
  color,
  footer,
  author,
  imageUrl,
  thumbnailUrl,
  timestamp,
}) {
  const preset = PRESETS[presetKey] || PRESETS.kozlemeny;

  const embed = new EmbedBuilder().setColor(color ?? preset.color ?? CONFIG.DEFAULT_COLOR);

  const finalTitle = title
    ? `${preset.emoji} ${limit(title, 240)}`
    : `${preset.emoji} ${preset.name}`;

  embed.setTitle(finalTitle);

  const finalDescription = makePrettyDescription(description);
  if (finalDescription) embed.setDescription(finalDescription);

  embed.setAuthor({
    name: limit(author || preset.author || CONFIG.BRAND_NAME, 256),
  });

  embed.setFooter({
    text: limit(footer || preset.footer || CONFIG.BRAND_NAME, 2048),
  });

  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  if (imageUrl) embed.setImage(imageUrl);
  if (timestamp) embed.setTimestamp(new Date());

  return embed;
}

function buildPayload({
  mentionText,
  contentText,
  embed,
  pingRole,
  everyone,
}) {
  const content = [mentionText, contentText].filter(Boolean).join("\n").trim();

  return {
    content: content || undefined,
    embeds: [embed],
    allowedMentions: {
      parse: everyone ? ["everyone"] : [],
      roles: pingRole ? [pingRole.id] : [],
    },
  };
}

function createPreviewButtons(previewId) {
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

function serializeRole(role) {
  if (!role) return null;
  return { id: role.id, name: role.name };
}

function deserializePayloadData(data) {
  return {
    targetChannelId: data.targetChannelId || null,
    title: data.title || "",
    description: data.description || "",
    contentText: data.contentText || "",
    presetKey: data.presetKey || "kozlemeny",
    footer: data.footer || "",
    author: data.author || "",
    color: typeof data.color === "number" ? data.color : null,
    pingRoleId: data.pingRoleId || null,
    everyone: Boolean(data.everyone),
    timestamp: Boolean(data.timestamp),
    imageUrl: data.imageUrl || null,
    thumbnailUrl: data.thumbnailUrl || null,
  };
}

async function createPreview(interaction, prepared) {
  cleanupExpiredPreviews();

  const previewId = `${interaction.user.id}_${Date.now()}`;
  store.previews[previewId] = {
    ownerId: interaction.user.id,
    guildId: interaction.guildId,
    createdAt: Date.now(),
    expiresAt: Date.now() + CONFIG.PREVIEW_EXPIRE_MS,
    data: prepared,
  };
  saveStore();

  const embed = buildEmbed(prepared);

  await interaction.editReply({
    content:
      `👀 **Embed előnézet**\n` +
      `Stílus: **${PRESETS[prepared.presetKey]?.emoji || "📢"} ${PRESETS[prepared.presetKey]?.name || "Közlemény"}**\n` +
      `Ez csak neked látszik. A kiküldéshez használd a lenti gombot.`,
    embeds: [embed],
    components: createPreviewButtons(previewId),
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

  const prepared = deserializePayloadData(preview.data);
  const targetChannel =
    interaction.guild?.channels?.cache?.get(prepared.targetChannelId) ||
    (prepared.targetChannelId
      ? await interaction.guild.channels.fetch(prepared.targetChannelId).catch(() => null)
      : null);

  if (!isSendableTextChannel(targetChannel)) {
    await interaction.reply({
      content: "❌ A célcsatornába nem tudok üzenetet küldeni.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = buildEmbed(prepared);

  const payload = buildPayload({
    mentionText: [
      prepared.everyone ? "@everyone" : "",
      prepared.pingRoleId ? `<@&${prepared.pingRoleId}>` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim(),
    contentText: prepared.contentText,
    embed,
    pingRole: prepared.pingRoleId ? { id: prepared.pingRoleId } : null,
    everyone: prepared.everyone,
  });

  try {
    const sent = await targetChannel.send(payload);

    delete store.previews[previewId];
    saveStore();

    await interaction.update({
      content:
        `✅ Embed elküldve ide: ${targetChannel}\n` +
        `🆔 Üzenet ID: \`${sent.id}\``,
      embeds: [embed],
      components: [],
    });
  } catch (error) {
    console.error("[EMBEDSTUDIO] publishPreview hiba:", error);

    await interaction.reply({
      content: `❌ Nem sikerült elküldeni az embedet.\n\`${error.message || "Ismeretlen hiba"}\``,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function cancelPreview(interaction, previewId) {
  const preview = store.previews[previewId];

  if (!preview) {
    await interaction.reply({
      content: "❌ Ez az előnézet már nem elérhető.",
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
    content: "🗑️ Az előnézet törölve lett.",
    embeds: [],
    components: [],
  });
}

async function prepareDataFromInteraction(interaction, subcommand) {
  const presetKey = interaction.options.getString("stilus") || "kozlemeny";
  const templateKey = interaction.options.getString("sablon");
  const colorInput = interaction.options.getString("szin");
  const customColor = normalizeColor(colorInput);

  if (colorInput && customColor === null) {
    throw new Error("Hibás színkód. Példa: #16A34A vagy 16A34A");
  }

  let rawTitle = limit(interaction.options.getString("cim"), 256);
  let rawDescription = limit(interaction.options.getString("leiras"), 3500);
  let contentText = limit(interaction.options.getString("uzenet"), 2000);
  let chosenPreset = presetKey;
  let extraTone = limit(interaction.options.getString("hangulat"), 300);

  if (subcommand === "template") {
    const tpl = TEMPLATES[templateKey];
    if (!tpl) {
      throw new Error("A kiválasztott sablon nem található.");
    }

    chosenPreset = tpl.stilus || presetKey;
    rawTitle = rawTitle || tpl.cim || "";
    rawDescription = rawDescription || tpl.leiras || "";
    contentText = contentText || tpl.uzenet || "";
    extraTone = extraTone || tpl.hangulat || "";
  }

  const footer = limit(interaction.options.getString("labjegyzet"), 2048);
  const author = limit(interaction.options.getString("szerzo"), 256);
  const aiPolish = interaction.options.getBoolean("ai_formazas") ?? false;
  const everyone = interaction.options.getBoolean("everyone") || false;
  const timestamp = interaction.options.getBoolean("idobelyeg") ?? true;
  const pingRole = interaction.options.getRole("rang");
  const imageAttachment = interaction.options.getAttachment("kep");
  const thumbnailAttachment = interaction.options.getAttachment("thumbnail");

  if (!rawTitle && !rawDescription && !imageAttachment && !thumbnailAttachment) {
    throw new Error("Adj meg legalább címet, leírást vagy képet.");
  }

  let finalTitle = rawTitle;
  let finalDescription = rawDescription;

  if (aiPolish) {
    const polished = await aiPolishEmbed({
      rawTitle,
      rawDescription,
      presetKey: chosenPreset,
      extraTone,
    });

    finalTitle = polished.title || rawTitle;
    finalDescription = polished.description || rawDescription;
  }

  return {
    targetChannelId:
      subcommand === "preview"
        ? interaction.channelId
        : interaction.options.getChannel("csatorna")?.id || interaction.channelId,
    title: finalTitle,
    description: finalDescription,
    contentText,
    presetKey: chosenPreset,
    footer,
    author,
    color: customColor || PRESETS[chosenPreset]?.color || CONFIG.DEFAULT_COLOR,
    pingRoleId: pingRole?.id || null,
    everyone,
    timestamp,
    imageUrl: imageAttachment?.url || null,
    thumbnailUrl: thumbnailAttachment?.url || null,
  };
}

async function handleSlashCommand(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== "embedstudio") return false;

  if (!hasPermission(interaction)) {
    await interaction.reply({
      content: "❌ Ehhez nincs jogosultságod.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "preview" || sub === "send" || sub === "template") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const prepared = await prepareDataFromInteraction(interaction, sub);

      if (sub === "preview" || sub === "template") {
        await createPreview(interaction, prepared);
        return true;
      }

      const targetChannel =
        interaction.guild.channels.cache.get(prepared.targetChannelId) ||
        (prepared.targetChannelId
          ? await interaction.guild.channels.fetch(prepared.targetChannelId).catch(() => null)
          : null);

      if (!isSendableTextChannel(targetChannel)) {
        await interaction.editReply({
          content: "❌ A kiválasztott csatornába nem tudok üzenetet küldeni.",
        });
        return true;
      }

      const embed = buildEmbed(prepared);

      const payload = buildPayload({
        mentionText: [
          prepared.everyone ? "@everyone" : "",
          prepared.pingRoleId ? `<@&${prepared.pingRoleId}>` : "",
        ]
          .filter(Boolean)
          .join(" ")
          .trim(),
        contentText: prepared.contentText,
        embed,
        pingRole: prepared.pingRoleId ? { id: prepared.pingRoleId } : null,
        everyone: prepared.everyone,
      });

      const sent = await targetChannel.send(payload);

      await interaction.editReply({
        content:
          `✅ Embed elküldve ide: ${targetChannel}\n` +
          `🎨 Stílus: **${PRESETS[prepared.presetKey]?.emoji || "📢"} ${PRESETS[prepared.presetKey]?.name || "Közlemény"}**\n` +
          `🆔 Üzenet ID: \`${sent.id}\``,
        embeds: [embed],
      });

      return true;
    } catch (error) {
      await interaction.editReply({
        content: `❌ ${error.message || "Ismeretlen hiba történt."}`,
      });
      return true;
    }
  }

  if (sub === "edit") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const channel =
        interaction.options.getChannel("csatorna") || interaction.channel;

      if (!isSendableTextChannel(channel)) {
        await interaction.editReply({
          content: "❌ A kiválasztott csatorna nem szerkeszthető üzenetes csatorna.",
        });
        return true;
      }

      const messageId = limit(interaction.options.getString("uzenet_id"), 100);
      const message = await channel.messages.fetch(messageId).catch(() => null);

      if (!message) {
        await interaction.editReply({
          content: "❌ Nem találom ezt az üzenetet.",
        });
        return true;
      }

      if (message.author?.id !== interaction.client.user.id) {
        await interaction.editReply({
          content: "❌ Csak a bot saját üzenetét tudod szerkeszteni.",
        });
        return true;
      }

      const prepared = await prepareDataFromInteraction(interaction, "send");
      const embed = buildEmbed(prepared);

      const payload = buildPayload({
        mentionText: [
          prepared.everyone ? "@everyone" : "",
          prepared.pingRoleId ? `<@&${prepared.pingRoleId}>` : "",
        ]
          .filter(Boolean)
          .join(" ")
          .trim(),
        contentText: prepared.contentText,
        embed,
        pingRole: prepared.pingRoleId ? { id: prepared.pingRoleId } : null,
        everyone: prepared.everyone,
      });

      await message.edit(payload);

      await interaction.editReply({
        content: `✅ Az üzenet frissítve lett itt: ${channel}\n🆔 Üzenet ID: \`${message.id}\``,
        embeds: [embed],
      });

      return true;
    } catch (error) {
      await interaction.editReply({
        content: `❌ ${error.message || "Ismeretlen hiba történt."}`,
      });
      return true;
    }
  }

  return false;
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

module.exports = {
  handleSlashCommand,
  handleButton,
};