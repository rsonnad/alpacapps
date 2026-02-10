/**
 * Shared template engine for email templates.
 * Supports:
 *   {{variable}}                          - Simple replacement
 *   {{#if variable}}...{{/if}}            - Conditional block (rendered if variable is truthy)
 *   {{#if variable}}...{{else}}...{{/if}} - If/else blocks
 */

/**
 * Render a template string with data placeholders.
 */
export function renderTemplate(
  template: string,
  data: Record<string, any>
): string {
  if (!template) return "";

  let result = template;

  // 1. Handle {{#if variable}}...{{else}}...{{/if}}
  result = result.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, key, ifBlock, elseBlock) => {
      return data[key] ? ifBlock : elseBlock;
    }
  );

  // 2. Handle {{#if variable}}...{{/if}} (no else)
  result = result.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, key, block) => {
      return data[key] ? block : "";
    }
  );

  // 3. Handle {{variable}} replacements
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = data[key];
    return value !== undefined && value !== null ? String(value) : "";
  });

  return result;
}

/**
 * Sender address map.
 */
export const SENDER_MAP: Record<
  string,
  { from: string; reply_to: string }
> = {
  team: {
    from: "Alpaca Team <team@alpacaplayhouse.com>",
    reply_to: "team@alpacaplayhouse.com",
  },
  auto: {
    from: "Alpaca Automaton <auto@alpacaplayhouse.com>",
    reply_to: "auto@alpacaplayhouse.com",
  },
  noreply: {
    from: "GenAlpaca <noreply@alpacaplayhouse.com>",
    reply_to: "team@alpacaplayhouse.com",
  },
  payments: {
    from: "Alpaca Payments <noreply@alpacaplayhouse.com>",
    reply_to: "team@alpacaplayhouse.com",
  },
  pai: {
    from: "PAI <pai@alpacaplayhouse.com>",
    reply_to: "pai@alpacaplayhouse.com",
  },
};
