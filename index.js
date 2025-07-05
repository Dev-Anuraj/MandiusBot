// index.js
require('dotenv').config(); // Load environment variables from .env file

const { Telegraf, session, Scenes, Markup } = require('telegraf');

// Get your bot token from environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
// Render provides a PORT environment variable for web services
const PORT = process.env.PORT || 3000; // Default to 3000 for local development
const WEBHOOK_URL = process.env.WEBHOOK_URL; // Render will provide this or you construct it from RENDER_EXTERNAL_HOSTNAME

if (!BOT_TOKEN) {
    console.error('BOT_TOKEN environment variable not set. Please set it in your .env file or Render environment variables.');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// --- Scene Management for Conversation Flow ---
const { BaseScene, Stage } = Scenes;

// Scene for getting the report link
const getLinkScene = new BaseScene('getLink');
getLinkScene.enter((ctx) => ctx.reply('Please provide the link (e.g., https://t.me/username) or username (e.g., @username) of the bot/channel/group you want to report.'));
getLinkScene.on('text', async (ctx) => {
    ctx.session.reportLink = ctx.message.text;
    console.log(`User provided link: ${ctx.session.reportLink}`);

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Spam/Scam', 'reason_spam')],
        [Markup.button.callback('Illegal Content/Copyright Infringement', 'reason_illegal_content')],
        [Markup.button.callback('Phishing/Malware', 'reason_phishing')],
        [Markup.button.callback('Adult Content (Violates TOS)', 'reason_adult_content')],
        [Markup.button.callback('Other (I\'ll type it)', 'reason_other')],
    ], { columns: 1 });

    await ctx.reply('What is the primary reason for reporting this entity?', keyboard);
    return ctx.scene.enter('getReason');
});
getLinkScene.on('message', (ctx) => ctx.reply('Please provide a valid link or username.'));

// Scene for getting the report reason
const getReasonScene = new BaseScene('getReason');
getReasonScene.action(/reason_/, async (ctx) => {
    await ctx.answerCbQuery();
    const reasonType = ctx.callbackQuery.data;

    if (reasonType === 'reason_other') {
        await ctx.editMessageText('Please type your detailed reason for the report:');
        ctx.session.reasonType = 'User Provided'; // Set a placeholder
        return; // Stay in this scene to get text input
    } else {
        ctx.session.reasonType = reasonType.replace('reason_', '').replace(/_/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        await ctx.editMessageText(`You selected: ${ctx.session.reasonType}. Please provide a detailed explanation now.`);
        return; // Stay in this scene to get text input
    }
});
getReasonScene.on('text', async (ctx) => {
    ctx.session.detailedReason = ctx.message.text;
    console.log(`User provided detailed reason: ${ctx.session.detailedReason}`);
    await generateReport(ctx);
    return ctx.scene.leave();
});
getReasonScene.on('message', (ctx) => ctx.reply('Please select a reason or type your detailed explanation.'));


const stage = new Stage([getLinkScene, getReasonScene]);

bot.use(session());
bot.use(stage.middleware());

// --- Helper function to generate the report ---
async function generateReport(ctx) {
    const reportLink = ctx.session.reportLink || 'N/A';
    const reasonType = ctx.session.reasonType || 'User Provided';
    const detailedReason = ctx.session.detailedReason || 'No detailed explanation provided.';

    let chatType = "Unknown";
    let chatTitle = "Not Available";

    if (reportLink.includes("t.me/joinchat")) {
        chatType = "Group";
    } else if (reportLink.includes("t.me/")) {
        if (reportLink.includes("@")) {
            chatType = "Bot/Channel (Username)";
            chatTitle = reportLink.split('@').pop();
        } else {
            chatType = "Bot/Channel (Link)";
            chatTitle = reportLink.split('/').pop();
        }
    }

    const reportText = (
        `<b>--- Telegram Report ---</b>\n\n` +
        `<b>Chat Type:</b> ${chatType}\n` +
        `<b>Chat Title:</b> ${chatTitle}\n` +
        `<b>Chat ID:</b> (Please find this if possible, e.g., using a bot like @userinfobot if it's a bot/channel)\n` +
        `<b>Chat Link/Username:</b> <code>${reportLink}</code>\n` +
        `<b>Relevant Laws/Violations:</b> ${reasonType}\n` +
        `<b>Explanation:</b> ${detailedReason}\n\n` +
        `<b>--- End of Report ---</b>\n\n` +
        `Please copy this report and send it to Telegram's official support ` +
        `(e.g., via the in-app reporting feature or email abuse@telegram.org).\n` +
        `Thank you for helping keep Telegram safe!`
    );

    await ctx.replyWithHTML(reportText);

    // Clear session data for the next report
    ctx.session = {};
}

// --- Bot Commands and Handlers ---

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

    const featuredTemplateExample = (
        "\n\n<b>Example Report Structure:</b>\n" +
        "<b>Chat Type:</b> Bot/Channel/Group\n" +
        "<b>Chat Title:</b> [If known]\n" +
        "<b>Chat ID:</b> [If known]\n" +
        "<b>Chat Link:</b> [Provided Link/Username]\n" +
        "<b>Relevant Laws:</b> [e.g., Violates Telegram's TOS, Spam, Phishing]\n" +
        "<b>Explanation:</b> [Detailed reason for report]\n"
    );

    await ctx.replyWithHTML(welcomeMessage + featuredTemplateExample);
});

bot.help(async (ctx) => {
    const helpText = (
        "<b>How to use this bot:</b>\n\n" +
        "1. Type /report to begin.\n" +
        "2. I will ask you for the link or username of the bot/channel/group you want to report.\n" +
        "3. Provide the link (e.g., <code>https://t.me/example</code>) or username (e.g., <code>@example</code>).\n" +
        "4. Next, I'll ask for the reason for the report. You can choose from predefined options or type your own detailed explanation.\n" +
        "5. I will then generate a comprehensive report for you to copy and send to Telegram's official support (e.g., via their in-app reporting feature or abuse@telegram.org).\n\n" +
        "Remember to be as detailed as possible in your explanation to help Telegram investigate effectively."
    );
    await ctx.replyWithHTML(helpText);
});

bot.command('report', (ctx) => ctx.scene.enter('getLink'));

bot.command('cancel', async (ctx) => {
    console.log(`User ${ctx.from.first_name} canceled the conversation.`);
    await ctx.reply('Report generation canceled. You can start a new one anytime with /report.');
    ctx.session = {}; // Clear session data
    return ctx.scene.leave();
});

// Fallback for unhandled messages
bot.on('message', (ctx) => ctx.reply("I didn't understand that. Please use /start, /help, or /report."));


// Start the bot using webhooks for Render deployment
if (process.env.NODE_ENV === 'production') {
    // For Render, we need to explicitly set the webhook
    // Render provides RENDER_EXTERNAL_HOSTNAME, which is the public URL of your service
    const webhookPath = `/bot${BOT_TOKEN}`; // A unique path for your webhook
    const webhookUrl = WEBHOOK_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME}${webhookPath}`;

    bot.telegram.setWebhook(webhookUrl)
        .then(() => {
            console.log(`Webhook set to: ${webhookUrl}`);
            // Start the webhook listener
            bot.startWebhook(webhookPath, null, PORT);
            console.log(`Bot listening on port ${PORT}`);
        })
        .catch(err => console.error('Error setting webhook:', err));
} else {
    // For local development, use long polling
    bot.launch();
    console.log('Bot started in long polling mode for local development.');
}


console.log('Bot initialization complete.');

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
