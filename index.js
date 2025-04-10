// FrostMod - An AutoMod Bot for Discord
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
const dotenv = require('dotenv');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

// Version and build info
const BOT_VERSION = '1.0.0';  // Change from beta versioning
const BOT_INFO = {
  name: 'FrostMod',
  version: BOT_VERSION,
  developer: 'Dakota'
};

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Bot setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildPresences,
  ],
});

// Register slash commands
const commands = [
  new SlashCommandBuilder().setName('welcome')
    .setDescription('Set the welcome channel where new members will be greeted.')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel where the welcome message will be sent')
        .setRequired(true)),

  new SlashCommandBuilder().setName('wmessage')
    .setDescription('Set the welcome message for new members.')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The welcome message (use {user} and {memberCount} for placeholders)')
        .setRequired(true)),

  new SlashCommandBuilder().setName('joinrole')
    .setDescription('Set the auto-role that new members receive.')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('The role to assign to new members')
        .setRequired(true)),

  new SlashCommandBuilder().setName('ignorelinks')
    .setDescription('Set a channel where invite links are ignored by the filter.')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to ignore the link filter')
        .setRequired(true)),

  new SlashCommandBuilder().setName('filter')
    .setDescription('Set the curse word filter level.')
    .addStringOption(option =>
      option.setName('level')
        .setDescription('The filter level: light, moderate, strict')
        .setRequired(true)
        .addChoices(
          { name: 'Light', value: 'light' },
          { name: 'Moderate', value: 'moderate' },
          { name: 'Strict', value: 'strict' }
        )),

  new SlashCommandBuilder().setName('help')
    .setDescription('Displays the help menu with available commands'),

  new SlashCommandBuilder().setName('warn')
    .setDescription('Warn a user.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to warn')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('The reason for the warning')
        .setRequired(true)),

  new SlashCommandBuilder().setName('logs')
    .setDescription('Set the channel for warning logs.')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to send logs')
        .setRequired(true)),

  new SlashCommandBuilder().setName('status')
    .setDescription('Shows the bot\'s current status, ping, and uptime'),
].map(command => command.toJSON());

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
    console.error('Failed to reload slash commands:', error);
  }
})();

// Bot ready
client.once('ready', () => {
  console.log(`${client.user.tag} is logged in and ready!`);

  client.user.setPresence({
    activities: [{
      name: `FrostMod v${BOT_VERSION}`,  // Remove any beta indicators
      type: 0,
    }],
    status: 'online',
  });
});

// Member join and leave events
client.on('guildMemberAdd', async (member) => {
  const guildId = member.guild.id;
  const serverName = member.guild.name;

  try {
    const { data: settings, error } = await supabase
      .from('server_settings')
      .select('*')
      .eq('guild_id', guildId)
      .single();

    if (error || !settings) return;

    // Welcome message
    if (settings.welcome_channel_id && settings.welcome_message) {
      const channel = await member.guild.channels.fetch(settings.welcome_channel_id).catch(() => null);
      if (channel) {
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
    }

    // Auto-role
    if (settings.auto_role_id) {
      const role = member.guild.roles.cache.get(settings.auto_role_id);
      if (role) {
        await member.roles.add(role).catch(console.error);
      }
    }

    // Track join in database
    await supabase.from('member_joins').insert({
      guild_id: guildId,
      user_id: member.user.id,
      username: member.user.tag,
      server_name: serverName
    });

    // Log the user join
    const logsChannel = await getLogsChannel(guildId);
    if (logsChannel) {
      const joinEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('User Joined')
        .setDescription(`${member.user.tag} has joined the server.`)
        .setTimestamp();
      await logsChannel.send({ embeds: [joinEmbed] });
    }
  } catch (error) {
    console.error('Error handling member join:', error);
  }
});

client.on('guildMemberRemove', async (member) => {
  const guildId = member.guild.id;

  try {
    // Track leave in database
    await supabase.from('member_leaves').insert({
      guild_id: guildId,
      user_id: member.user.id,
      username: member.user.tag,
    });

    // Log the user leave
    const logsChannel = await getLogsChannel(guildId);
    if (logsChannel) {
      const leaveEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('User Left')
        .setDescription(`${member.user.tag} has left the server.`)
        .setTimestamp();
      await logsChannel.send({ embeds: [leaveEmbed] });
    }
  } catch (error) {
    console.error('Error handling member leave:', error);
  }
});

// Channel creation and deletion
client.on('channelCreate', async (channel) => {
  const guildId = channel.guild.id;

  try {
    const logsChannel = await getLogsChannel(guildId);
    if (logsChannel) {
      const channelCreateEmbed = new EmbedBuilder()
        .setColor('#3498db')
        .setTitle('Channel Created')
        .setDescription(`Channel #${channel.name} has been created.`)
        .setTimestamp();
      await logsChannel.send({ embeds: [channelCreateEmbed] });
    }
  } catch (error) {
    console.error('Error logging channel creation:', error);
  }
});

client.on('channelDelete', async (channel) => {
  const guildId = channel.guild.id;

  try {
    const logsChannel = await getLogsChannel(guildId);
    if (logsChannel) {
      const channelDeleteEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('Channel Deleted')
        .setDescription(`Channel #${channel.name} has been deleted.`)
        .setTimestamp();
      await logsChannel.send({ embeds: [channelDeleteEmbed] });
    }
  } catch (error) {
    console.error('Error logging channel deletion:', error);
  }
});

// Slash commands handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, guild } = interaction;

  try {
    if (commandName === 'welcome') {
      const channel = interaction.options.getChannel('channel');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, welcome_channel_id: channel.id }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Welcome channel set to ${channel}.`);
    }

    if (commandName === 'wmessage') {
      const message = interaction.options.getString('message');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, welcome_message: message }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Welcome message set: "${message}"`);
    }

    if (commandName === 'joinrole') {
      const role = interaction.options.getRole('role');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, auto_role_id: role.id }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ New members will be assigned ${role}.`);
    }

    if (commandName === 'ignorelinks') {
      const channel = interaction.options.getChannel('channel');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, ignored_channel_id: channel.id }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Invite links will be ignored in ${channel}.`);
    }

    if (commandName === 'filter') {
      const filterLevel = interaction.options.getString('level');
      await supabase
        .from('filtering_settings')
        .upsert({ guild_id: guild.id, filter_level: filterLevel }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Filter level set to ${filterLevel}.`);
    }

    if (commandName === 'warn') {
      const targetUser = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const logsChannel = await getLogsChannel(guild.id);

      if (!logsChannel) {
        await interaction.reply('⚠️ No logs channel set. Please set a logs channel using `/logs` command.');
        return;
      }

      // Add the "Warned by: username" format
      const warnedBy = `Warned by: ${interaction.user.tag}`;

      // Send the warning message to the logs channel
      const warningEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('User Warned')
        .setDescription(`${targetUser.tag} was warned.`)
        .addFields(
          { name: 'Reason', value: reason },
          { name: 'Warned by', value: warnedBy }
        )
        .setTimestamp();

      await logsChannel.send({ embeds: [warningEmbed] });

      // Save the warning to Supabase
      await supabase.from('user_warns').insert([{
        guild_id: guild.id,
        user_id: targetUser.id,
        username: targetUser.tag,
        reason: reason,
        warned_by: warnedBy, // Store the "Warned by: username"
        timestamp: new Date().toISOString(),
      }]);


      await interaction.reply(`✅ ${targetUser.tag} has been warned for: ${reason}`);
    }

    if (commandName === 'logs') {
      const channel = interaction.options.getChannel('channel');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, logs_channel_id: channel.id }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Logs channel set to ${channel}.`);
    }

    if (commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('FrostMod Commands')
        .setDescription('A moderation bot with welcome messages and invite link filtering.')
        .addFields(
          { name: '🛠️ `/welcome`', value: 'Set the welcome channel for new members.' },
          { name: '💬 `/wmessage`', value: 'Set the welcome message (supports `{user}` and `{memberCount}`).' },
          { name: '🧑‍🤝‍🧑 `/joinrole`', value: 'Set an auto-role for new members.' },
          { name: '🔒 `/ignorelinks`', value: 'Allow invite links in a specific channel.' },
          { name: '🚫 `/filter`', value: 'Set the curse word filter level (light, moderate, strict).' },
          { name: '⚠️ `/warn`', value: 'Warn a user for inappropriate behavior.' },
          { name: '📜 `/logs`', value: 'Set the logs channel for user warnings.' },
          { name: '📊 `/status`', value: 'Shows bot\'s current status, ping, and uptime.' }
        );
      await interaction.reply({ embeds: [helpEmbed] });
    }

    if (commandName === 'status') {
      const ping = client.ws.ping;
      const uptime = Math.floor(client.uptime / 1000); // Convert to seconds

      // Calculate readable uptime
      const days = Math.floor(uptime / 86400);
      const hours = Math.floor((uptime % 86400) / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;

      const uptimeString = [
        days ? `${days}d` : '',
        hours ? `${hours}h` : '',
        minutes ? `${minutes}m` : '',
        `${seconds}s`
      ].filter(Boolean).join(' ');

      const statusEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('🤖 Bot Status')
        .addFields(
          { name: '📡 Ping', value: `${ping}ms`, inline: true },
          { name: '⏰ Uptime', value: uptimeString, inline: true },
          { name: '🔌 Connection', value: client.ws.status === 0 ? 'Connected' : 'Reconnecting', inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [statusEmbed] });
    }
  } catch (error) {
    console.error('Error handling slash command:', error);
    await interaction.reply('❌ An error occurred while processing your command.');
  }
});

// Helper function to get logs channel from DB
async function getLogsChannel(guildId) {
  const { data, error } = await supabase
    .from('server_settings')
    .select('logs_channel_id')
    .eq('guild_id', guildId)
    .single();

  if (error || !data || !data.logs_channel_id) return null;

  const channel = await client.channels.fetch(data.logs_channel_id).catch(() => null);
  return channel;
}

// Log in the bot
client.login(process.env.DISCORD_TOKEN);
