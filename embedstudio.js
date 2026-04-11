"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const CONFIG = {
  BRAND_NAME: "internalGaming",
  DATA_DIR: process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data"),
  DATA_FILE: path.join(
    process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data"),
    "embed-creator-data.json"
  ),
  PREVIEW_EXPIRE_MS: 15 * 60 * 1000,
};

fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });

const STYLES = {
  info: {
    label: "Információ",
    emoji: "📘",
    color: 0x2563eb,
    footer: "internalGaming • Információ",
  },
  success: {
    label: "Közlemény",
    emoji: "✅",
    color: 0x16a34a,
    footer: "internalGaming • Közlemény",
  },
  warning: {
    label: "Figyelmeztetés",
    emoji: "⚠️",
    color: 0xea580c,
    footer: "internalGaming • Figyelmeztetés",
  },
  danger: {
    label: "Fontos",
    emoji: "⛔",
    color: 0xdc2626,
    footer: "internalGaming • Fontos közlemény",
  },
};

function defaultStore() {
  return {
    previews: {},
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
    };
  } catch (error) {
    console.error("[EMBED] loadStore hiba:", error);
    return defaultStore();
  }
}

let store = loadStore();

function saveStore() {
  try {
    fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    console.error("[EMBED] saveStore hiba:", error);
  }
}

function cleanupExpiredPreviews() {
  const now = Date.now();
  for (const [id, item] of Object.entries(store.previews || {})) {
    if (!item || !item.expiresAt || item.expiresAt < now) {
      delete store.previews[id];
    }
  }
  saveStore();
}

function generateId() {
  return crypto.randomBytes(8).toString("hex");
}

function hasStaffPermission(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ||
      interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)
  );
}

function safeText(value, max = 4000) {
  const v = String(value || "").trim();
  if (!v) return "";
  return v.length > max ? `${v.slice(0, max - 3)}...` : v;
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

function getStyle(key) {
  return STYLES[key] || STYLES.info;
}

function buildEmbed(data) {
  const style = getStyle(data.style);

  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setTitle(
      safeText(
        data.title
          ? `${style.emoji} ${data.title}`
          : `${style.emoji} ${style.label}`,
        256
      )
    )
    .setFooter({
      text: safeText(style.footer, 2048),
    });

  const description = safeText(data.description, 4096);
  if (description) embed.setDescription(description);

  if (data.imageUrl) embed.setImage(data.imageUrl);
  if (data.thumbnailUrl) embed.setThumbnail(data.thumbnailUrl);
  if (data.timestamp) embed.setTimestamp(new Date());

  return embed;
}

function buildPayload(data) {
  const mentions = [];
  if (data.everyone) mentions.push("@everyone");
  if (data.roleId) mentions.push(`<@&${data.roleId}>`);

  const content = [mentions.join(" ").trim(), safeText(data.contentText, 2000)]
    .filter(Boolean)
    .join("\n")
    .trim();

  return {
    content: content || undefined,
    embeds: [buildEmbed(data)],
    allowedMentions: {
      parse: data.everyone ? ["everyone"] : [],
      roles: data.roleId ? [data.roleId] : [],
    },
  };
}

function buildPreviewButtons(previewId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`embed:create:publish:${previewId}`)
        .setLabel("Küldés")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`embed:create:cancel:${previewId}`)
        .setLabel("Mégse")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

function getCommand() {
  return new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Egyszerű embed készítő")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)

    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Előnézet készítése gombos kiküldéssel")
        .addChannelOption((o) =>
          o.setName("csatorna").setDescription("Célcsatorna").setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("stilus")
            .setDescription("Embed stílus")
            .setRequired(true)
            .addChoices(
              { name: "📘 Információ", value: "info" },
              { name: "✅ Közlemény", value: "success" },
              { name: "⚠️ Figyelmeztetés", value: "warning" },
              { name: "⛔ Fontos", value: "danger" }
            )
        )
        .addStringOption((o) =>
          o.setName("cim").setDescription("Embed címe").setRequired(true).setMaxLength(256)
        )
        .addStringOption((o) =>
          o
            .setName("leiras")
            .setDescription("Embed leírás")
            .setRequired(true)
            .setMaxLength(4000)
        )
        .addStringOption((o) =>
          o
            .setName("uzenet")
            .setDescription("Sima szöveg az embed fölé")
            .setRequired(false)
            .setMaxLength(2000)
        )
        .addAttachmentOption((o) =>
          o.setName("kep").setDescription("Nagy kép").setRequired(false)
        )
        .addAttachmentOption((o) =>
          o.setName("thumbnail").setDescription("Sarokkép").setRequired(false)
        )
        .addRoleOption((o) =>
          o.setName("rang").setDescription("Megpingelhető rang").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("everyone").setDescription("@everyone ping").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("idobelyeg").setDescription("Legyen timestamp").setRequired(false)
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
            .addChoices(
              { name: "📘 Információ", value: "info" },
              { name: "✅ Közlemény", value: "success" },
              { name: "⚠️ Figyelmeztetés", value: "warning" },
              { name: "⛔ Fontos", value: "danger" }
            )
        )
        .addStringOption((o) =>
          o.setName("cim").setDescription("Embed címe").setRequired(true).setMaxLength(256)
        )
        .addStringOption((o) =>
          o
            .setName("leiras")
            .setDescription("Embed leírás")
            .setRequired(true)
            .setMaxLength(4000)
        )
        .addStringOption((o) =>
          o
            .setName("uzenet")
            .setDescription("Sima szöveg az embed fölé")
            .setRequired(false)
            .setMaxLength(2000)
        )
        .addAttachmentOption((o) =>
          o.setName("kep").setDescription("Nagy kép").setRequired(false)
        )
        .addAttachmentOption((o) =>
          o.setName("thumbnail").setDescription("Sarokkép").setRequired(false)
        )
        .addRoleOption((o) =>
          o.setName("rang").setDescription("Megpingelhető rang").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("everyone").setDescription("@everyone ping").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("idobelyeg").setDescription("Legyen timestamp").setRequired(false)
        )
    )

    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Bot által küldött embed szerkesztése")
        .addChannelOption((o) =>
          o.setName("csatorna").setDescription("Az üzenet csatornája").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("uzenet_id").setDescription("Discord üzenet ID").setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("stilus")
            .setDescription("Új stílus")
            .setRequired(true)
            .addChoices(
              { name: "📘 Információ", value: "info" },
              { name: "✅ Közlemény", value: "success" },
              { name: "⚠️ Figyelmeztetés", value: "warning" },
              { name: "⛔ Fontos", value: "danger" }
            )
        )
        .addStringOption((o) =>
          o.setName("cim").setDescription("Új cím").setRequired(true).setMaxLength(256)
        )
        .addStringOption((o) =>
          o.setName("leiras").setDescription("Új leírás").setRequired(true).setMaxLength(4000)
        )
        .addStringOption((o) =>
          o
            .setName("uzenet")
            .setDescription("Új sima szöveg az embed fölé")
            .setRequired(false)
            .setMaxLength(2000)
        )
        .addAttachmentOption((o) =>
          o.setName("kep").setDescription("Új nagy kép").setRequired(false)
        )
        .addAttachmentOption((o) =>
          o.setName("thumbnail").setDescription("Új sarokkép").setRequired(false)
        )
        .addRoleOption((o) =>
          o.setName("rang").setDescription("Új megpingelhető rang").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("everyone").setDescription("@everyone ping").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("idobelyeg").setDescription("Legyen timestamp").setRequired(false)
        )
    )

    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Bot által küldött embed törlése")
        .addChannelOption((o) =>
          o.setName("csatorna").setDescription("Az üzenet csatornája").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("uzenet_id").setDescription("Discord üzenet ID").setRequired(true)
        )
    );
}

function readCommonOptions(interaction) {
  const image = interaction.options.getAttachment("kep");
  const thumbnail = interaction.options.getAttachment("thumbnail");
  const role = interaction.options.getRole("rang");

  return {
    channel: interaction.options.getChannel("csatorna"),
    style: interaction.options.getString("stilus"),
    title: safeText(interaction.options.getString("cim"), 256),
    description: safeText(interaction.options.getString("leiras"), 4000),
    contentText: safeText(interaction.options.getString("uzenet"), 2000),
    imageUrl: image?.url || "",
    thumbnailUrl: thumbnail?.url || "",
    roleId: role?.id || "",
    everyone: Boolean(interaction.options.getBoolean("everyone")),
    timestamp: Boolean(interaction.options.getBoolean("idobelyeg")),
  };
}

async function handleCreate(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  cleanupExpiredPreviews();

  const data = readCommonOptions(interaction);

  if (!safeChannel(data.channel)) {
    throw new Error("A megadott csatorna nem támogatott szöveges csatorna.");
  }

  const previewId = generateId();

  store.previews[previewId] = {
    createdBy: interaction.user.id,
    guildId: interaction.guildId,
    channelId: data.channel.id,
    payload: buildPayload(data),
    expiresAt: Date.now() + CONFIG.PREVIEW_EXPIRE_MS,
  };
  saveStore();

  await interaction.editReply({
    content: `**Előnézet kész.**\nCélcsatorna: <#${data.channel.id}>\nAz alábbi gombokkal kiküldheted vagy törölheted az előnézetet.`,
    embeds: [buildEmbed(data)],
    components: buildPreviewButtons(previewId),
  });
}

async function handleSend(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const data = readCommonOptions(interaction);

  if (!safeChannel(data.channel)) {
    throw new Error("A megadott csatorna nem támogatott szöveges csatorna.");
  }

  const sent = await data.channel.send(buildPayload(data));

  await interaction.editReply({
    content: `✅ Embed elküldve ide: <#${data.channel.id}>\nÜzenet ID: \`${sent.id}\``,
  });
}

async function handleEdit(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = interaction.options.getChannel("csatorna");
  const messageId = interaction.options.getString("uzenet_id", true);

  if (!safeChannel(channel)) {
    throw new Error("A megadott csatorna nem támogatott szöveges csatorna.");
  }

  const image = interaction.options.getAttachment("kep");
  const thumbnail = interaction.options.getAttachment("thumbnail");
  const role = interaction.options.getRole("rang");

  const data = {
    channel,
    style: interaction.options.getString("stilus", true),
    title: safeText(interaction.options.getString("cim", true), 256),
    description: safeText(interaction.options.getString("leiras", true), 4000),
    contentText: safeText(interaction.options.getString("uzenet"), 2000),
    imageUrl: image?.url || "",
    thumbnailUrl: thumbnail?.url || "",
    roleId: role?.id || "",
    everyone: Boolean(interaction.options.getBoolean("everyone")),
    timestamp: Boolean(interaction.options.getBoolean("idobelyeg")),
  };

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) throw new Error("Nem találom ezt az üzenetet.");

  if (message.author?.id !== interaction.client.user.id) {
    throw new Error("Csak a bot saját üzenetét tudod szerkeszteni.");
  }

  await message.edit(buildPayload(data));

  await interaction.editReply({
    content: `✅ Embed szerkesztve.\nCsatorna: <#${channel.id}>\nÜzenet ID: \`${message.id}\``,
  });
}

async function handleDelete(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = interaction.options.getChannel("csatorna");
  const messageId = interaction.options.getString("uzenet_id", true);

  if (!safeChannel(channel)) {
    throw new Error("A megadott csatorna nem támogatott szöveges csatorna.");
  }

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) throw new Error("Nem találom ezt az üzenetet.");

  if (message.author?.id !== interaction.client.user.id) {
    throw new Error("Csak a bot saját üzenetét tudod törölni.");
  }

  await message.delete().catch(() => {
    throw new Error("Nem sikerült törölni az üzenetet.");
  });

  await interaction.editReply({
    content: `🗑️ Embed törölve.\nCsatorna: <#${channel.id}>\nÜzenet ID: \`${messageId}\``,
  });
}

async function handlePublishPreview(interaction, previewId) {
  cleanupExpiredPreviews();

  const item = store.previews[previewId];
  if (!item) {
    await interaction.reply({
      content: "❌ Ez az előnézet már lejárt vagy nem található.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (item.createdBy !== interaction.user.id) {
    await interaction.reply({
      content: "❌ Csak az küldheti ki, aki létrehozta az előnézetet.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const guild = interaction.client.guilds.cache.get(item.guildId) ||
    await interaction.client.guilds.fetch(item.guildId).catch(() => null);
  if (!guild) throw new Error("Nem találom a szervert.");

  const channel = guild.channels.cache.get(item.channelId) ||
    await guild.channels.fetch(item.channelId).catch(() => null);

  if (!safeChannel(channel)) {
    throw new Error("A célcsatorna nem érhető el.");
  }

  const sent = await channel.send(item.payload);

  delete store.previews[previewId];
  saveStore();

  await interaction.update({
    content: `✅ Elküldve ide: <#${channel.id}>\nÜzenet ID: \`${sent.id}\``,
    embeds: [],
    components: [],
  });

  return true;
}

async function handleCancelPreview(interaction, previewId) {
  cleanupExpiredPreviews();

  const item = store.previews[previewId];
  if (!item) {
    await interaction.reply({
      content: "❌ Ez az előnézet már lejárt vagy nem található.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (item.createdBy !== interaction.user.id) {
    await interaction.reply({
      content: "❌ Csak az törölheti, aki létrehozta az előnézetet.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  delete store.previews[previewId];
  saveStore();

  await interaction.update({
    content: "🗑️ Előnézet törölve.",
    embeds: [],
    components: [],
  });

  return true;
}

async function handleButton(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId?.startsWith("embed:create:")) return false;

  const [, , action, previewId] = interaction.customId.split(":");

  if (action === "publish") {
    return handlePublishPreview(interaction, previewId);
  }

  if (action === "cancel") {
    return handleCancelPreview(interaction, previewId);
  }

  return false;
}

async function handleSlash(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== "embed") return false;

  if (!hasStaffPermission(interaction)) {
    await interaction.reply({
      content: "❌ Ehhez nincs jogosultságod.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  try {
    const sub = interaction.options.getSubcommand();

    if (sub === "create") {
      await handleCreate(interaction);
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

    if (sub === "delete") {
      await handleDelete(interaction);
      return true;
    }
  } catch (error) {
    console.error("[EMBED] handleSlash hiba:", error);

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

  client.once("clientReady", async () => {
    cleanupExpiredPreviews();
    console.log("[EMBED] Egyszerű embed creator betöltve.");
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      const buttonHandled = await handleButton(interaction);
      if (buttonHandled) return;

      const slashHandled = await handleSlash(interaction);
      if (slashHandled) return;
    } catch (error) {
      console.error("[EMBED] interactionCreate hiba:", error);
    }
  });
}

function getEmbedCommand() {
  return getCommand();
}

module.exports = {
  registerEmbedStudio,
  getEmbedCommand,
};