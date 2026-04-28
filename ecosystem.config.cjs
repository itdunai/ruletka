module.exports = {
  apps: [
    {
      name: "ruletka-api",
      cwd: ".",
      script: "npm",
      args: "run start --workspace @ruletka/api",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "ruletka-bot",
      cwd: ".",
      script: "npm",
      args: "run start --workspace @ruletka/bot",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
