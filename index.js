/**
 * FrostMod - An AutoMod Bot for Discord
 * Version: 1.0.5
 * Developed by Dakota
 */

// =============================================
// Dependencies and Imports
// =============================================
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  PermissionsBitField, 
  Collection 
} = require('discord.js');
const dotenv = require('dotenv');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { createClient } = require('@supabase/supabase-js');
const { HfInference } = require('@huggingface/inference');
const axios = require('axios');

// =============================================
// Environment Configuration
// =============================================
dotenv.config();

/**
 * Validates required environment variables
 * @throws {Error} If any required environment variables are missing
 */
function validateEnv() {
  const required = [
    'DISCORD_TOKEN',
    'CLIENT_ID',
    'HUGGING_FACE_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_CSE_ID'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// Validate environment before proceeding
validateEnv();

// =============================================
// Client and API Initialization
// =============================================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const hf = new HfInference(process.env.HUGGING_FACE_TOKEN);
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;

// Initialize Discord client with required intents
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

// =============================================
// Collections and Constants
// =============================================
const cooldowns = new Collection();
const serverSettingsCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Word filter sets for different moderation levels
const FILTER_SETS = {
  light: new Set([]),
  moderate: new Set(['nigger', 'faggot', 'retard', 'kike', 'chink', 'spic',
    'wetback', 'beaner', 'tranny', 'dyke']),
  strict: new Set(['fuck', 'shit', 'bitch', 'asshole',
    'dick', 'pussy', 'cunt', 'damn', 'hell', 'ass', 'piss',
    'cock', 'whore', 'slut', 'nigger', 'faggot', 'retard', 'kike', 
    'chink', 'spic', 'wetback', 'beaner', 'tranny', 'dyke'])
};

// =============================================
// Command Definitions
// =============================================
const commands = [
  // Server Management Commands
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

  // Moderation Commands
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

  // Utility Commands
  new SlashCommandBuilder().setName('help')
    .setDescription('Displays the help menu with available commands'),

  new SlashCommandBuilder().setName('status')
    .setDescription('Shows the bot\'s current status, ping, and uptime'),

  // AI and Search Commands
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the AI a question')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('What would you like to ask?')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search the web for answers')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('What would you like to search for?')
        .setRequired(true)),
].map(command => command.toJSON());

// =============================================
// Command Registration
// =============================================
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

// =============================================
// Helper Functions
// =============================================
/**
 * Retrieves the logs channel for a guild
 * @param {string} guildId - The ID of the guild
 * @returns {Promise<Channel|null>} The logs channel or null if not found
 */
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

/**
 * Retrieves server settings with caching
 * @param {string} guildId - The ID of the guild
 * @returns {Promise<Object|null>} The server settings or null if not found
 */
async function getServerSettings(guildId) {
  const now = Date.now();
  const cached = serverSettingsCache.get(guildId);
  
  if (cached && now - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  const { data, error } = await supabase
    .from('server_settings')
    .select('*')
    .eq('guild_id', guildId)
    .single();

  if (!error && data) {
    serverSettingsCache.set(guildId, {
      data,
      timestamp: now
    });
  }

  return data;
}

/**
 * Checks if content contains filtered words
 * @param {string} content - The content to check
 * @param {string} filterLevel - The filter level to use
 * @returns {boolean} True if content contains filtered words
 */
function containsFilteredWord(content, filterLevel) {
  const words = content.toLowerCase().split(/\s+/);
  return words.some(word => {
    const cleanWord = word.replace(/[^a-zA-Z]/g, '');
    return FILTER_SETS[filterLevel].has(cleanWord);
  });
}

/**
 * Performs a Google Custom Search
 * @param {string} query - The search query
 * @returns {Promise<Array>} Array of search results
 */
async function googleSearch(query) {
  try {
    const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: {
        key: GOOGLE_API_KEY,
        cx: GOOGLE_CSE_ID,
        q: query,
        num: 5,
        safe: 'active'
      }
    });

    return response.data.items || [];
  } catch (error) {
    console.error('Google Search Error:', error);
    return [];
  }
}

// =============================================
// Event Handlers
// =============================================
client.once('ready', () => {
  console.log(`${client.user.tag} is logged in and ready!`);

  client.user.setPresence({
    activities: [{
      name: 'ver 1.0.5 - Developed by Dakota',
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

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  try {
    // Get server's filter settings
    const { data: filterSettings } = await supabase
      .from('filtering_settings')
      .select('filter_level')
      .eq('guild_id', message.guild.id)
      .single();

    if (!filterSettings || !filterSettings.filter_level) return;

    // Get server's ignored channel
    const { data: serverSettings } = await supabase
      .from('server_settings')
      .select('ignored_channel_id')
      .eq('guild_id', message.guild.id)
      .single();

    // Skip filtering if in ignored channel
    if (serverSettings?.ignored_channel_id === message.channel.id) return;

    const content = message.content.toLowerCase();
    const filterLevel = filterSettings.filter_level;
    
    // Check if message contains any filtered words
    const hasFilteredWord = containsFilteredWord(content, filterLevel);

    if (hasFilteredWord) {
      // Delete the message
      await message.delete();

      // Send warning to channel
      const tempMsg = await message.channel.send(
        `${message.author}, your message was removed for containing inappropriate content.`
      );
      setTimeout(() => tempMsg.delete().catch(() => {}), 5000);

      // Log the filtered message
      const logsChannel = await getLogsChannel(message.guild.id);
      if (logsChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor('#FF9900')
          .setTitle('Message Filtered')
          .addFields(
            { name: 'User', value: `${message.author.tag}` },
            { name: 'Channel', value: `<#${message.channel.id}>` },
            { name: 'Filter Level', value: filterLevel }
          )
          .setTimestamp();
        await logsChannel.send({ embeds: [logEmbed] });
      }
    }
  } catch (error) {
    console.error('Error in message filter:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  try {
    // Check cooldown
    const cooldownError = checkCooldown(interaction);
    if (cooldownError) {
      await interaction.reply({ content: cooldownError, ephemeral: true });
      return;
    }

    // Add permission check
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild) && 
        ['welcome', 'wmessage', 'joinrole', 'ignorelinks', 'filter', 'logs'].includes(interaction.commandName)) {
      await interaction.reply({ 
        content: '⚠️ You need the Manage Server permission to use this command.',
        ephemeral: true 
      });
      return;
    }

    const { commandName, guild } = interaction;

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
          { name: '📊 `/status`', value: 'Shows the bot\'s current status, ping, and uptime.' },
          { name: '🤖 `/ask`', value: 'Ask the AI assistant a question.' },
          { name: '🔎 `/search`', value: 'Search for answers about games and gaming.' }
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

    if (commandName === 'ask') {
      await interaction.deferReply();

      try {
        const question = interaction.options.getString('question');

        const response = await hf.questionAnswering({
          model: "deepset/roberta-base-squad2",
          inputs: {
            question: question,
            context: `The capital of Alaska is Juneau. The capital of California is Sacramento. 
                     The capital of Texas is Austin. The capital of Florida is Tallahassee. 
                     The capital of New York is Albany. The Earth is the third planet from the Sun. 
                     The Moon is Earth's only natural satellite. The Sun is a star at the center of our solar system.
                     Paris is the capital of France. London is the capital of England. 
                     Tokyo is the capital of Japan. Beijing is the capital of China.
                     
                     Basic Math Facts:
                     1 + 1 = 2. 2 + 2 = 4. 3 + 3 = 6. 4 + 4 = 8. 5 + 5 = 10.
                     2 x 2 = 4. 3 x 3 = 9. 4 x 4 = 16. 5 x 5 = 25. 10 x 10 = 100.
                     10 - 5 = 5. 20 - 10 = 10. 15 - 5 = 10. 100 - 50 = 50.
                     10 ÷ 2 = 5. 100 ÷ 4 = 25. 81 ÷ 9 = 9. 50 ÷ 5 = 10.
                     
                     Math Formulas:
                     Area of a square = side × side
                     Area of a rectangle = length × width
                     Area of a circle = π × radius²
                     Circumference of a circle = 2 × π × radius
                     Volume of a cube = side³
                     π (pi) is approximately 3.14159
                     
                     Common Conversions:
                     1 kilometer = 1000 meters
                     1 mile = 1.60934 kilometers
                     1 hour = 60 minutes
                     1 minute = 60 seconds
                     1 kilogram = 1000 grams
                     1 pound = 0.453592 kilograms`
          }
        });

        const answer = response.answer.trim();

        const answerEmbed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('AI Response')
          .addFields(
            { name: '❓ Question', value: question },
            { name: '💡 Answer', value: answer || 'I cannot answer that question.' }
          )
          .setTimestamp()
          .setFooter({ text: 'Powered by HuggingFace AI' });

        await interaction.editReply({ embeds: [answerEmbed] });
      } catch (error) {
        console.error('AI Error:', error);
        await interaction.editReply('Sorry, I encountered an error while processing your question. Please try again later.');
      }
    }

    if (commandName === 'search') {
      await interaction.deferReply();

      try {
        const query = interaction.options.getString('query');
        
        // Use Google Custom Search API
        const searchResults = await googleSearch(query);

        if (searchResults.length === 0) {
          await interaction.editReply({
            embeds: [new EmbedBuilder()
              .setColor('#FF0000')
              .setTitle('🔎 No Results Found')
              .setDescription('Sorry, I couldn\'t find any results for your query.')
              .setTimestamp()
            ]
          });
          return;
        }

        // Process the best result
        const bestResult = searchResults[0];
        let bestAnswer = '';
        let additionalInfo = '';
        let source = '';

        // Extract the snippet and try to find steps or key information
        const content = bestResult.snippet;
        const sentences = content.split(/[.!?]+/).filter(Boolean);
        
        // Skip date sentences and incomplete sentences
        const validSentences = sentences.filter(sentence => {
          const lowerSentence = sentence.toLowerCase();
          return !lowerSentence.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i) && // Skip dates
                 !lowerSentence.includes('...') && // Skip truncated sentences
                 sentence.length > 20 && // Skip very short sentences
                 !lowerSentence.match(/^\d+\.\s/); // Skip numbered list items without context
        });

        if (validSentences.length > 0) {
          // For game-related queries, look for specific patterns
          const isGameQuery = query.toLowerCase().includes('minecraft') || 
                            query.toLowerCase().includes('how to') ||
                            query.toLowerCase().includes('tame') ||
                            query.toLowerCase().includes('craft') ||
                            query.toLowerCase().includes('build');

          if (isGameQuery) {
            // Try to find a complete set of instructions
            let instructions = [];
            for (let i = 0; i < validSentences.length; i++) {
              const sentence = validSentences[i];
              if (sentence.toLowerCase().includes('step') || 
                  sentence.toLowerCase().includes('first') ||
                  sentence.toLowerCase().includes('then') ||
                  sentence.toLowerCase().includes('next') ||
                  sentence.toLowerCase().includes('finally')) {
                instructions.push(sentence.trim() + '.');
              }
            }

            if (instructions.length > 0) {
              bestAnswer = instructions.join('\n\n');
            } else {
              // If no specific instructions found, use the first few relevant sentences
              bestAnswer = validSentences.slice(0, 3)
                .map(s => s.trim() + '.')
                .join('\n\n');
            }

            // Add additional context from remaining sentences
            if (validSentences.length > 3) {
              additionalInfo = validSentences.slice(3, 5)
                .map(s => s.trim() + '.')
                .join(' ');
            }
          } else {
            // For non-game queries, use the first complete sentence
            bestAnswer = validSentences[0].trim() + '.';
            
            // Add additional information from remaining sentences
            if (validSentences.length > 1) {
              additionalInfo = validSentences.slice(1, 3)
                .map(s => s.trim() + '.')
                .join(' ');
            }
          }
        } else {
          // Fallback to the original snippet if no valid sentences found
          bestAnswer = content;
        }

        // Format the source URL
        if (bestResult.link) {
          const url = new URL(bestResult.link);
          source = url.hostname;
        }

        const searchEmbed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('🔎 Search Results')
          .addFields(
            { name: '❓ Query', value: query },
            { name: '💡 Answer', value: bestAnswer || 'No direct answer found.' }
          );

        if (additionalInfo) {
          searchEmbed.addFields({ name: '📝 Additional Information', value: additionalInfo });
        }

        if (source) {
          searchEmbed.addFields({ name: '🔗 Source', value: source });
        }

        searchEmbed.setTimestamp()
          .setFooter({ text: 'Powered by Google Search' });

        await interaction.editReply({ embeds: [searchEmbed] });
      } catch (error) {
        console.error('Search Error:', error);
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Search Error')
            .setDescription('Sorry, I encountered an error while searching. Please try again later.')
            .setTimestamp()
          ]
        });
      }
    }
  } catch (error) {
    console.error(`Error executing command ${interaction.commandName}:`, error);
    const errorMessage = 'An error occurred while executing this command. Please try again later.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
});

// =============================================
// Rate Limiting Configuration
// =============================================
const COOLDOWN_DURATION = {
  ask: 30, // 30 seconds cooldown for AI commands
  search: 30,
  warn: 5,
  filter: 5,
  default: 3 // default cooldown
};

/**
 * Checks if a user is on cooldown for a command
 * @param {CommandInteraction} interaction - The interaction to check
 * @returns {string|null} Error message if on cooldown, null otherwise
 */
function checkCooldown(interaction) {
  if (!cooldowns.has(interaction.commandName)) {
    cooldowns.set(interaction.commandName, new Collection());
  }

  const now = Date.now();
  const timestamps = cooldowns.get(interaction.commandName);
  const cooldownAmount = (COOLDOWN_DURATION[interaction.commandName] || COOLDOWN_DURATION.default) * 1000;

  if (timestamps.has(interaction.user.id)) {
    const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

    if (now < expirationTime) {
      const timeLeft = (expirationTime - now) / 1000;
      return `Please wait ${timeLeft.toFixed(1)} more seconds before using this command again.`;
    }
  }

  timestamps.set(interaction.user.id, now);
  setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
  return null;
}

// =============================================
// Error Handling
// =============================================
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  client.destroy();
  process.exit(1);
});

// =============================================
// Bot Login (Always at the bottom)
// =============================================
client.login(process.env.DISCORD_TOKEN);

