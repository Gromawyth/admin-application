"use strict";

const fs = require("fs");
const path = require("path");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  MessageFlags,
  ChannelType
} = require("discord.js");

const DATA_FILE = path.join(__dirname, "systempanel-data.json");

const DEFAULT_STATE = {
  panelChannelId: null,
  actionLogChannelId: null,
  panelMessages: {},
  systems: {
    aimod_enabled: true,
    aimod_safe_mode: false,
    aimod_allow_ban: true,
    aimod_allow_kick: true,
    aimod_allow_timeout: true,
    aimod_allow_delete_notice: true,

    bugreport_enabled: true,
    bugreport_ai_summary: true,
    bugreport_auto_status: true,
    bugreport_delete_timer: true,

    ideas_enabled: true,
    ideas_ai_grouping: true,
    ideas_ai_decisions: true,
    ideas_comment_insights: true,

    adminfeedback_enabled: true,
    adminfeedback_ai_summary: true,
    adminfeedback_accept_new_reviews: true,

    tickets_enabled: true,
    tickets_allow_open: true,
    tickets_allow_modal: true,

    logs_enabled: true,
    logs_message: true,
    logs_voice: true,
    logs_ticket: true,
    logs_moderation: true,
    logs_daily_stats: true
  }
};

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function loadStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const fresh = cloneDefault();
      fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2), "utf8");
      return fresh;
    }

    const raw = fs.readFileSync(DATA_FILE, "utf8");
    if (!raw.trim()) return cloneDefault();

    const parsed = JSON.parse(raw);

    return {
      panelChannelId: parsed.panelChannelId || null,
      actionLogChannelId: parsed.actionLogChannelId || null,
      panelMessages: parsed.panelMessages || {},
      systems: {
        ...DEFAULT_STATE.systems,
        ...(parsed.systems || {})
      }
    };
  } catch (error) {
    console.error("[SYSTEMPANEL] loadStore hiba:", error);
    return cloneDefault();
  }
}

let store = loadStore();

function saveStore() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    console.error("[SYSTEMPANEL] saveStore hiba:", error);
  }
}

function hasStaffPermission(interaction) {
  if (!interaction?.member) return false;

  const member = interaction.member;
  return Boolean(
    member.permissions?.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
    member.permissions?.has(PermissionsBitField.Flags.BanMembers)
  );
}

function getState(key, fallback = false) {
  return typeof store.systems[key] === "boolean" ? store.systems[key] : fallback;
}

function setState(key, value) {
  store.systems[key] = Boolean(value);
  saveStore();
}

function getPanelConfig() {
  return {
    panelChannelId: store.panelChannelId,
    actionLogChannelId: store.actionLogChannelId
  };
}

function setPanelChannels(panelChannelId, actionLogChannelId) {
  store.panelChannelId = panelChannelId || null;
  store.actionLogChannelId = actionLogChannelId || null;
  saveStore();
}

function yesNo(enabled, yes = "🟢 Bekapcsolva", no = "🔴 Kikapcsolva") {
  return enabled ? yes : no;
}

function boolButtonLabel(enabled, offLabel, onLabel) {
  return enabled ? offLabel : onLabel;
}

function mapValues(obj, prefix = "") {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    lines.push(`${prefix}${key}: ${value}`);
  }
  return lines.join("\n");
}

function getSystemMeta() {
  return {
    master: {
      title: "🧩 internalGaming • Központi vezérlőpult",
      color: 0x1f8b4c
    },

    aimod: {
      title: "🤖 AI Moderáció",
      color: 0x5865F2,
      description:
        "Automatikus szabálysértés-figyelés, kockázati profilok, warn / delete / timeout / kick / ban döntések.",
      commandText: [
        "/delaiwarn — játékos AI kockázat nullázása",
        "A panel gombjai kiváltják a legtöbb napi kezelést."
      ]
    },

    bugreport: {
      title: "🐞 Bugreport rendszer",
      color: 0xE67E22,
      description:
        "Bug fórum figyelés, AI leírás, státuszkezelés, summary embedek frissítése.",
      commandText: [
        "A panel gombjai kezelik a fő működést.",
        "A státuszok továbbra is a bug summary gombokon állíthatók."
      ]
    },

    ideas: {
      title: "💡 Ötlet rendszer",
      color: 0x2ECC71,
      description:
        "Ötlet fórum figyelés, AI összegzés, közösségi komment insightok és státuszkezelés.",
      commandText: [
        "A panel gombjai a működési módokat állítják.",
        "A státuszok az ötlet summary gombokon továbbra is külön kezelhetők."
      ]
    },

    adminfeedback: {
      title: "👮 Admin Feedback",
      color: 0xF1C40F,
      description:
        "Admin értékelések, publikus panelek, log csatorna, összesítő és AI leírások kezelése.",
      commandText: [
        "A panel kiváltja a reset jellegű staff műveleteket.",
        "A publikus értékelő panelek külön frissíthetők."
      ]
    },

    tickets: {
      title: "🎫 Ticket rendszer",
      color: 0x3498DB,
      description:
        "Ticket panelek, ticket nyitás, modal bekérés, privát ticket csatornák és lezárás.",
      commandText: [
        "A panelből leállítható az új ticket nyitás.",
        "A már megnyitott ticketek ettől még kezelhetők maradhatnak."
      ]
    },

    logs: {
      title: "📜 Log + Napi stat rendszer",
      color: 0x95A5A6,
      description:
        "Szervernaplózás, külön log típusok és a hajnalban futó napi statisztika küldés kezelése.",
      commandText: [
        "/discordstats — kézi stat küldés",
        "A napi stat külön is leállítható a teljes log rendszertől."
      ]
    }
  };
}

function buildMasterEmbed() {
  const meta = getSystemMeta().master;

  return new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(meta.title)
    .setDescription(
      "Ez a központi staff vezérlőpult az összes fontos rendszer állapotát, kezelését és gyors műveleteit tartalmazza."
    )
    .addFields(
      {
        name: "📌 Rövid állapot",
        value: [
          `AI Moderáció: ${yesNo(getState("aimod_enabled"))}`,
          `Bugreport: ${yesNo(getState("bugreport_enabled"))}`,
          `Ötletek: ${yesNo(getState("ideas_enabled"))}`,
          `Admin Feedback: ${yesNo(getState("adminfeedback_enabled"))}`,
          `Ticketek: ${yesNo(getState("tickets_enabled"))}`,
          `Log rendszer: ${yesNo(getState("logs_enabled"))}`,
          `Napi stat: ${yesNo(getState("logs_daily_stats"))}`
        ].join("\n"),
        inline: false
      },
      {
        name: "🔘 Gombok leírása",
        value:
          "**Összes leállítása gomb:**\nMinden rendszer működését egyszerre felfüggeszti, hogy hiba vagy karbantartás esetén gyorsan meg lehessen fogni az egész botot.\n\n" +
          "**Safe mód gomb:**\nBiztonságosabb üzemmódra állítja a kritikusabb rendszereket, főleg az AI moderációt. Ilyenkor a keményebb automatikus lépések tiltva lehetnek.\n\n" +
          "**Panel frissítés gomb:**\nÚjraépíti a vezérlőpult állapotát és a gombneveket, így a csatornában mindig az aktuális állapot látszik.",
        inline: false
      }
    )
    .setFooter({ text: "internalGaming • Staff vezérlőpult" })
    .setTimestamp(new Date());
}

function buildMasterButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:master:disableall")
        .setLabel("Összes rendszer leállítása")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("systempanel:master:enableall")
        .setLabel("Összes rendszer indítása")
        .setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:master:safe")
        .setLabel("Safe mód")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("systempanel:master:refresh")
        .setLabel("Panel frissítése")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildAiEmbed() {
  const meta = getSystemMeta().aimod;

  return new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(meta.title)
    .setDescription(meta.description)
    .addFields(
      {
        name: "📌 Állapot",
        value: [
          `Rendszer: ${yesNo(getState("aimod_enabled"))}`,
          `Safe mód: ${yesNo(getState("aimod_safe_mode"))}`,
          `Ban: ${yesNo(getState("aimod_allow_ban"))}`,
          `Kick: ${yesNo(getState("aimod_allow_kick"))}`,
          `Timeout: ${yesNo(getState("aimod_allow_timeout"))}`,
          `Delete notice: ${yesNo(getState("aimod_allow_delete_notice"))}`
        ].join("\n"),
        inline: false
      },
      {
        name: "⌨️ Parancsok",
        value: meta.commandText.map((x) => `• ${x}`).join("\n"),
        inline: false
      },
      {
        name: "🔘 Gombok leírása",
        value:
          "**AI BE/KI gomb:**\nA teljes AI moderációs rendszert kapcsolja le vagy vissza. Kikapcsolt állapotban az AI moderáció nem vizsgál és nem szankcionál.\n\n" +
          "**Safe mód gomb:**\nBiztonságos módra állítja az AI-t, hogy a keményebb automatikus lépések nélkül is tudjon működni. Ez főleg karbantartáskor vagy teszteléskor hasznos.\n\n" +
          "**Ban/Kick/Timeout felfüggesztés gombok:**\nCsak az adott szankciót tiltják le, a többi működés megmaradhat. Így finoman lehet visszavenni a rendszer erejét anélkül, hogy mindent teljesen leállítanál.\n\n" +
          "**Delete notice gomb:**\nA chatben megjelenő AI figyelmeztető visszajelzéseket kezeli. Ha kikapcsolod, a rendszer attól még dolgozhat, csak a csatornaértesítések maradnak el.",
        inline: false
      }
    )
    .setFooter({ text: "internalGaming • AI moderáció kezelése" })
    .setTimestamp(new Date());
}

function buildAiButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:aimod_enabled")
        .setLabel(boolButtonLabel(getState("aimod_enabled"), "AI kikapcsolása", "AI bekapcsolása"))
        .setStyle(getState("aimod_enabled") ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("systempanel:toggle:aimod_safe_mode")
        .setLabel(boolButtonLabel(getState("aimod_safe_mode"), "Teljes mód visszaállítása", "Safe mód"))
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:aimod_allow_ban")
        .setLabel(boolButtonLabel(getState("aimod_allow_ban"), "Ban felfüggesztése", "Ban visszakapcsolása"))
        .setStyle(getState("aimod_allow_ban") ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("systempanel:toggle:aimod_allow_kick")
        .setLabel(boolButtonLabel(getState("aimod_allow_kick"), "Kick felfüggesztése", "Kick visszakapcsolása"))
        .setStyle(getState("aimod_allow_kick") ? ButtonStyle.Danger : ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:aimod_allow_timeout")
        .setLabel(boolButtonLabel(getState("aimod_allow_timeout"), "Mute/Timeout felfüggesztése", "Mute/Timeout visszakapcsolása"))
        .setStyle(getState("aimod_allow_timeout") ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("systempanel:toggle:aimod_allow_delete_notice")
        .setLabel(boolButtonLabel(getState("aimod_allow_delete_notice"), "Delete notice kikapcsolása", "Delete notice bekapcsolása"))
        .setStyle(getState("aimod_allow_delete_notice") ? ButtonStyle.Danger : ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:refresh:aimod")
        .setLabel("AI panel frissítése")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildBugEmbed() {
  const meta = getSystemMeta().bugreport;

  return new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(meta.title)
    .setDescription(meta.description)
    .addFields(
      {
        name: "📌 Állapot",
        value: [
          `Rendszer: ${yesNo(getState("bugreport_enabled"))}`,
          `AI összegzés: ${yesNo(getState("bugreport_ai_summary"))}`,
          `Auto státusz: ${yesNo(getState("bugreport_auto_status"))}`,
          `Törlési időzítő: ${yesNo(getState("bugreport_delete_timer"))}`
        ].join("\n"),
        inline: false
      },
      {
        name: "⌨️ Parancsok",
        value: meta.commandText.map((x) => `• ${x}`).join("\n"),
        inline: false
      },
      {
        name: "🔘 Gombok leírása",
        value:
          "**Rendszer gomb:**\nA teljes bugreport figyelést állítja le vagy indítja vissza. Ez a fórumfigyelésre és a summary frissítésekre is hat.\n\n" +
          "**AI összegzés gomb:**\nAz AI által készített rövid leírásokat kapcsolja. Kikapcsolva a rendszer egyszerűbb vagy fallback jellegű működésre állhat át.\n\n" +
          "**Auto státusz gomb:**\nA státuszjavaslatok vagy automatikus státuszhoz kapcsolódó logika engedélyezését kezeli. Ha kikapcsolod, inkább csak kézi staff döntés marad.\n\n" +
          "**Törlési időzítő gomb:**\nA lezárt vagy elutasított bug thread-ek késleltetett eltakarítását szabályozza. Hasznos, ha ideiglenesen meg akarod tartani a threadeket ellenőrzéshez.",
        inline: false
      }
    )
    .setFooter({ text: "internalGaming • Bugreport kezelése" })
    .setTimestamp(new Date());
}

function buildBugButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:bugreport_enabled")
        .setLabel(boolButtonLabel(getState("bugreport_enabled"), "Bugreport kikapcsolása", "Bugreport bekapcsolása"))
        .setStyle(getState("bugreport_enabled") ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("systempanel:toggle:bugreport_ai_summary")
        .setLabel(boolButtonLabel(getState("bugreport_ai_summary"), "AI összegzés kikapcsolása", "AI összegzés bekapcsolása"))
        .setStyle(getState("bugreport_ai_summary") ? ButtonStyle.Danger : ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:bugreport_auto_status")
        .setLabel(boolButtonLabel(getState("bugreport_auto_status"), "Auto státusz kikapcsolása", "Auto státusz bekapcsolása"))
        .setStyle(getState("bugreport_auto_status") ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("systempanel:toggle:bugreport_delete_timer")
        .setLabel(boolButtonLabel(getState("bugreport_delete_timer"), "Törlési időzítő kikapcsolása", "Törlési időzítő bekapcsolása"))
        .setStyle(getState("bugreport_delete_timer") ? ButtonStyle.Danger : ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:refresh:bugreport")
        .setLabel("Bug panel frissítése")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildIdeasEmbed() {
  const meta = getSystemMeta().ideas;

  return new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(meta.title)
    .setDescription(meta.description)
    .addFields(
      {
        name: "📌 Állapot",
        value: [
          `Rendszer: ${yesNo(getState("ideas_enabled"))}`,
          `AI csoportosítás: ${yesNo(getState("ideas_ai_grouping"))}`,
          `AI döntések: ${yesNo(getState("ideas_ai_decisions"))}`,
          `Comment insightok: ${yesNo(getState("ideas_comment_insights"))}`
        ].join("\n"),
        inline: false
      },
      {
        name: "⌨️ Parancsok",
        value: meta.commandText.map((x) => `• ${x}`).join("\n"),
        inline: false
      },
      {
        name: "🔘 Gombok leírása",
        value:
          "**Rendszer gomb:**\nAz egész ötlet rendszert leállítja vagy visszakapcsolja. Ez a fórum figyelésére és a summary üzenetek frissítésére is kihat.\n\n" +
          "**AI csoportosítás gomb:**\nA hasonló ötletek AI-alapú összekapcsolását és belső felismerését kezeli. Tesztnél vagy hiba esetén érdemes külön lekapcsolhatóvá tenni.\n\n" +
          "**AI döntések gomb:**\nAz AI döntést vagy erősebb döntési javaslatot kapcsolja. Kikapcsolva inkább a staff kézi döntés marad hangsúlyos.\n\n" +
          "**Comment insight gomb:**\nA kommentekből épülő közösségi insightokat és rövid kivonatokat kezeli. Ha ezt kikapcsolod, a rendszer egyszerűbben működik.",
        inline: false
      }
    )
    .setFooter({ text: "internalGaming • Ötlet rendszer kezelése" })
    .setTimestamp(new Date());
}

function buildIdeasButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:ideas_enabled")
        .setLabel(boolButtonLabel(getState("ideas_enabled"), "Ötlet rendszer kikapcsolása", "Ötlet rendszer bekapcsolása"))
        .setStyle(getState("ideas_enabled") ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("systempanel:toggle:ideas_ai_grouping")
        .setLabel(boolButtonLabel(getState("ideas_ai_grouping"), "AI csoportosítás kikapcsolása", "AI csoportosítás bekapcsolása"))
        .setStyle(getState("ideas_ai_grouping") ? ButtonStyle.Danger : ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:ideas_ai_decisions")
        .setLabel(boolButtonLabel(getState("ideas_ai_decisions"), "AI döntések kikapcsolása", "AI döntések bekapcsolása"))
        .setStyle(getState("ideas_ai_decisions") ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("systempanel:toggle:ideas_comment_insights")
        .setLabel(boolButtonLabel(getState("ideas_comment_insights"), "Comment insight kikapcsolása", "Comment insight bekapcsolása"))
        .setStyle(getState("ideas_comment_insights") ? ButtonStyle.Danger : ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:refresh:ideas")
        .setLabel("Ötlet panel frissítése")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildAdminFeedbackEmbed() {
  const meta = getSystemMeta().adminfeedback;

  return new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(meta.title)
    .setDescription(meta.description)
    .addFields(
      {
        name: "📌 Állapot",
        value: [
          `Rendszer: ${yesNo(getState("adminfeedback_enabled"))}`,
          `AI összegzés: ${yesNo(getState("adminfeedback_ai_summary"))}`,
          `Új értékelések: ${yesNo(getState("adminfeedback_accept_new_reviews"))}`
        ].join("\n"),
        inline: false
      },
      {
        name: "⌨️ Parancsok",
        value: meta.commandText.map((x) => `• ${x}`).join("\n"),
        inline: false
      },
      {
        name: "🔘 Gombok leírása",
        value:
          "**Rendszer gomb:**\nAz egész admin feedback működést kapcsolja le vagy vissza. Kikapcsolva a rendszer nem fog új értékelésekkel dolgozni.\n\n" +
          "**AI összegzés gomb:**\nAz adminokról készített AI leírások és összegző szövegek engedélyezését kezeli. Tesztnél vagy költségcsökkentésnél hasznos külön kapcsoló.\n\n" +
          "**Új értékelések gomb:**\nIdeiglenesen lezárja vagy megnyitja az új értékelések fogadását. Ezzel anélkül állíthatod meg a beküldést, hogy az egész rendszert leállítanád.\n\n" +
          "**Reset gomb:**\nA korábbi staff reset műveletet váltja ki a panelből. Így nem kell külön parancsot használni a reseteléshez.",
        inline: false
      }
    )
    .setFooter({ text: "internalGaming • Admin feedback kezelése" })
    .setTimestamp(new Date());
}

function buildAdminFeedbackButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:adminfeedback_enabled")
        .setLabel(boolButtonLabel(getState("adminfeedback_enabled"), "Admin feedback kikapcsolása", "Admin feedback bekapcsolása"))
        .setStyle(getState("adminfeedback_enabled") ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("systempanel:toggle:adminfeedback_ai_summary")
        .setLabel(boolButtonLabel(getState("adminfeedback_ai_summary"), "AI összegzés kikapcsolása", "AI összegzés bekapcsolása"))
        .setStyle(getState("adminfeedback_ai_summary") ? ButtonStyle.Danger : ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:adminfeedback_accept_new_reviews")
        .setLabel(boolButtonLabel(getState("adminfeedback_accept_new_reviews"), "Értékelések lezárása", "Értékelések megnyitása"))
        .setStyle(getState("adminfeedback_accept_new_reviews") ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("systempanel:action:adminfeedback_reset")
        .setLabel("Admin feedback reset")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:refresh:adminfeedback")
        .setLabel("Admin feedback panel frissítése")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildTicketEmbed() {
  const meta = getSystemMeta().tickets;

  return new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(meta.title)
    .setDescription(meta.description)
    .addFields(
      {
        name: "📌 Állapot",
        value: [
          `Rendszer: ${yesNo(getState("tickets_enabled"))}`,
          `Új ticket nyitás: ${yesNo(getState("tickets_allow_open"))}`,
          `Ticket modal: ${yesNo(getState("tickets_allow_modal"))}`
        ].join("\n"),
        inline: false
      },
      {
        name: "⌨️ Parancsok",
        value: meta.commandText.map((x) => `• ${x}`).join("\n"),
        inline: false
      },
      {
        name: "🔘 Gombok leírása",
        value:
          "**Rendszer gomb:**\nAz egész ticket rendszer működését állítja le vagy indítja el újra. Ez a ticket gombok, nyitás és kezelés fő kapcsolója.\n\n" +
          "**Új ticket nyitás gomb:**\nCsak az új ticketek létrehozását tiltja vagy engedi. Karbantartásnál ez sokkal hasznosabb, mint a teljes rendszer leállítása.\n\n" +
          "**Modal gomb:**\nA ticket kérdéses bekérő ablakot kapcsolja. Ha a modal rész hibás vagy tesztelés alatt van, ezzel külön leállítható.",
        inline: false
      }
    )
    .setFooter({ text: "internalGaming • Ticket rendszer kezelése" })
    .setTimestamp(new Date());
}

function buildTicketButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:tickets_enabled")
        .setLabel(boolButtonLabel(getState("tickets_enabled"), "Ticket rendszer kikapcsolása", "Ticket rendszer bekapcsolása"))
        .setStyle(getState("tickets_enabled") ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("systempanel:toggle:tickets_allow_open")
        .setLabel(boolButtonLabel(getState("tickets_allow_open"), "Új ticket nyitás tiltása", "Új ticket nyitás engedése"))
        .setStyle(getState("tickets_allow_open") ? ButtonStyle.Danger : ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:tickets_allow_modal")
        .setLabel(boolButtonLabel(getState("tickets_allow_modal"), "Ticket modal kikapcsolása", "Ticket modal bekapcsolása"))
        .setStyle(getState("tickets_allow_modal") ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("systempanel:refresh:tickets")
        .setLabel("Ticket panel frissítése")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildLogsEmbed() {
  const meta = getSystemMeta().logs;

  return new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(meta.title)
    .setDescription(meta.description)
    .addFields(
      {
        name: "📌 Állapot",
        value: [
          `Log rendszer: ${yesNo(getState("logs_enabled"))}`,
          `Napi stat: ${yesNo(getState("logs_daily_stats"))}`,
          `Üzenet log: ${yesNo(getState("logs_message"))}`,
          `Voice log: ${yesNo(getState("logs_voice"))}`,
          `Ticket log: ${yesNo(getState("logs_ticket"))}`,
          `Moderációs log: ${yesNo(getState("logs_moderation"))}`
        ].join("\n"),
        inline: false
      },
      {
        name: "⌨️ Parancsok",
        value: meta.commandText.map((x) => `• ${x}`).join("\n"),
        inline: false
      },
      {
        name: "🔘 Gombok leírása",
        value:
          "**Log rendszer gomb:**\nA teljes eseménynaplózást állítja le vagy indítja vissza. Ha ez ki van kapcsolva, a log embedek többsége nem kerül kiküldésre.\n\n" +
          "**Napi stat gomb:**\nA hajnalban automatikusan küldött statisztikai jelentést kezeli. Ezt külön is leállíthatod anélkül, hogy a többi logot lekapcsolnád.\n\n" +
          "**Üzenet/Voice/Ticket/Moderáció gombok:**\nAz egyes log típusokat külön lehet velük szabályozni. Így például megfoghatod a felesleges spamet csak egy adott log kategóriában.\n\n" +
          "**Kézi stat gomb:**\nAzonnali statküldést kérhetsz vele staff műveletként. Ez hasznos tesztelésre vagy gyors ellenőrzésre.",
        inline: false
      }
    )
    .setFooter({ text: "internalGaming • Log és stat rendszer kezelése" })
    .setTimestamp(new Date());
}

function buildLogsButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:logs_enabled")
        .setLabel(boolButtonLabel(getState("logs_enabled"), "Log rendszer kikapcsolása", "Log rendszer bekapcsolása"))
        .setStyle(getState("logs_enabled") ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("systempanel:toggle:logs_daily_stats")
        .setLabel(boolButtonLabel(getState("logs_daily_stats"), "Napi stat kikapcsolása", "Napi stat bekapcsolása"))
        .setStyle(getState("logs_daily_stats") ? ButtonStyle.Danger : ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:logs_message")
        .setLabel(boolButtonLabel(getState("logs_message"), "Üzenet log kikapcsolása", "Üzenet log bekapcsolása"))
        .setStyle(getState("logs_message") ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("systempanel:toggle:logs_voice")
        .setLabel(boolButtonLabel(getState("logs_voice"), "Voice log kikapcsolása", "Voice log bekapcsolása"))
        .setStyle(getState("logs_voice") ? ButtonStyle.Danger : ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:logs_ticket")
        .setLabel(boolButtonLabel(getState("logs_ticket"), "Ticket log kikapcsolása", "Ticket log bekapcsolása"))
        .setStyle(getState("logs_ticket") ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("systempanel:toggle:logs_moderation")
        .setLabel(boolButtonLabel(getState("logs_moderation"), "Moderációs log kikapcsolása", "Moderációs log bekapcsolása"))
        .setStyle(getState("logs_moderation") ? ButtonStyle.Danger : ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:action:logs_send_stats")
        .setLabel("Kézi stat küldés")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("systempanel:refresh:logs")
        .setLabel("Log panel frissítése")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function getPanelDefinitions() {
  return [
    { key: "master", buildEmbed: buildMasterEmbed, buildRows: buildMasterButtons },
    { key: "aimod", buildEmbed: buildAiEmbed, buildRows: buildAiButtons },
    { key: "bugreport", buildEmbed: buildBugEmbed, buildRows: buildBugButtons },
    { key: "ideas", buildEmbed: buildIdeasEmbed, buildRows: buildIdeasButtons },
    { key: "adminfeedback", buildEmbed: buildAdminFeedbackEmbed, buildRows: buildAdminFeedbackButtons },
    { key: "tickets", buildEmbed: buildTicketEmbed, buildRows: buildTicketButtons },
    { key: "logs", buildEmbed: buildLogsEmbed, buildRows: buildLogsButtons }
  ];
}

async function fetchTextChannel(guild, channelId) {
  if (!guild || !channelId) return null;

  const ch =
    guild.channels.cache.get(channelId) ||
    await guild.channels.fetch(channelId).catch(() => null);

  if (!ch || !ch.isTextBased()) return null;
  return ch;
}

async function logControlAction(interaction, label, beforeValue, afterValue) {
  if (!store.actionLogChannelId || !interaction.guild) return;

  const channel = await fetchTextChannel(interaction.guild, store.actionLogChannelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x2f3136)
    .setTitle("🛠️ Vezérlőpult művelet")
    .setDescription(`${interaction.user} módosított egy rendszerbeállítást.`)
    .addFields(
      { name: "👤 Staff", value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
      { name: "⚙️ Művelet", value: label, inline: false },
      { name: "⬅️ Előző állapot", value: String(beforeValue), inline: true },
      { name: "➡️ Új állapot", value: String(afterValue), inline: true }
    )
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] }).catch(() => null);
}

async function sendOrEditPanelMessage(channel, key, embed, components) {
  const existingId = store.panelMessages[key];

  if (existingId) {
    const oldMsg = await channel.messages.fetch(existingId).catch(() => null);
    if (oldMsg) {
      await oldMsg.edit({
        embeds: [embed],
        components
      }).catch(() => null);
      return oldMsg;
    }
  }

  const sent = await channel.send({
    embeds: [embed],
    components
  });

  store.panelMessages[key] = sent.id;
  saveStore();
  return sent;
}

async function publishPanel(guild, panelChannel, actionLogChannel = null) {
  setPanelChannels(panelChannel.id, actionLogChannel?.id || store.actionLogChannelId);

  for (const def of getPanelDefinitions()) {
    await sendOrEditPanelMessage(
      panelChannel,
      def.key,
      def.buildEmbed(),
      def.buildRows()
    );
  }
}

async function refreshPanel(guild) {
  if (!store.panelChannelId) return false;
  const panelChannel = await fetchTextChannel(guild, store.panelChannelId);
  if (!panelChannel) return false;

  const actionChannel = store.actionLogChannelId
    ? await fetchTextChannel(guild, store.actionLogChannelId)
    : null;

  await publishPanel(guild, panelChannel, actionChannel);
  return true;
}

async function handleMasterAction(interaction, action) {
  if (action === "disableall") {
    for (const key of Object.keys(store.systems)) {
      store.systems[key] = false;
    }
    saveStore();
    await logControlAction(interaction, "Összes rendszer leállítása", "vegyes", "minden kikapcsolva");
  }

  if (action === "enableall") {
    for (const key of Object.keys(store.systems)) {
      store.systems[key] = true;
    }
    saveStore();
    await logControlAction(interaction, "Összes rendszer indítása", "vegyes", "minden bekapcsolva");
  }

  if (action === "safe") {
    setState("aimod_enabled", true);
    setState("aimod_safe_mode", true);
    setState("aimod_allow_ban", false);
    setState("aimod_allow_kick", false);
    setState("aimod_allow_timeout", true);
    await logControlAction(interaction, "Safe mód", "normál", "safe");
  }

  if (action === "refresh") {
    await logControlAction(interaction, "Panel frissítése", "aktuális", "frissítve");
  }

  await refreshPanel(interaction.guild).catch(() => null);

  await interaction.update({
    embeds: [buildMasterEmbed()],
    components: buildMasterButtons()
  });
}

async function handleToggleAction(interaction, key) {
  const before = getState(key);
  const after = !before;
  setState(key, after);

  await logControlAction(interaction, `Kapcsoló módosítása: ${key}`, before, after);
  await refreshPanel(interaction.guild).catch(() => null);

  await interaction.deferUpdate().catch(() => null);
}

async function handleSystemRefresh(interaction, key) {
  await logControlAction(interaction, `Panel frissítés: ${key}`, "aktuális", "frissítve");
  await refreshPanel(interaction.guild).catch(() => null);
  await interaction.deferUpdate().catch(() => null);
}

async function handleCustomAction(interaction, key) {
  if (key === "adminfeedback_reset") {
    const adminFeedback = require("./adminfeedback");
    await adminFeedback.resetData(interaction);
    await logControlAction(interaction, "Admin feedback reset", "aktív adatok", "resetelve");
    await refreshPanel(interaction.guild).catch(() => null);
    return;
  }

  if (key === "logs_send_stats") {
    interaction.client.emit("systempanel:sendManualStats", interaction);
    await logControlAction(interaction, "Kézi stat küldés indítva", "nincs", "elküldve");
    await interaction.deferUpdate().catch(() => null);
    return;
  }

  await interaction.reply({
    content: "Ismeretlen panel művelet.",
    flags: MessageFlags.Ephemeral
  }).catch(() => null);
}

async function handleSlash(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== "systempanel") return false;

  if (!hasStaffPermission(interaction)) {
    await interaction.reply({
      content: "Ehhez staff jogosultság kell.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "send") {
    const panelChannel = interaction.options.getChannel("panelcsatorna");
    const actionLogChannel = interaction.options.getChannel("műveletlog");

    if (!panelChannel || !panelChannel.isTextBased() || panelChannel.type === ChannelType.GuildVoice) {
      await interaction.reply({
        content: "A vezérlőpulthoz egy szöveges csatorna kell.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    if (!actionLogChannel || !actionLogChannel.isTextBased() || actionLogChannel.type === ChannelType.GuildVoice) {
      await interaction.reply({
        content: "A műveletloghoz egy szöveges csatorna kell.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await publishPanel(interaction.guild, panelChannel, actionLogChannel);

    await interaction.reply({
      content: `✅ A vezérlőpult elkészült ide: ${panelChannel}\n📝 Művelet log csatorna: ${actionLogChannel}`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (sub === "refresh") {
    const ok = await refreshPanel(interaction.guild);

    await interaction.reply({
      content: ok
        ? "✅ A vezérlőpult frissítve lett."
        : "❌ Nem találom a korábban kiküldött vezérlőpultot.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (sub === "status") {
    const content = mapValues({
      aimod_enabled: yesNo(getState("aimod_enabled")),
      bugreport_enabled: yesNo(getState("bugreport_enabled")),
      ideas_enabled: yesNo(getState("ideas_enabled")),
      adminfeedback_enabled: yesNo(getState("adminfeedback_enabled")),
      tickets_enabled: yesNo(getState("tickets_enabled")),
      logs_enabled: yesNo(getState("logs_enabled")),
      logs_daily_stats: yesNo(getState("logs_daily_stats"))
    }, "• ");

    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  return true;
}

async function handleButtons(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith("systempanel:")) return false;

  if (!hasStaffPermission(interaction)) {
    await interaction.reply({
      content: "Ehhez staff jogosultság kell.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const parts = interaction.customId.split(":");
  const type = parts[1];
  const key = parts[2];

  if (type === "master") {
    await handleMasterAction(interaction, key);
    return true;
  }

  if (type === "toggle") {
    await handleToggleAction(interaction, key);
    return true;
  }

  if (type === "refresh") {
    await handleSystemRefresh(interaction, key);
    return true;
  }

  if (type === "action") {
    await handleCustomAction(interaction, key);
    return true;
  }

  return false;
}

function registerSystemPanel(client) {
  client.on("interactionCreate", async (interaction) => {
    try {
      const slashHandled = await handleSlash(interaction);
      if (slashHandled) return;

      const buttonHandled = await handleButtons(interaction);
      if (buttonHandled) return;
    } catch (error) {
      console.error("[SYSTEMPANEL] interaction hiba:", error);

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: "❌ Hiba történt a vezérlőpult művelet közben."
          });
        } else if (interaction.isRepliable()) {
          await interaction.reply({
            content: "❌ Hiba történt a vezérlőpult művelet közben.",
            flags: MessageFlags.Ephemeral
          });
        }
      } catch {}
    }
  });
}

module.exports = {
  registerSystemPanel,
  getState,
  setState,
  refreshPanel,
  getPanelConfig
};