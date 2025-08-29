// Usage: npm run handler -- <filename>

import "dotenv/config";

const [, , fileFlag] = process.argv;

if (!fileFlag) {
  console.error("Usage: npm run handler -- <filename>");
  process.exit(1);
}

(async () => {
  try {
    const mod = await import(`./${fileFlag}`);
    const handler = mod.handler;
    if (typeof handler !== "function") {
      console.error("No handler function exported in", fileFlag);
      process.exit(1);
    }
    const isAsync = handler.constructor.name === "AsyncFunction";
    if (isAsync) {
      await handler();
    } else {
      handler();
    }
  } catch (err) {
    console.error("Error running handler:", err);
    process.exit(1);
  }
})();
