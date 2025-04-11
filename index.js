// FrostMod - An AutoMod Bot for Discord
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  PermissionsBitField 
} = require('discord.js');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { createClient } = require('@supabase/supabase-js');
const { HfInference } = require('@huggingface/inference');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Hugging Face client
const hf = new HfInference(process.env.HUGGING_FACE_TOKEN);

// Initialize Discord client with proper intents
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Version and build info
const BOT_VERSION = '1.0.0';
const BOT_INFO = {
  name: 'FrostMod',
  version: BOT_VERSION,
  developer: 'Dakota'
};

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

  new SlashCommandBuilder().setName('status')
    .setDescription('Shows the bot\'s current status, ping, and uptime'),
  new SlashCommandBuilder()
    .setName('analyze')
    .setDescription('Analyze a message for toxicity and sentiment')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The message to analyze')
        .setRequired(true)),
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
async function generateWelcomeMessage(username, guildName) {
  const prompt = `Generate a warm welcome message for ${username} who just joined the server ${guildName}. Keep it friendly and brief.`;
  
  try {
    const response = await analyzeText(prompt, 'generate');
    return response[0].generated_text;
  } catch (error) {
    return `Welcome to ${guildName}, ${username}! 👋`;
  }
}

client.on('guildMemberAdd', async (member) => {
  const { data: settings } = await supabase
    .from('server_settings')
    .select('welcome_channel_id, welcome_message, auto_role_id')  // Added auto_role_id
    .eq('guild_id', member.guild.id)
    .single();

  // Auto-role assignment
  if (settings?.auto_role_id) {
    try {
      const role = member.guild.roles.cache.get(settings.auto_role_id);
      if (role) {
        await member.roles.add(role);
        console.log(`Assigned role ${role.name} to new member ${member.user.tag}`);
      }
    } catch (error) {
      console.error(`Failed to assign auto-role to ${member.user.tag}:`, error);
    }
  }

  // Existing welcome message logic
  if (!settings?.welcome_channel_id) return;

  const welcomeChannel = member.guild.channels.cache.get(settings.welcome_channel_id);
  if (!welcomeChannel) return;

  const customMessage = await generateWelcomeMessage(member.user.username, member.guild.name);
  
  const welcomeEmbed = new EmbedBuilder()
    .setColor('#00FF00')
    .setTitle('Welcome!')
    .setDescription(customMessage)
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();

  await welcomeChannel.send({ embeds: [welcomeEmbed] });
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

    if (commandName === 'analyze') {
      const message = interaction.options.getString('message');
      await interaction.deferReply();
      
      try {
        const [toxicityResult, sentimentResult] = await Promise.all([
          analyzeText(message, 'toxicity'),
          analyzeText(message, 'sentiment')
        ]);

        const analysisEmbed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('Message Analysis')
          .setDescription(`Analyzed message: ${message}`)
          .addFields(
            { name: 'Toxicity Score', value: `${(toxicityResult[0].score * 100).toFixed(2)}%`, inline: true },
            { name: 'Primary Emotion', value: sentimentResult[0].label, inline: true }
          )
          .setFooter({ text: 'Powered by Hugging Face AI' });
          
        await interaction.editReply({ embeds: [analysisEmbed] });
      } catch (error) {
        await interaction.editReply('❌ Failed to analyze message.');
      }
    }

    if (commandName === 'smartwarn') {
      const targetUser = interaction.options.getUser('user');
      const message = interaction.options.getString('message');
      
      await interaction.deferReply({ ephemeral: true });
      
      const analysis = await analyzeViolation(message);
      
      if (!analysis) {
        await interaction.editReply('❌ Failed to analyze message.');
        return;
      }

      const warningEmbed = new EmbedBuilder()
        .setColor(analysis.severity === 'HIGH' ? '#FF0000' : '#FFA500')
        .setTitle('Smart Warning Analysis')
        .setDescription(`Target User: ${targetUser.tag}`)
        .addFields(
          { name: 'Message', value: message },
          { name: 'Analysis', value: analysis.reason },
          { name: 'Recommended Action', value: analysis.shouldWarn ? '⚠️ Issue Warning' : '✅ No Action Needed' }
        );

      await interaction.editReply({ embeds: [warningEmbed] });
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

// Add these constants for models
const MODELS = {
  TOXICITY: 'facebook/roberta-hate-speech-dynabench-r4-target',
  TEXT_GENERATION: 'google/flan-t5-small', // Changed from bloomz to a smaller model
  SENTIMENT: 'SamLowe/roberta-base-go_emotions',
  CLASSIFICATION: 'facebook/bart-large-mnli'
};

// Define classification labels
const CLASSIFICATION_LABELS = [
  'harassment',
  'hate speech',
  'offensive language',
  'threatening',
  'safe content'
];

// Add helper functions
async function analyzeText(text, task = 'classification') {
  if (!text || text.trim().length === 0) {
    console.error('Empty text provided for analysis');
    return null;
  }

  try {
    switch (task) {
      case 'generate':
        return await hf.textGeneration({
          model: MODELS.TEXT_GENERATION,
          inputs: text.slice(0, 500),
          parameters: {
            max_length: 100,
            temperature: 0.7,
            top_p: 0.9,
            do_sample: true
          }
        });
      case 'toxicity':
        return await hf.textClassification({
          model: MODELS.TOXICITY,
          inputs: text.slice(0, 500)
        });
      case 'sentiment':
        return await hf.textClassification({
          model: MODELS.SENTIMENT,
          inputs: text.slice(0, 500)
        });
      case 'classification':
        // Let's simplify this to just use text classification instead of zero-shot
        return await hf.textClassification({
          model: MODELS.TOXICITY, // Using the same toxicity model
          inputs: text.slice(0, 500)
        });
      default:
        return null;
    }
  } catch (error) {
    console.error(`AI Analysis Error (${task}):`, error);
    return null;
  }
}

// Simple cache for recent analyses
const analysisCache = new Map();
const CACHE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

async function analyzeViolation(message) {
  const cacheKey = message.trim().toLowerCase();
  if (analysisCache.has(cacheKey)) {
    return analysisCache.get(cacheKey);
  }

  try {
    const [toxicity, classification] = await Promise.all([
      analyzeText(message, 'toxicity'),
      analyzeText(message, 'classification')
    ]);

    if (!toxicity || !classification) {
      return null;
    }

    const toxicityScore = toxicity[0].score;
    
    let result;
    if (toxicityScore > 0.8) {
      result = {
        shouldWarn: true,
        reason: `Severe toxicity detected (${(toxicityScore * 100).toFixed(2)}%)`,
        severity: 'HIGH',
        score: toxicityScore
      };
    } else if (toxicityScore > 0.6) {
      result = {
        shouldWarn: true,
        reason: `High toxicity content (${(toxicityScore * 100).toFixed(2)}%)`,
        severity: 'MEDIUM',
        score: toxicityScore
      };
    } else if (toxicityScore > 0.4) {
      result = {
        shouldWarn: true,
        reason: `Moderate toxicity content (${(toxicityScore * 100).toFixed(2)}%)`,
        severity: 'LOW',
        score: toxicityScore
      };
    } else {
      result = {
        shouldWarn: false,
        reason: 'Content appears safe',
        severity: 'NONE',
        score: toxicityScore
      };
    }

    analysisCache.set(cacheKey, result);
    setTimeout(() => analysisCache.delete(cacheKey), CACHE_TIMEOUT);

    return result;
  } catch (error) {
    console.error('Violation analysis error:', error);
    return null;
  }
}

// Rate limiting for message analysis
const messageAnalysisRateLimit = new Map();
const RATE_LIMIT_TIMEOUT = 60000; // 1 minute
const MAX_MESSAGES_PER_MINUTE = 5;

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Check rate limit
  const userId = message.author.id;
  const userRateLimit = messageAnalysisRateLimit.get(userId) || 0;
  if (userRateLimit >= MAX_MESSAGES_PER_MINUTE) return;
  messageAnalysisRateLimit.set(userId, userRateLimit + 1);
  setTimeout(() => messageAnalysisRateLimit.set(userId, Math.max(0, messageAnalysisRateLimit.get(userId) - 1)), RATE_LIMIT_TIMEOUT);

  const analysis = await analyzeViolation(message.content);
  if (!analysis) return;

  const { data: settings } = await supabase
    .from('server_settings')
    .select('logs_channel_id, filter_level')
    .eq('guild_id', message.guild.id)
    .single();

  if (!settings?.logs_channel_id) return;

  const logsChannel = message.guild.channels.cache.get(settings.logs_channel_id);
  if (!logsChannel) return;

  // Enhanced action based on filter level and severity
  const shouldDelete = 
    (settings.filter_level === 'strict' && analysis.severity !== 'NONE') ||
    (settings.filter_level === 'moderate' && ['HIGH', 'MEDIUM'].includes(analysis.severity)) ||
    (settings.filter_level === 'light' && analysis.severity === 'HIGH');

  // New: Auto-warn if toxicity is over 90%
  const shouldWarn = analysis.score > 0.9;

  if (shouldDelete) {
    try {
      await message.delete();
    } catch (error) {
      console.error('Failed to delete message:', error);
    }
  }

  // Add warning to database if toxicity > 90%
  if (shouldWarn) {
    try {
      await supabase.from('user_warns').insert([{
        guild_id: message.guild.id,
        user_id: message.author.id,
        username: message.author.tag,
        reason: `Auto-warning: High toxicity detected (${(analysis.score * 100).toFixed(2)}%)`,
        warned_by: 'FrostMod AI',
        timestamp: new Date().toISOString(),
      }]);
    } catch (error) {
      console.error('Failed to save warning:', error);
    }
  }

  const logEmbed = new EmbedBuilder()
    .setColor(analysis.severity === 'HIGH' ? '#FF0000' : analysis.severity === 'MEDIUM' ? '#FFA500' : '#FFFF00')
    .setTitle('Auto-Moderation Alert')
    .setDescription(`Message from ${message.author.tag} was flagged.`)
    .addFields(
      { name: 'Message', value: message.content.slice(0, 1024) },
      { name: 'Reason', value: analysis.reason },
      { name: 'Action Taken', value: [
        shouldDelete ? 'Message Deleted' : 'Message Flagged',
        shouldWarn ? 'Warning Issued' : 'No Warning'
      ].filter(Boolean).join(', ') },
      { name: 'Channel', value: `<#${message.channel.id}>` }
    )
    .setTimestamp();

  await logsChannel.send({ embeds: [logEmbed] });
});

// Log in the bot
client.login(process.env.DISCORD_TOKEN);
