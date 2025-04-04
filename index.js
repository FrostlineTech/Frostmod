// index.js
// FrostMod - An AutoMod Bot for Discord
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const dotenv = require('dotenv');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Bot setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers, // Needed for member joins
    GatewayIntentBits.MessageContent,
  ],
});

// Register slash commands
const commands = [
  new SlashCommandBuilder().setName('welcome')
    .setDescription('Set the welcome channel where new members will be greeted.')
    .addStringOption(option =>
      option.setName('channel')
        .setDescription('The ID of the channel where the welcome message will be sent')
        .setRequired(true)),

  new SlashCommandBuilder().setName('wmessage')
    .setDescription('Set the welcome message for new members.')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The welcome message')
        .setRequired(true)),

  new SlashCommandBuilder().setName('joinrole')
    .setDescription('Set the auto-role that new members receive.')
    .addStringOption(option =>
      option.setName('role')
        .setDescription('The ID of the role to assign')
        .setRequired(true)),

  new SlashCommandBuilder().setName('help')
    .setDescription('Displays the help menu with available commands'),
]
  .map(command => command.toJSON());

const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_TOKEN);

// Register commands
(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

// Bot ready
client.once('ready', () => {
  console.log(`${client.user.tag} is logged in and ready!`);

  // Update presence (status message) when the bot is online
  client.user.setPresence({
    activities: [
      {
        name: 'Competing in VS Code | Level 100',
        type: 0, // Type 0 is "Playing"
        details: 'Coding under pressure...',
        state: 'Competitively coding in VS Code',
        startTimestamp: Date.now(), // Start at the current time
        endTimestamp: Date.now() + 10000000, // Optional end time for a set period
        largeImageKey: 'vs-code', // Image key for VS Code icon (you would need to upload this image to Discord)
        smallImageKey: 'coding', // Image key for a coding-related icon (you would need to upload this image to Discord)
        largeImageText: 'VS Code',
        smallImageText: 'Competitive Coding',
      },
    ],
    status: 'online', // Bot status (online, idle, dnd, invisible)
  });
});

// Member join event
client.on('guildMemberAdd', async (member) => {
  const guildId = member.guild.id;

  // Get settings
  const { data: settings, error } = await supabase
    .from('server_settings')
    .select('*')
    .eq('guild_id', guildId)
    .single();

  if (error || !settings) return;

  // Send welcome message
  const channel = await member.guild.channels.fetch(settings.welcome_channel_id).catch(() => null);
  if (channel && settings.welcome_message) {
    const personalizedMessage = settings.welcome_message
      .replace('{user}', member.user.tag)
      .replace('{memberCount}', member.guild.memberCount);

    const embed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle('🎉 Welcome!')
      .setDescription(personalizedMessage)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: `Member #${member.guild.memberCount}` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  }

  // Auto-role
  if (settings.auto_role_id) {
    const role = member.guild.roles.cache.get(settings.auto_role_id);
    if (role) {
      await member.roles.add(role).catch(console.error);
    }
  }

  // Track join
  await supabase.from('member_joins').insert({
    guild_id: guildId,
    user_id: member.user.id,
    username: member.user.tag,
  });
});

// Slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'welcome') {
    const channelId = interaction.options.getString('channel');
    const guildId = interaction.guild.id;

    const { error } = await supabase
      .from('server_settings')
      .upsert({
        guild_id: guildId,
        welcome_channel_id: channelId,
      }, { onConflict: ['guild_id'] });

    if (error) {
      return interaction.reply('❌ Error saving welcome channel.');
    }

    await interaction.reply(`✅ Welcome channel set to <#${channelId}>.`);
  }

  if (commandName === 'wmessage') {
    const message = interaction.options.getString('message');
    const guildId = interaction.guild.id;

    const { error } = await supabase
      .from('server_settings')
      .upsert({
        guild_id: guildId,
        welcome_message: message,
      }, { onConflict: ['guild_id'] });

    if (error) {
      return interaction.reply('❌ Error saving welcome message.');
    }

    await interaction.reply(`✅ Welcome message set: "${message}"`);
  }

  if (commandName === 'joinrole') {
    const roleId = interaction.options.getString('role');
    const guildId = interaction.guild.id;

    const { error } = await supabase
      .from('server_settings')
      .upsert({
        guild_id: guildId,
        auto_role_id: roleId,
      }, { onConflict: ['guild_id'] });

    if (error) {
      return interaction.reply('❌ Error saving auto-role.');
    }

    await interaction.reply(`✅ New members will be assigned <@&${roleId}>.`);
  }

  if (commandName === 'help') {
    const helpMessage = `
**FrostMod Commands:**

> 🛠️ **/welcome [channel ID]**
Sets the welcome channel for new member messages.
Example: \`/welcome 123456789123456789\`

> 💬 **/wmessage [message]**
Sets the welcome message sent when someone joins.
Supports:
- \`{user}\` → Member tag
- \`{memberCount}\` → Server member count
Example: \`/wmessage Welcome, {user}! You are member #{memberCount}!\`

> 🧑‍🤝‍🧑 **/joinrole [role ID]**
Automatically assigns a role to new members.
Example: \`/joinrole 123456789012345678\`

> 📖 **/help**
Shows this help menu.
    `;
    await interaction.reply(helpMessage);
  }
});

// Login
client.login(process.env.DISCORD_TOKEN);
