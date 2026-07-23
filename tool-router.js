class ToolRouter {
  constructor() {
    this.registry = new Map();
  }

  register(name, handler) {
    this.registry.set(name, handler);
  }

  async execute(toolName, args) {
    if (!this.registry.has(toolName)) {
      return { error: `Tool "${toolName}" is not registered.` };
    }
    try {
      const handler = this.registry.get(toolName);
      return await handler(args);
    } catch (error) {
      return { error: error.message };
    }
  }
}

const toolRouter = new ToolRouter();

toolRouter.register('get_timestamp', () => ({ timestamp: new Date().toISOString() }));
toolRouter.register('calculate_gematria', ({ text }) => {
  const cleaned = (text || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
  let sum = 0;
  for (let i = 0; i < cleaned.length; i++) {
    sum += cleaned.charCodeAt(i) - 64;
  }
  return { text, gematria_sum: sum };
});
