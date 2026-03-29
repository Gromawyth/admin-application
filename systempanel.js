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

function getSystemLabel(key) {
  const labels = {
    aimod_enabled: "AI moderáció",
    aimod_safe_mode: "Biztonságos mód",
    aimod_allow_ban: "Automatikus kitiltás",
    aimod_allow_kick: "Automatikus kirúgás",
    aimod_allow_timeout: "Automatikus némítás / időkorlát",
    aimod_allow_delete_notice: "Törlési értesítés",

    bugreport_enabled: "Bugreport rendszer",
    bugreport_ai_summary: "AI összegzés",
    bugreport_auto_status: "Automatikus státusz",
    bugreport_delete_timer: "Törlési időzítő",

    ideas_enabled: "Ötlet rendszer",
    ideas_ai_grouping: "AI csoportosítás",
    ideas_ai_decisions: "AI döntések",
    ideas_comment_insights: "Komment összegzések",

    adminfeedback_enabled: "Admin értékelési rendszer",
    adminfeedback_ai_summary: "AI összegzés",
    adminfeedback_accept_new_reviews: "Új értékelések fogadása",

    tickets_enabled: "Ticket rendszer",
    tickets_allow_open: "Új ticket nyitás",
    tickets_allow_modal: "Ticket kérdőablak",

    logs_enabled: "Naplózási rendszer",
    logs_message: "Üzenetnaplózás",
    logs_voice: "Hangcsatorna naplózás",
    logs_ticket: "Ticket naplózás",
    logs_moderation: "Moderációs naplózás",
    logs_daily_stats: "Napi statisztika"
  };

  return labels[key] || key;
}

function getSystemMeta() {
  return {
    master: {
      title: "🧩 internalGaming • Központi vezérlőpult",
      color: 0x1f8b4c
    },

    aimod: {
      title: "🤖 AI moderáció",
      color: 0x5865F2,
      description:
        "Automatikus szabálysértés-figyelés, kockázati profilok és külön szabályozható szankciók kezelése egy helyen.",
      commandText: [
        "/delaiwarn — játékos AI kockázat nullázása",
        "A panel gombjai a legtöbb napi AI kezelést kiváltják."
      ]
    },

    bugreport: {
      title: "🐞 Bugreport rendszer",
      color: 0xE67E22,
      description:
        "Bug fórum figyelés, AI összegzés, státuszkezelés és summary üzenetek vezérlése.",
      commandText: [
        "A panel gombjai a fő működést szabályozzák.",
        "A státuszok továbbra is a bug summary gombokon állíthatók."
      ]
    },

    ideas: {
      title: "💡 Ötlet rendszer",
      color: 0x2ECC71,
      description:
        "Ötlet fórum figyelés, AI összegzés, közösségi kommentfeldolgozás és státuszkezelés.",
      commandText: [
        "A panel gombjai a működési módokat állítják.",
        "A státuszok az ötlet summary gombokon külön kezelhetők."
      ]
    },

    adminfeedback: {
      title: "👮 Admin értékelési rendszer",
      color: 0xF1C40F,
      description:
        "Admin értékelések, publikus panelek, naplócsatorna, összesítő és AI leírások kezelése.",
      commandText: [
        "A panel kiváltja a reset jellegű staff műveleteket.",
        "A publikus értékelő panelek külön is frissíthetők."
      ]
    },

    tickets: {
      title: "🎫 Ticket rendszer",
      color: 0x3498DB,
      description:
        "Ticket panelek, új ticket nyitás, kérdőablakok és privát ticket működés kezelése.",
      commandText: [
        "A panelből leállítható az új ticket nyitás.",
        "A már megnyitott ticketek ettől még kezelhetők maradhatnak."
      ]
    },

    logs: {
      title: "📜 Naplózási és statisztikai rendszer",
      color: 0x95A5A6,
      description:
        "Szervernaplózás, külön log típusok és a hajnalban futó napi statisztika kezelése.",
      commandText: [
        "/discordstats — kézi stat küldés",
        "A napi stat külön is leállítható a teljes naplózástól."
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
      "Ez a központi staff vezérlőpult az összes fontos rendszer állapotát, kezelését és gyors beavatkozási lehetőségét egy helyen jeleníti meg."
    )
    .addFields(
      {
        name: "📌 Rövid állapot",
        value: [
          `AI moderáció: ${yesNo(getState("aimod_enabled"))}`,
          `Bugreport rendszer: ${yesNo(getState("bugreport_enabled"))}`,
          `Ötlet rendszer: ${yesNo(getState("ideas_enabled"))}`,
          `Admin értékelések: ${yesNo(getState("adminfeedback_enabled"))}`,
          `Ticket rendszer: ${yesNo(getState("tickets_enabled"))}`,
          `Naplózási rendszer: ${yesNo(getState("logs_enabled"))}`,
          `Napi statisztika: ${yesNo(getState("logs_daily_stats"))}`
        ].join("\n"),
        inline: false
      },
      {
        name: "🔘 Gombok leírása",
        value:
          "**„Összes rendszer leállítása” gomb:**\nMinden rendszer működését egyszerre felfüggeszti, hogy hiba vagy karbantartás esetén az egész botot gyorsan meg lehessen állítani.\n\n" +
          "**„Összes rendszer indítása” gomb:**\nAz összes fő rendszert egyszerre visszakapcsolja, így nem kell külön-külön mindent újra engedélyezni.\n\n" +
          "**„Safe mód” gomb:**\nBiztonságosabb működésre állítja a kritikusabb rendszereket, főleg az AI moderációt. Ilyenkor az erősebb automatikus szankciók visszafoghatók.\n\n" +
          "**„Panel frissítése” gomb:**\nÚjraépíti a vezérlőpult összes állapotát és gombnevét, így mindig az aktuális állapot látszik.",
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
          `Biztonságos mód: ${yesNo(getState("aimod_safe_mode"))}`,
          `Automatikus kitiltás: ${yesNo(getState("aimod_allow_ban"))}`,
          `Automatikus kirúgás: ${yesNo(getState("aimod_allow_kick"))}`,
          `Automatikus némítás / időkorlát: ${yesNo(getState("aimod_allow_timeout"))}`,
          `Törlési értesítés: ${yesNo(getState("aimod_allow_delete_notice"))}`
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
          "**„AI kikapcsolása” / „AI bekapcsolása” gomb:**\nA teljes AI moderációs rendszert kapcsolja ki vagy vissza. Kikapcsolt állapotban az AI nem vizsgál és nem szankcionál.\n\n" +
          "**„Teljes mód visszaállítása” / „Safe mód” gomb:**\nBiztonságos működési módra állítja vissza az AI rendszert, vagy visszateszi teljes módba. Tesztnél és hiba esetén különösen hasznos.\n\n" +
          "**„Ban felfüggesztése” / „Ban visszakapcsolása” gomb:**\nCsak az automatikus kitiltást szabályozza, a többi AI működés ettől még megmaradhat.\n\n" +
          "**„Kick felfüggesztése” / „Kick visszakapcsolása” gomb:**\nCsak az automatikus kirúgást állítja le vagy engedi vissza.\n\n" +
          "**„Mute/Timeout felfüggesztése” / „Mute/Timeout visszakapcsolása” gomb:**\nAz automatikus némítási vagy időkorlátos büntetést vezérli.\n\n" +
          "**„Törlési értesítés kikapcsolása” / „Törlési értesítés bekapcsolása” gomb:**\nA chatben megjelenő AI értesítéseket szabályozza. Kikapcsolva a rendszer dolgozhat tovább, csak a csatorna-visszajelzés marad el.\n\n" +
          "**„AI panel frissítése” gomb:**\nÚjraépíti az AI moderációs panel állapotát és gombfeliratait.",
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
        .setLabel(boolButtonLabel(getState("aimod_allow_delete_notice"), "Törlési értesítés kikapcsolása", "Törlési értesítés bekapcsolása"))
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
          `Automatikus státusz: ${yesNo(getState("bugreport_auto_status"))}`,
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
          "**„Bugreport kikapcsolása” / „Bugreport bekapcsolása” gomb:**\nA teljes bugreport rendszert állítja le vagy indítja újra. Ez a fórumfigyelésre és az összesítő frissítésekre is kihat.\n\n" +
          "**„AI összegzés kikapcsolása” / „AI összegzés bekapcsolása” gomb:**\nAz AI által készített bugösszefoglalókat szabályozza.\n\n" +
          "**„Auto státusz kikapcsolása” / „Auto státusz bekapcsolása” gomb:**\nAz automatikus vagy javasolt státuszlogikát engedélyezi vagy tiltja.\n\n" +
          "**„Törlési időzítő kikapcsolása” / „Törlési időzítő bekapcsolása” gomb:**\nA lezárt vagy elutasított bug threadek késleltetett eltakarítását kezeli.\n\n" +
          "**„Bug panel frissítése” gomb:**\nÚjraépíti a bugreport panel állapotát és gombfeliratait.",
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
          `Komment összegzések: ${yesNo(getState("ideas_comment_insights"))}`
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
          "**„Ötlet rendszer kikapcsolása” / „Ötlet rendszer bekapcsolása” gomb:**\nAz egész ötlet rendszert állítja le vagy kapcsolja vissza.\n\n" +
          "**„AI csoportosítás kikapcsolása” / „AI csoportosítás bekapcsolása” gomb:**\nA hasonló ötletek AI-alapú összekapcsolását kezeli.\n\n" +
          "**„AI döntések kikapcsolása” / „AI döntések bekapcsolása” gomb:**\nAz AI döntési vagy döntéstámogató logikát szabályozza.\n\n" +
          "**„Komment összegzések kikapcsolása” / „Komment összegzések bekapcsolása” gomb:**\nA kommentekből épülő közösségi összegzéseket és rövid kivonatokat kezeli.\n\n" +
          "**„Ötlet panel frissítése” gomb:**\nÚjraépíti az ötlet rendszer paneljét és az aktuális állapotok szerint frissíti a gombokat.",
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
        .setLabel(boolButtonLabel(getState("ideas_comment_insights"), "Komment összegzések kikapcsolása", "Komment összegzések bekapcsolása"))
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
          `Új értékelések fogadása: ${yesNo(getState("adminfeedback_accept_new_reviews"))}`
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
          "**„Admin értékelések kikapcsolása” / „Admin értékelések bekapcsolása” gomb:**\nAz egész admin értékelési rendszer működését szabályozza.\n\n" +
          "**„AI összegzés kikapcsolása” / „AI összegzés bekapcsolása” gomb:**\nAz adminokról készített AI leírásokat és összegző szövegeket kezeli.\n\n" +
          "**„Értékelések lezárása” / „Értékelések megnyitása” gomb:**\nIdeiglenesen leállítja vagy újra engedi az új értékelések fogadását.\n\n" +
          "**„Admin értékelések nullázása” gomb:**\nLenullázza az élő admin értékelési adatokat és kitisztítja a logcsatornát, miközben az összesítő és az AI adatok megmaradnak.\n\n" +
          "**„Admin értékelési panel frissítése” gomb:**\nÚjraépíti az admin értékelési panel állapotát és gombjait.",
        inline: false
      }
    )
    .setFooter({ text: "internalGaming • Admin értékelési rendszer kezelése" })
    .setTimestamp(new Date());
}

function buildAdminFeedbackButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:toggle:adminfeedback_enabled")
        .setLabel(boolButtonLabel(getState("adminfeedback_enabled"), "Admin értékelések kikapcsolása", "Admin értékelések bekapcsolása"))
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
        .setLabel("Admin értékelések nullázása")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("systempanel:refresh:adminfeedback")
        .setLabel("Admin értékelési panel frissítése")
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
          `Ticket kérdőablak: ${yesNo(getState("tickets_allow_modal"))}`
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
          "**„Ticket rendszer kikapcsolása” / „Ticket rendszer bekapcsolása” gomb:**\nAz egész ticket rendszer működését vezérli.\n\n" +
          "**„Új ticket nyitás tiltása” / „Új ticket nyitás engedése” gomb:**\nCsak az új ticketek létrehozását tiltja vagy engedi.\n\n" +
          "**„Ticket kérdőablak kikapcsolása” / „Ticket kérdőablak bekapcsolása” gomb:**\nA ticket megnyitásakor felugró kérdőablakot kezeli.\n\n" +
          "**„Ticket panel frissítése” gomb:**\nÚjraépíti a ticket rendszer paneljét, hogy minden állapot és gombszöveg naprakész legyen.",
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
        .setLabel(boolButtonLabel(getState("tickets_allow_modal"), "Ticket kérdőablak kikapcsolása", "Ticket kérdőablak bekapcsolása"))
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
          `Naplózási rendszer: ${yesNo(getState("logs_enabled"))}`,
          `Napi statisztika: ${yesNo(getState("logs_daily_stats"))}`,
          `Üzenetnaplózás: ${yesNo(getState("logs_message"))}`,
          `Hangcsatorna naplózás: ${yesNo(getState("logs_voice"))}`,
          `Ticket naplózás: ${yesNo(getState("logs_ticket"))}`,
          `Moderációs naplózás: ${yesNo(getState("logs_moderation"))}`
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
          "**„Log rendszer kikapcsolása” / „Log rendszer bekapcsolása” gomb:**\nA teljes naplózási rendszert állítja le vagy indítja vissza.\n\n" +
          "**„Napi stat kikapcsolása” / „Napi stat bekapcsolása” gomb:**\nA hajnalban automatikusan küldött napi statisztikai jelentést kezeli.\n\n" +
          "**„Üzenet log kikapcsolása” / „Üzenet log bekapcsolása” gomb:**\nAz üzenetekhez kapcsolódó naplózást szabályozza.\n\n" +
          "**„Voice log kikapcsolása” / „Voice log bekapcsolása” gomb:**\nA hangcsatornás események naplózását kezeli.\n\n" +
          "**„Ticket log kikapcsolása” / „Ticket log bekapcsolása” gomb:**\nA ticket rendszerhez tartozó naplózást kapcsolja.\n\n" +
          "**„Moderációs log kikapcsolása” / „Moderációs log bekapcsolása” gomb:**\nA moderációs események naplózását szabályozza.\n\n" +
          "**„Kézi stat küldés” gomb:**\nAzonnali statküldést kérhetsz vele staff műveletként.\n\n" +
          "**„Log panel frissítése” gomb:**\nÚjraépíti a naplózási panel üzenetét, hogy a legfrissebb állapotok és gombfeliratok jelenjenek meg.",
        inline: false
      }
    )
    .setFooter({ text: "internalGaming • Naplózási és statisztikai rendszer kezelése" })
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
    .setDescription(`${interaction.user} módosított egy rendszerbeállítást vagy panelműveletet.`)
    .addFields(
      { name: "👤 Staff", value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
      { name: "⚙️ Művelet", value: String(label), inline: false },
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
    await logControlAction(interaction, "Összes rendszer leállítása", "Vegyes állapot", "Minden kikapcsolva");
  }

  if (action === "enableall") {
    for (const key of Object.keys(store.systems)) {
      store.systems[key] = true;
    }
    saveStore();
    await logControlAction(interaction, "Összes rendszer indítása", "Vegyes állapot", "Minden bekapcsolva");
  }

  if (action === "safe") {
    setState("aimod_enabled", true);
    setState("aimod_safe_mode", true);
    setState("aimod_allow_ban", false);
    setState("aimod_allow_kick", false);
    setState("aimod_allow_timeout", true);
    await logControlAction(interaction, "Safe mód", "Normál működés", "Biztonságos mód");
  }

  if (action === "refresh") {
    await logControlAction(interaction, "Panel frissítése", "Aktuális panel", "Frissítve");
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

  await logControlAction(
    interaction,
    `Beállítás módosítása: ${getSystemLabel(key)}`,
    yesNo(before),
    yesNo(after)
  );

  await refreshPanel(interaction.guild).catch(() => null);
  await interaction.deferUpdate().catch(() => null);
}

async function handleSystemRefresh(interaction, key) {
  const panelNames = {
    aimod: "AI panel frissítése",
    bugreport: "Bug panel frissítése",
    ideas: "Ötlet panel frissítése",
    adminfeedback: "Admin értékelési panel frissítése",
    tickets: "Ticket panel frissítése",
    logs: "Log panel frissítése"
  };

  await logControlAction(
    interaction,
    panelNames[key] || `Panel frissítése: ${key}`,
    "Aktuális panel",
    "Frissítve"
  );

  await refreshPanel(interaction.guild).catch(() => null);
  await interaction.deferUpdate().catch(() => null);
}

async function handleCustomAction(interaction, key) {
  if (key === "adminfeedback_reset") {
    const adminFeedback = require("./adminfeedback");
    await adminFeedback.resetData(interaction);
    await logControlAction(interaction, "Admin értékelések nullázása", "Aktív élő adatok", "Lenullázva");
    await refreshPanel(interaction.guild).catch(() => null);
    return;
  }

  if (key === "logs_send_stats") {
    interaction.client.emit("systempanel:sendManualStats", interaction);
    await logControlAction(interaction, "Kézi stat küldés", "Nincs küldés", "Statisztika küldése elindítva");
    await interaction.deferUpdate().catch(() => null);
    return;
  }

  await interaction.reply({
    content: "Ismeretlen panelművelet.",
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
        content: "A műveletnaplóhoz egy szöveges csatorna kell.",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await publishPanel(interaction.guild, panelChannel, actionLogChannel);

    await interaction.reply({
      content: `✅ A vezérlőpult elkészült ide: ${panelChannel}\n📝 Műveletnapló csatorna: ${actionLogChannel}`,
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
    const content = [
      `• ${getSystemLabel("aimod_enabled")}: ${yesNo(getState("aimod_enabled"))}`,
      `• ${getSystemLabel("bugreport_enabled")}: ${yesNo(getState("bugreport_enabled"))}`,
      `• ${getSystemLabel("ideas_enabled")}: ${yesNo(getState("ideas_enabled"))}`,
      `• ${getSystemLabel("adminfeedback_enabled")}: ${yesNo(getState("adminfeedback_enabled"))}`,
      `• ${getSystemLabel("tickets_enabled")}: ${yesNo(getState("tickets_enabled"))}`,
      `• ${getSystemLabel("logs_enabled")}: ${yesNo(getState("logs_enabled"))}`,
      `• ${getSystemLabel("logs_daily_stats")}: ${yesNo(getState("logs_daily_stats"))}`
    ].join("\n");

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