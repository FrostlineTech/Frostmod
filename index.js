// FrostMod - An AutoMod Bot for Discord
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
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
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
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

  new SlashCommandBuilder().setName('help')
    .setDescription('Displays the help menu with available commands'),
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
      name: 'Join My server',
      url: 'https://discord.gg/BjbUXwFF6n', // Make the URL clickable
      type: 0, // The type of activity (0 is for "Playing")
    }],
    status: 'online',
  });
});

// Member join event (Updated with server_name)
client.on('guildMemberAdd', async (member) => {
  const guildId = member.guild.id;
  const serverName = member.guild.name; // Get server name

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

    // Track join in database (Now with server_name)
    await supabase.from('member_joins').insert({
      guild_id: guildId,
      user_id: member.user.id,
      username: member.user.tag,
      server_name: serverName // Added server name
    });
  } catch (error) {
    console.error('Error handling member join:', error);
  }
});

// Slash commands (Unchanged)
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
        );
      await interaction.reply({ embeds: [helpEmbed] });
    }
  } catch (error) {
    console.error('Error handling slash command:', error);
    await interaction.reply('❌ An error occurred while processing your command.').catch(() => {});
  }
});

// Invite link filter (Unchanged)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const discordInviteRegex = /(https?:\/\/)?(www\.)?(discord\.gg|discordapp\.com\/invite)\/\S+/gi;

  try {
    const { data: settings } = await supabase
      .from('server_settings')
      .select('*')
      .eq('guild_id', message.guild.id)
      .single();

    if (!settings || message.channel.id === settings.ignored_channel_id) return;

    if (discordInviteRegex.test(message.content)) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const warning = await message.channel.send({
          content: `${message.author}, ❌ Invite links are not allowed here!`,
        });
        await message.delete().catch(() => {});
        setTimeout(() => warning.delete().catch(() => {}), 5000);
      }
    }
  } catch (error) {
    console.error('Error filtering invite links:', error);
  }
});

// Login
client.login(process.env.DISCORD_TOKEN).catch(console.error);
