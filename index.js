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
    .setDescription('Check the bot\'s uptime and ping.'),

  new SlashCommandBuilder().setName('mutedrole')
    .setDescription('Set the muted role to be assigned to muted users.')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('The role to assign to muted users')
        .setRequired(true)),

  // New mute command
  new SlashCommandBuilder().setName('mute')
    .setDescription('Mute a user to prevent them from sending messages.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to mute')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('The reason for muting')
        .setRequired(false))
    .addIntegerOption(option =>
      option.setName('duration')
        .setDescription('Duration of mute in minutes (0 for permanent)')
        .setRequired(false)),
].map(command => command.toJSON());

const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_TOKEN);

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

client.once('ready', () => {
  console.log(`${client.user.tag} is logged in and ready!`);

  client.user.setPresence({
    activities: [{
      name: 'FrostMod - Developed by Dakota',
      type: 0,
    }],
    status: 'online',
  });
});

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

    if (settings.auto_role_id) {
      const role = member.guild.roles.cache.get(settings.auto_role_id);
      if (role) {
        await member.roles.add(role).catch(console.error);
      }
    }

    await supabase.from('member_joins').insert({
      guild_id: guildId,
      user_id: member.user.id,
      username: member.user.tag,
      server_name: serverName
    });

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
    await supabase.from('member_leaves').insert({
      guild_id: guildId,
      user_id: member.user.id,
      username: member.user.tag,
    });

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

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, guild, options } = interaction;

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

      const warnedBy = `Warned by: ${interaction.user.tag}`;

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

      await supabase.from('user_warns').insert([{
        guild_id: guild.id,
        user_id: targetUser.id,
        username: targetUser.tag,
        reason: reason,
        warned_by: warnedBy,
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
          { name: '📊 `/status`', value: 'Check the bot\'s uptime and ping.' },
          { name: '🔇 `/mute`', value: 'Mute a user to prevent them from sending messages.' },
          { name: '🔕 `/mutedrole`', value: 'Set the muted role that will be assigned to muted users.' }
        );
      await interaction.reply({ embeds: [helpEmbed] });
    }

    if (commandName === 'status') {
      const uptimeMs = client.uptime;
      const uptimeSeconds = Math.floor(uptimeMs / 1000) % 60;
      const uptimeMinutes = Math.floor(uptimeMs / (1000 * 60)) % 60;
      const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60)) % 24;
      const uptimeDays = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));

      const uptimeString = `${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`;

      const embed = new EmbedBuilder()
        .setColor('#00BFFF')
        .setTitle('📊 Bot Status')
        .addFields(
          { name: '🕒 Uptime', value: uptimeString, inline: true },
          { name: '📡 Ping', value: `${client.ws.ping}ms`, inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'mutedrole') {
      const role = interaction.options.getRole('role');
      await supabase
        .from('server_settings')
        .upsert({ guild_id: guild.id, muted_role_id: role.id }, { onConflict: ['guild_id'] });
      await interaction.reply(`✅ Muted role set to ${role}.`);
    }

    if (commandName === 'mute') {
      // Check if user has permission to mute members
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({ content: '❌ You do not have permission to mute members.', ephemeral: true });
      }

      const user = options.getUser('user');
      const reason = options.getString('reason') || 'No reason provided';
      const duration = options.getInteger('duration') || 0; // 0 means permanent mute

      // Get the muted role from database
      const { data: settings, error: settingsError } = await supabase
        .from('server_settings')
        .select('muted_role_id')
        .eq('guild_id', guild.id)
        .single();

      if (settingsError || !settings || !settings.muted_role_id) {
        return interaction.reply({ content: '❌ Muted role is not set up. Please set a muted role first with `/mutedrole`.', ephemeral: true });
      }

      const mutedRole = guild.roles.cache.get(settings.muted_role_id);
      if (!mutedRole) {
        return interaction.reply({ content: '❌ Muted role not found. Please set a new muted role with `/mutedrole`.', ephemeral: true });
      }

      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
      }

      // Check if user is already muted
      if (member.roles.cache.has(mutedRole.id)) {
        return interaction.reply({ content: '❌ This user is already muted.', ephemeral: true });
      }

      // Add muted role to user
      try {
        await member.roles.add(mutedRole);

        // Save mute to database
        const { error: muteError } = await supabase
          .from('muted_roles')
          .insert({
            guild_id: guild.id,
            user_id: user.id,
            username: user.tag,
            muted_by: interaction.user.tag,
            reason: reason,
            duration: duration,
            muted_at: new Date().toISOString(),
            expires_at: duration > 0 ? new Date(Date.now() + duration * 60000).toISOString() : null
          });

        if (muteError) {
          console.error('Error saving mute to database:', muteError);
          return interaction.reply({ content: '❌ Failed to save mute to database.', ephemeral: true });
        }

        // Send confirmation message
        const muteEmbed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('User Muted')
          .setDescription(`${user.tag} has been muted.`)
          .addFields(
            { name: 'Reason', value: reason, inline: true },
            { name: 'Duration', value: duration > 0 ? `${duration} minutes` : 'Permanent', inline: true },
            { name: 'Moderator', value: interaction.user.tag, inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [muteEmbed] });

        // Log the mute action
        const logsChannel = await getLogsChannel(guild.id);
        if (logsChannel) {
          await logsChannel.send({ embeds: [muteEmbed] });
        }

        // If temporary mute, set timeout to unmute
        if (duration > 0) {
          setTimeout(async () => {
            try {
              // Check if user is still in the server
              const currentMember = await guild.members.fetch(user.id).catch(() => null);
              if (currentMember && currentMember.roles.cache.has(mutedRole.id)) {
                await currentMember.roles.remove(mutedRole);
                
                // Update database
                await supabase
                  .from('muted_roles')
                  .update({ unmuted_at: new Date().toISOString(), expired: true })
                  .eq('guild_id', guild.id)
                  .eq('user_id', user.id)
                  .order('muted_at', { ascending: false })
                  .limit(1);

                // Send unmute notification
                const unmuteEmbed = new EmbedBuilder()
                  .setColor('#00FF00')
                  .setTitle('User Automatically Unmuted')
                  .setDescription(`${user.tag} has been automatically unmuted after ${duration} minutes.`)
                  .setTimestamp();

                if (logsChannel) {
                  await logsChannel.send({ embeds: [unmuteEmbed] });
                }
              }
            } catch (error) {
              console.error('Error auto-unmuting user:', error);
            }
          }, duration * 60000);
        }

      } catch (error) {
        console.error('Error muting user:', error);
        await interaction.reply({ content: '❌ Failed to mute user. Please check bot permissions.', ephemeral: true });
      }
    }

  } catch (error) {
    console.error('Error handling slash command:', error);
    await interaction.reply('❌ An error occurred while processing your command.').catch(() => {});
  }
});

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

client.login(process.env.DISCORD_TOKEN);