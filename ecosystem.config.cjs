const path = require("node:path");
const dotenv = require("dotenv");

const envPath = path.resolve(__dirname, ".env");
const parsedEnv = dotenv.config({ path: envPath }).parsed ?? {};

module.exports = {
  apps: [
    {
      name: "ruletka-api",
      cwd: ".",
      script: "npm",
      args: "run start --workspace @ruletka/api",
      env: {
        ...parsedEnv,
        NODE_ENV: "production"
      }
    },
    {
      name: "ruletka-bot",
      cwd: ".",
      script: "npm",
      args: "run start --workspace @ruletka/bot",
      env: {
        ...parsedEnv,
        NODE_ENV: "production"
      }
    }
  ]
};
