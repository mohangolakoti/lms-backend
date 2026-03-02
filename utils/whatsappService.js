const logger = require('./logger');

/**
 * WhatsApp Service Layer
 * Sends messages via WhatsApp
 * Currently: Placeholder for external API integration
 */
const sendWhatsAppMessage = async (options) => {
  const { phoneNumber, message, title } = options;

  try {
    // TODO: Integrate with actual WhatsApp API (e.g., Twilio, MessageBird, etc.)
    // Example payload for external API:
    // const response = await externalWhatsAppAPI.send({
    //   to: phoneNumber,
    //   body: `${title}\n\n${message}`
    // });

    // For now, log the message to simulate the service
    logger.info(`[WhatsApp] Would send to ${phoneNumber}: ${title}`);

    // Simulate async delay
    await new Promise(resolve => setTimeout(resolve, 100));

    return {
      success: true,
      phoneNumber,
      messageId: `whatsapp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
    };
  } catch (error) {
    logger.error(`[WhatsApp] Failed to send message to ${phoneNumber}:`, error);
    throw new Error(`WhatsApp message delivery failed: ${error.message}`);
  }
};

/**
 * Batch send WhatsApp messages
 * Used for announcement distribution
 */
const sendBatchWhatsAppMessages = async (messages) => {
  if (!messages || messages.length === 0) {
    return { successful: 0, failed: 0, results: [] };
  }

  logger.info(`[WhatsApp] Batch sending ${messages.length} messages`);

  // Process all messages in parallel for scalability
  const results = await Promise.allSettled(
    messages.map(msg => sendWhatsAppMessage(msg))
  );

  const summary = {
    successful: 0,
    failed: 0,
    results: [],
  };

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      summary.successful++;
      summary.results.push({
        phoneNumber: messages[index].phoneNumber,
        status: 'sent',
        messageId: result.value.messageId,
      });
    } else {
      summary.failed++;
      summary.results.push({
        phoneNumber: messages[index].phoneNumber,
        status: 'failed',
        error: result.reason?.message,
      });
    }
  });

  logger.info(`[WhatsApp] Batch complete - Successful: ${summary.successful}, Failed: ${summary.failed}`);

  return summary;
};

module.exports = {
  sendWhatsAppMessage,
  sendBatchWhatsAppMessages,
};
