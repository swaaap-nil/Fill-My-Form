import { spawnSync } from 'node:child_process';
const production = process.argv.includes('--production');
const baseEnv = {
  ...process.env,
  SITE_ENV: production ? 'production' : 'preview',
  ASTRO_TELEMETRY_DISABLED: '1',
};
const steps = [
  { command: 'npm', args: ['run', 'build'], env: baseEnv },
  {
    command: 'npx',
    args: production
      ? ['wrangler', 'deploy', '--env', 'production']
      : ['wrangler', 'deploy'],
    env: production ? { ...baseEnv, CLOUDFLARE_ENV: 'production' } : baseEnv,
  },
];
// Building validates all required public launch inputs before any upload.
for (const { command, args, env } of steps) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
