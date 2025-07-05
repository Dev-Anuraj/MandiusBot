// index.js
require('dotenv').config(); // Load environment variables from .env file

const { Telegraf, session, Scenes, Markup } = require('telegraf');
const url = require('url'); // Import the URL module to parse the webhook URL

// --- Environment Variables ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000; // Default to 3000 for local development
const WEBHOOK_URL = process.env.WEBHOOK_URL; // Must be explicitly set in Render env in production

// --- Input Validation for Essential Environment Variables ---
if (!BOT_TOKEN) {
    console.error('ERROR: BOT_TOKEN environment variable not set. Please set it in your .env file or Render environment variables.');
    process.exit(1); // Exit if critical variable is missing
}

if (!WEBHOOK_URL && process.env.NODE_ENV === 'production') {
    console.error('ERROR: WEBHOOK_URL environment variable not set. This is required for production deployment on Render.');
    console.error('Please set WEBHOOK_URL to your Render service URL + /bot<YOUR_BOT_TOKEN>');
    process.exit(1); // Exit if critical variable is missing in production
}

const bot = new Telegraf(BOT_TOKEN);

// --- Scene Management for Conversation Flow ---
// BaseScene and Stage are used to manage multi-step conversations.
const { BaseScene, Stage } = Scenes;

// Scene 1: Get the report link/username
const getLinkScene = new BaseScene('getLink');
// Updated prompt to encourage @username for better live data fetching
getLinkScene.enter((ctx) => ctx.reply('✅ Session created! \n\n Please provide the @username (e.g., @iPapkornBot) or a direct link (e.g., https://t.me/channelname) to the channel/group/bot you wish to report.'));
getLinkScene.on('text', async (ctx) => {
    ctx.session.reportLink = ctx.message.text.trim(); // Store and trim the input link
    console.log(`User provided link: ${ctx.session.reportLink}`);

    // Define inline keyboard buttons for common report reasons
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Spam/Scam', 'reason_spam')],
        [Markup.button.callback('Illegal Content/Copyright Infringement', 'reason_illegal_content')],
        [Markup.button.callback('Phishing/Malware', 'reason_phishing')],
        [Markup.button.callback('Adult Content (Violates TOS)', 'reason_adult_content')],
        [Markup.button.callback('Other (I\'ll type it)', 'reason_other')],
    ], { columns: 1 }); // Arrange buttons in a single column

    await ctx.reply('Please explain why this content is illegal under EU or EU member law:', keyboard);
    return ctx.scene.enter('getReason'); // Transition to the next scene
});
getLinkScene.on('message', (ctx) => ctx.reply('Invalid input. Please provide a valid link or username.'));

// Scene 2: Get the report reason (from button or text input)
const getReasonScene = new BaseScene('getReason');
getReasonScene.action(/reason_/, async (ctx) => {
    await ctx.answerCbQuery(); // Acknowledge the button press
    const reasonType = ctx.callbackQuery.data; // Get the callback data (e.g., 'reason_spam')

    if (reasonType === 'reason_other') {
        // If 'Other' is selected, prompt for detailed text and stay in this scene
        await ctx.editMessageText('Please type your detailed reason for the report:');
        ctx.session.reasonType = 'User Provided'; // Set a placeholder for the reason type
        return; // Stay in this scene to await text input
    } else {
        // For predefined reasons, format the reason type and prompt for detailed explanation
        ctx.session.reasonType = reasonType.replace('reason_', '').replace(/_/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        await ctx.editMessageText(`You selected: ${ctx.session.reasonType}. Please provide a detailed explanation now.`);
        return; // Stay in this scene to await text input
    }
});
getReasonScene.on('text', async (ctx) => {
    ctx.session.detailedReason = ctx.message.text.trim(); // Store and trim the detailed explanation
    console.log(`User provided detailed reason: ${ctx.session.detailedReason}`);
    await generateReport(ctx); // Generate the final report
    return ctx.scene.leave(); // Exit the scene
});
getReasonScene.on('message', (ctx) => ctx.reply('Please select a reason from the options or type your detailed explanation.'));

// Register scenes with the stage middleware
const stage = new Stage([getLinkScene, getReasonScene]);
bot.use(session()); // Enable session middleware for conversation state management
bot.use(stage.middleware()); // Enable stage middleware for scene management

// --- Helper function to generate the comprehensive report ---
async function generateReport(ctx) {
    const reportLink = ctx.session.reportLink || 'N/A';
    const reasonType = ctx.session.reasonType || 'User Provided';
    const detailedReason = ctx.session.detailedReason || 'No detailed explanation provided.';

    let chatType = "Unknown";
    let chatTitle = "None"; // Default to 'None' as per screenshot
    let chat_id = "None (Please find using @userinfobot or similar)"; // Placeholder for Chat ID

    // Attempt to fetch live chat data using Telegraf's getChat method.
    // This will work for public channels/groups/bots if the bot can resolve them by username/link,
    // or for private chats if the bot is already a member/admin.
    try {
        let chatIdentifier = reportLink;
        // If the link is a full t.me link, try to extract the username or ID
        if (reportLink.startsWith('https://t.me/')) {
            const parts = reportLink.split('/');
            const lastPart = parts[parts.length - 1];
            if (lastPart.startsWith('+')) { // It's an invite link, cannot get info directly
                throw new Error("Cannot get info for private invite links directly.");
            }
            chatIdentifier = lastPart.startsWith('@') ? lastPart : `@${lastPart}`; // Ensure it's @username format
        } else if (!reportLink.startsWith('@') && !isNaN(reportLink)) {
            // If it's a numeric ID, Telegram's getChat can handle it directly
            chatIdentifier = parseInt(reportLink);
        } else if (!reportLink.startsWith('@')) {
             // If it's a non-numeric, non-@username, assume it's an invalid format for getChat
             throw new Error("Invalid format for direct chat lookup. Please use @username or a numeric ID.");
        }


        const chatInfo = await ctx.telegram.getChat(chatIdentifier);
        console.log("Fetched live chat info:", chatInfo); // Log for debugging

        chat_id = chatInfo.id;
        chatTitle = chatInfo.title || 'None';

        if (chatInfo.type === 'channel') {
            chatType = "Channel";
        } else if (chatInfo.type === 'group' || chatInfo.type === 'supergroup') {
            chatType = "Group";
        } else if (chatInfo.type === 'private') {
            chatType = "Private Chat (User)"; // Reporting a user directly
        } else if (chatInfo.username && chatInfo.is_bot) {
            chatType = "Bot";
        }

    } catch (error) {
        console.error(`ERROR: Could not fetch live chat data for "${reportLink}". Reason: ${error.message}`);
        // Fallback to heuristic if live data fetching fails (e.g., private link, invalid link, bot not admin)
        if (reportLink.includes("t.me/joinchat")) {
            chatType = "Group";
        } else if (reportLink.includes("t.me/")) {
            if (reportLink.startsWith("https://t.me/")) {
                const parts = reportLink.split('/');
                const lastPart = parts[parts.length - 1];
                if (lastPart.startsWith('@')) {
                    chatType = "Bot/Channel (Username)";
                    chatTitle = lastPart.substring(1); // Remove '@'
                } else if (lastPart) {
                    chatType = "Bot/Channel (Link)";
                    chatTitle = lastPart;
                }
            } else if (reportLink.startsWith("@")) {
                chatType = "Bot/Channel (Username)";
                chatTitle = reportLink.substring(1); // Remove '@'
            }
        }
    }

    // Construct the report text similar to the screenshot
    const reportText = (
        `<b>Report Data:</b>\n\n` +
        `<b>📝Text:</b> This content shared in this public bot includes spam for illegal channels that contain illegal images or videos. If a telegram user joins all the channels listed in the bot Once started, they will be sent illegal images or videos. It also violates Telegram's policy on adult content, especially when such content is accessible to minors and copyright infringement. It also shares a phishing link used to steal personal information and to scam Telegram users and steal credit cards and sensitive data.\n\n` +
        `<b>🗨️Chat Type:</b> ${chatType}\n` +
        `<b>🗨️Chat Title:</b> ${chatTitle}\n` +
        `<b>🗨️Chat ID:</b> ${chat_id}\n` + // Chat ID will now be populated if getChat succeeds
        `<b>🗨️Chat Link:</b> <code>${reportLink}</code>\n` +
        `<b>🗨️Relevant Laws:</b> ${reasonType}\n` +
        `<b>Name:</b> Not Available\n` + // Placeholder for Name - Cannot be fetched via Bot API
        `<b>🗺️Address:</b> Not Available\n` + // Placeholder for Address - Cannot be fetched via Bot API
        `<b>📞Phone Number:</b> Not Available\n` + // Placeholder for Phone Number - Cannot be fetched via Bot API
        `<b>📧E-Mail:</b> Not Available\n\n` + // Placeholder for E-Mail - Cannot be fetched via Bot API
        `Thank you for helping keep Telegram safe!`
    );

    await ctx.replyWithHTML(reportText);

    // Clear session data for the next report to ensure a clean slate
    ctx.session = {};
}

// --- Bot Commands and Handlers ---

// Handles the /start command
bot.start(async (ctx) => {
    const user = ctx.from;
    const welcomeMessage = (
        `Hello ${user.first_name || 'there'}!\n\n` +
        "I am your Telegram Report Bot. I can help you generate reports for " +
        "illegal bots, channels, or groups on Telegram.\n\n" +
        "Here's what I can do:\n" +
        "➡️ /report - Start the process to generate a report.\n" +
        "➡️ /help - Get more information about how to use me.\n\n" +
        "Let's make Telegram a safer place!"
    );

    // Removed featuredTemplateExample as requested
    await ctx.replyWithHTML(welcomeMessage);
});

// Handles the /help command
bot.help(async (ctx) => {
    const helpText = (
        "<b>How to use this bot:</b>\n\n" +
        "1. Type /report to begin.\n" +
        "2. I will ask you for the link or username of the bot/channel/group you want to report.\n" +
        "3. Provide the link (e.g., <code>https://t.me/example</code>) or username (e.g., <code>@example</code>).\n" +
        "4. Next, I'll ask for the reason for the report. You can choose from predefined options or type your own detailed explanation.\n" +
        "5. I will then generate a comprehensive report for you to copy and send to Telegram's official support (e.g., via their in-app reporting feature or email abuse@telegram.org).\n\n" +
        "Remember to be as detailed as possible in your explanation to help Telegram investigate effectively."
    );
    await ctx.replyWithHTML(helpText);
});

// Handles the /report command, starting the conversation flow
bot.command('report', (ctx) => ctx.scene.enter('getLink'));

// Handles the /cancel command, allowing users to exit the conversation
bot.command('cancel', async (ctx) => {
    console.log(`User ${ctx.from.first_name} canceled the conversation.`);
    await ctx.reply('Report generation canceled. You can start a new one anytime with /report.');
    ctx.session = {}; // Clear session data to reset the conversation state
    return ctx.scene.leave();
});

// --- Greeting Message Handler ---
// This handler responds to common greeting words.
bot.on('message', async (ctx) => {
    // Only process messages that are not part of an active scene conversation
    if (ctx.scene.current) {
        // If there's an active scene, let the scene handler deal with it
        // This prevents the fallback from interfering with conversation flow
        return;
    }

    const text = ctx.message.text?.toLowerCase();
    if (!text) return; // Ignore messages without text

    const greetings = ['hi', 'hello', 'hey', 'hii', 'helo', 'hola'];
    if (greetings.includes(text)) {
        const user = ctx.from;
        const welcomeMessage = (
            `Hello ${user.first_name || 'there'}!\n\n` +
            "I am your Telegram Report Bot. I can help you generate reports for " +
            "illegal bots, channels, or groups on Telegram.\n\n" +
            "Here's what I can do:\n" +
            "➡️ /report - Start the process to generate a report.\n" +
            "➡️ /help - Get more information about how to use me.\n\n" +
            "Let's make Telegram a safer place!"
        );
        await ctx.replyWithHTML(welcomeMessage); // Use replyWithHTML for consistent formatting
        return; // Important: return to stop further processing by other message handlers
    }

    // Fallback for unhandled messages outside of conversation scenes
    // This should be the last message handler, and only trigger if no other handler (including scenes) processed the message
    ctx.reply("I didn't understand that. Please use /start, /help, or /report.");
});


// --- Bot Launch Logic (Webhook vs. Long Polling) ---
if (process.env.NODE_ENV === 'production') {
    // For production (e.g., Render), use webhooks
    // Parse the WEBHOOK_URL to get the path for the webhook listener
    const parsedUrl = url.parse(WEBHOOK_URL);
    const webhookPath = parsedUrl.pathname;

    console.log(`[Production Mode] Attempting to set webhook to: ${WEBHOOK_URL}`);
    console.log(`[Production Mode] Bot will listen on path: ${webhookPath} and port: ${PORT}`);

    bot.telegram.setWebhook(WEBHOOK_URL)
        .then(() => {
            console.log(`[Production Mode] Webhook successfully set to: ${WEBHOOK_URL}`);
            // Start the webhook listener on the specified path and port
            bot.startWebhook(webhookPath, null, PORT);
            console.log(`[Production Mode] Bot webhook listener started on port ${PORT}`);
        })
        .catch(err => {
            console.error('ERROR: Failed to set or start webhook:', err.message);
            console.error(err); // Log the full error object for detailed debugging
            process.exit(1); // Exit process to indicate critical failure
        });
} else {
    // For local development, use long polling
    bot.launch();
    console.log('[Development Mode] Bot started in long polling mode for local development.');
}

console.log('Bot initialization complete. Waiting for updates...');

// Enable graceful stop for both modes
process.once('SIGINT', () => {
    console.log('SIGINT received, stopping bot...');
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    console.log('SIGTERM received, stopping bot...');
    bot.stop('SIGTERM');
});
