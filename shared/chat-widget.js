// Chat Widget for Alpaca Playhouse
// Uses Google Gemini API to answer questions based on compiled context

const SUPABASE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co';
const CONTEXT_URL = `${SUPABASE_URL}/storage/v1/object/public/site-content/context.json`;

// State
let contextData = null;
let geminiApiKey = null;
let isLoading = false;

/**
 * Initialize the chat widget
 * @param {string} apiKey - Google Gemini API key
 * @param {object} options - Configuration options
 */
export async function initChatWidget(apiKey, options = {}) {
  geminiApiKey = apiKey;

  // Load context
  try {
    const response = await fetch(CONTEXT_URL);
    if (response.ok) {
      contextData = await response.json();
    } else {
      console.warn('Failed to load context, using minimal context');
      contextData = { spaces: [], faq: [], external_content: [] };
    }
  } catch (error) {
    console.warn('Error loading context:', error);
    contextData = { spaces: [], faq: [], external_content: [] };
  }
}

/**
 * Ask a question and get an AI-generated answer
 * @param {string} question - The user's question
 * @returns {Promise<{answer: string, confident: boolean, sources: string[]}>}
 */
export async function askQuestion(question) {
  if (!geminiApiKey) {
    throw new Error('Chat widget not initialized. Call initChatWidget first.');
  }

  if (!question.trim()) {
    throw new Error('Please enter a question.');
  }

  // Build the context prompt
  const contextPrompt = buildContextPrompt();

  const systemPrompt = `You are a helpful assistant for Alpaca Playhouse, a unique property in Cedar Creek, Texas (near Austin) that offers rental spaces, event hosting, and community experiences. You help answer questions from visitors, potential renters, and event hosts.

IMPORTANT INSTRUCTIONS:
1. Answer based ONLY on the context provided below. If you're not sure or the information isn't in the context, say so honestly.
2. Be friendly, concise, and helpful.
3. At the end of your response, include a confidence assessment in this exact format on a new line:
   CONFIDENCE: HIGH (if you're very confident the answer is accurate based on context)
   CONFIDENCE: LOW (if you're unsure, making assumptions, or the context doesn't cover this topic)
4. For rental inquiries, mention they can apply at https://alpacaplayhouse.com/spaces/apply/
5. For event hosting, mention they can apply at https://alpacaplayhouse.com/events/
6. Keep responses under 200 words unless more detail is needed.

CONTEXT ABOUT ALPACA PLAYHOUSE:
${contextPrompt}

---

Now answer the following question from a visitor:`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: systemPrompt },
            { text: question }
          ]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500,
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Gemini API error:', error);
      throw new Error('Failed to get a response. Please try again.');
    }

    const data = await response.json();
    const rawAnswer = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse confidence from response
    const confidenceMatch = rawAnswer.match(/CONFIDENCE:\s*(HIGH|LOW)/i);
    const confident = confidenceMatch ? confidenceMatch[1].toUpperCase() === 'HIGH' : false;

    // Remove the confidence line from the displayed answer
    const answer = rawAnswer.replace(/\n?CONFIDENCE:\s*(HIGH|LOW)/i, '').trim();

    return {
      answer,
      confident,
      sources: [] // Could be enhanced to track which context was used
    };
  } catch (error) {
    console.error('Error asking question:', error);
    throw error;
  }
}

/**
 * Submit a question that couldn't be answered for admin review
 * @param {string} question - The original question
 * @param {string} userEmail - Optional user email for follow-up
 */
export async function submitUnansweredQuestion(question, userEmail = null, source = 'user_feedback') {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/faq_entries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTc4OTM5MjcsImV4cCI6MjAzMzQ2OTkyN30.HOH98PqT_mCHHKqNGqIqVLdKVfmi1xZPZfFUaKsBlzE',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        question,
        user_email: userEmail,
        source,
        answer: null,
        is_published: false
      })
    });

    if (!response.ok) {
      throw new Error('Failed to submit question');
    }

    // Also send email notification to admin
    await sendAdminNotification(question, userEmail);

    return true;
  } catch (error) {
    console.error('Error submitting question:', error);
    throw error;
  }
}

/**
 * Send email notification to admin about unanswered question
 */
async function sendAdminNotification(question, userEmail) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTc4OTM5MjcsImV4cCI6MjAzMzQ2OTkyN30.HOH98PqT_mCHHKqNGqIqVLdKVfmi1xZPZfFUaKsBlzE'
      },
      body: JSON.stringify({
        type: 'faq_unanswered',
        to: 'alpacaplayhouse@gmail.com',
        data: {
          question,
          user_email: userEmail || 'Not provided',
          faq_admin_url: 'https://alpacaplayhouse.com/spaces/admin/faq.html'
        }
      })
    });
  } catch (error) {
    console.warn('Failed to send admin notification:', error);
    // Don't throw - the question was still saved
  }
}

/**
 * Build the context prompt from loaded context data
 */
function buildContextPrompt() {
  if (!contextData) return 'No context available.';

  const parts = [];

  // Add general info
  parts.push(`GENERAL INFO:
- Location: 160 Still Forest Drive, Cedar Creek, TX 78612 (30 minutes east of Austin)
- Contact: alpacaplayhouse@gmail.com, 424-234-1750
- Website: alpacaplayhouse.com`);

  // Add spaces info
  if (contextData.spaces?.length > 0) {
    parts.push('\nAVAILABLE RENTAL SPACES:');
    contextData.spaces.forEach(space => {
      let desc = `- ${space.name}`;
      if (space.type) desc += ` (${space.type})`;
      if (space.monthly_rate) desc += `: $${space.monthly_rate}/month`;
      if (space.beds || space.baths) {
        const details = [];
        if (space.beds) details.push(`${space.beds} bed`);
        if (space.baths) details.push(`${space.baths} bath`);
        desc += ` - ${details.join(', ')}`;
      }
      if (space.description) desc += `\n  ${space.description}`;
      parts.push(desc);
    });
  }

  // Add FAQ
  if (contextData.faq?.length > 0) {
    parts.push('\nFREQUENTLY ASKED QUESTIONS:');
    contextData.faq.forEach(faq => {
      parts.push(`Q: ${faq.question}\nA: ${faq.answer}\n`);
    });
  }

  // Add external content
  if (contextData.external_content?.length > 0) {
    contextData.external_content.forEach(doc => {
      parts.push(`\n${doc.title.toUpperCase()}:\n${doc.content}`);
    });
  }

  return parts.join('\n');
}

export default {
  initChatWidget,
  askQuestion,
  submitUnansweredQuestion
};
