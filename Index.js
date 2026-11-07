require("dotenv").config();
const { Client } = require("discord.js-selfbot-v13");
const { GoogleGenAI } = require("@google/genai");

const TOKEN = process.env.TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PREFIX = ".";

if (!TOKEN) {
  console.error("No TOKEN in .env");
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error("No GEMINI_API_KEY in .env");
  process.exit(1);
}

// Initialize Gemini client using the recommended @google/genai SDK
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const client = new Client({ checkUpdate: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

client.on("ready", () => {
  console.log("Logged in as " + client.user.tag);
  console.log("Prefix: " + PREFIX);
  console.log("Commands: .clone <sourceId> | .help | .id | .servers");
});

client.on("messageCreate", async (message) => {
  // auto-reply when someone mentions you
  if (
    message.author.id !== client.user.id &&
    !message.author.bot &&
    message.mentions.has(client.user.id)
  ) {
    // Strip out the mention tag so Gemini gets clean text
    const cleanContent = message.content.replace(/<@!?\d+>/g, "").trim();
    
    try {
      // Show typing indicator while Gemini generates a response
      if (message.channel && typeof message.channel.sendTyping === "function") {
        await message.channel.sendTyping();
      }

      // Generate context-aware reply using Gemini 2.5 Flash
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: cleanContent || "Hello!",
        config: {
          systemInstruction: "You are acting as a casual human on Discord. Keep your responses short, natural, informal, lowercase-friendly, and concise like a real chat message (1-2 sentences max). You are currently away/busy.",
        },
      });

      const replyText = response.text ? response.text.trim() : "afk right now";
      await message.reply(replyText);
    } catch (err) {
      console.error("Gemini AI error:", err.message);
      // Fallback response if API fails
      try {
        await message.reply("busy rn, text later");
      } catch {}
    }
    return;
  }

  if (message.author.id !== client.user.id) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  try {
    if (command === "help") {
      await message.edit(
        "```\n" +
          ".clone <sourceServerId>  - clone that server INTO this server\n" +
          ".id                      - show this server + channel id\n" +
          ".servers                 - list your servers\n" +
          ".help                    - this\n" +
          "```"
      );
      return;
    }

    if (command === "id") {
      await message.edit(
        "```\nServer: " +
          (message.guild ? message.guild.id : "DM") +
          "\nChannel: " +
          message.channel.id +
          "\nUser: " +
          client.user.id +
          "\n```"
      );
      return;
    }

    if (command === "servers") {
      const list =
        client.guilds.cache
          .map((g) => g.name + " | " + g.id)
          .join("\n") || "none";
      await message.edit("```\n" + list.slice(0, 1900) + "\n```");
      return;
    }

    if (command === "clone") {
      const sourceId = args[0];
      if (!sourceId) {
        await message.edit("Usage: .clone <sourceServerId>");
        return;
      }

      if (!message.guild) {
        await message.edit("Run this inside the target server.");
        return;
      }

      const source = client.guilds.cache.get(sourceId);
      if (!source) {
        await message.edit("Source server not found. Join it first.");
        return;
      }

      const target = message.guild;

      await message.edit(
        "Cloning **" + source.name + "** → **" + target.name + "**..."
      );

      await message.edit("Clearing channels & roles...");
      for (const ch of Array.from(target.channels.cache.values())) {
        try {
          await ch.delete();
          await sleep(300);
        } catch {}
      }
      for (const role of Array.from(target.roles.cache.values())) {
        if (role.managed || role.id === target.id) continue;
        try {
          await role.delete();
          await sleep(300);
        } catch {}
      }

      await message.edit("Cloning roles...");
      const roleMap = new Map();
      const roles = Array.from(source.roles.cache.values())
        .filter((r) => r.id !== source.id)
        .sort((a, b) => a.position - b.position);

      for (const role of roles) {
        try {
          const newRole = await target.roles.create({
            name: role.name,
            color: role.color,
            hoist: role.hoist,
            permissions: role.permissions,
            mentionable: role.mentionable,
          });
          roleMap.set(role.id, newRole);
          await sleep(400);
        } catch (e) {
          console.log("role fail:", role.name, e.message);
        }
      }

      await message.edit("Cloning categories...");
      const channelMap = new Map();
      const categories = Array.from(source.channels.cache.values())
        .filter((c) => c.type === "GUILD_CATEGORY")
        .sort((a, b) => a.position - b.position);

      for (const cat of categories) {
        try {
          const overwrites = Array.from(
            cat.permissionOverwrites.cache.values()
          ).map((ow) => ({
            id:
              ow.id === source.id
                ? target.id
                : roleMap.has(ow.id)
                ? roleMap.get(ow.id).id
                : ow.id,
            allow: ow.allow,
            deny: ow.deny,
            type: ow.type,
          }));

          const newCat = await target.channels.create(cat.name, {
            type: "GUILD_CATEGORY",
            position: cat.position,
            permissionOverwrites: overwrites,
          });
          channelMap.set(cat.id, newCat);
          await sleep(500);
        } catch (e) {
          console.log("cat fail:", cat.name, e.message);
        }
      }

      await message.edit("Cloning channels...");
      const channels = Array.from(source.channels.cache.values())
        .filter((c) => c.type !== "GUILD_CATEGORY")
        .sort((a, b) => a.position - b.position);

      for (const ch of channels) {
        try {
          const parent =
            ch.parentId && channelMap.has(ch.parentId)
              ? channelMap.get(ch.parentId).id
              : null;

          const overwrites = Array.from(
            ch.permissionOverwrites.cache.values()
          ).map((ow) => ({
            id:
              ow.id === source.id
                ? target.id
                : roleMap.has(ow.id)
                ? roleMap.get(ow.id).id
                : ow.id,
            allow: ow.allow,
            deny: ow.deny,
            type: ow.type,
          }));

          const newCh = await target.channels.create(ch.name, {
            type: ch.type,
            parent: parent,
            position: ch.position,
            permissionOverwrites: overwrites,
            topic: ch.topic || undefined,
            nsfw: !!ch.nsfw,
            rateLimitPerUser: ch.rateLimitPerUser || 0,
            bitrate: ch.bitrate,
            userLimit: ch.userLimit,
          });
          channelMap.set(ch.id, newCh);
          await sleep(500);
        } catch (e) {
          console.log("chan fail:", ch.name, e.message);
        }
      }

      await message.edit("Cloning emojis...");
      for (const emoji of Array.from(source.emojis.cache.values())) {
        try {
          await target.emojis.create(emoji.url, emoji.name);
          await sleep(800);
        } catch (e) {
          console.log("emoji fail:", emoji.name, e.message);
        }
      }

      try {
        await target.setName(source.name);
        if (source.iconURL()) {
          await target.setIcon(
            source.iconURL({ format: "png", size: 1024 })
          );
        }
        await target.setVerificationLevel(source.verificationLevel);
        await target.setDefaultMessageNotifications(
          source.defaultMessageNotifications
        );
        await target.setExplicitContentFilter(source.explicitContentFilter);
      } catch (e) {
        console.log("settings fail:", e.message);
      }

      await message.edit(
        "Done.\nSource: " +
          source.name +
          " (" +
          source.id +
          ")\nTarget: " +
          target.name +
          " (" +
          target.id +
          ")"
      );
      console.log("Clone finished:", source.id, "->", target.id);
    }
  } catch (err) {
    console.error(err);
    try {
      await message.edit("Error: " + err.message);
    } catch {}
  }
});

client.login(TOKEN).catch((e) => {
  console.error("Login failed:", e.message);
  process.exit(1);
});

