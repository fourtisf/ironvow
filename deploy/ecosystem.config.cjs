/**
 * PM2 process definitions for the Hostinger VPS.
 *
 * Start with: pm2 start deploy/ecosystem.config.cjs --env production
 *
 * The API is clustered; the worker is not. Repeatable BullMQ jobs are
 * registered by whichever process holds them, and running several copies would
 * schedule the same maintenance job more than once.
 */
module.exports = {
  apps: [
    {
      name: 'ironvow-api',
      cwd: './apps/api',
      script: 'dist/server.js',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '400M',
      env_production: { NODE_ENV: 'production', PORT: 4000 },
    },
    {
      name: 'ironvow-worker',
      cwd: './apps/api',
      script: 'dist/worker.js',
      instances: 1,
      max_memory_restart: '300M',
      env_production: { NODE_ENV: 'production' },
    },
    {
      name: 'ironvow-web',
      cwd: './apps/web',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      instances: 1,
      max_memory_restart: '500M',
      env_production: { NODE_ENV: 'production' },
    },
  ],
};
