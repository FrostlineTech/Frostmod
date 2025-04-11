# FrostMod Discord Bot

A powerful Discord moderation bot with welcome messages, logging, and AI-powered chat capabilities.

## Features

### Moderation
- 🚫 Customizable curse word filtering (light, moderate, strict)
- ⚠️ Warning system with logging
- 📜 Comprehensive logging system for server events

### Welcome System
- 👋 Customizable welcome messages
- 🎯 Auto-role assignment for new members
- 📝 Support for dynamic message variables ({user}, {memberCount})

### Server Management
- 🔒 Invite link filtering with channel exceptions
- 📊 Bot status monitoring
- 🤖 AI-powered chat capabilities

## Commands

| Command | Description |
|---------|------------|
| `/welcome` | Set the welcome channel for new members |
| `/wmessage` | Set the welcome message |
| `/joinrole` | Set an auto-role for new members |
| `/ignorelinks` | Allow invite links in a specific channel |
| `/filter` | Set the curse word filter level |
| `/warn` | Warn a user for inappropriate behavior |
| `/logs` | Set the logs channel |
| `/status` | Shows bot status, ping, and uptime |
| `/ask` | Ask the AI assistant a question |
| `/help` | Display all available commands |

## Setup

1. Clone the repository
2. Install dependencies:
```bash
npm install
```
3. Create a `.env` file with the following variables:
```env
DISCORD_TOKEN=your_discord_token
CLIENT_ID=your_client_id
HUGGING_FACE_TOKEN=your_huggingface_token
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```
4. Deploy slash commands:
```bash
npm run deploy
```
5. Start the bot:
```bash
npm start
```

## Database Schema

### server_settings
- guild_id (primary key)
- welcome_channel_id
- welcome_message
- auto_role_id
- ignored_channel_id
- logs_channel_id

### filtering_settings
- guild_id (primary key)
- filter_level

### user_warns
- id (primary key)
- guild_id
- user_id
- username
- reason
- warned_by
- timestamp

## Requirements

- Node.js 18.0.0 or higher
- Discord.js 14.18.0
- Supabase database
- HuggingFace API access

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

ISC License

## Support

For support, join our [Discord Server](your_discord_server_link) or open an issue on GitHub.

## Version History

### 1.0.0
- Initial release
- Basic moderation features
- Welcome system
- AI integration
- Logging system

