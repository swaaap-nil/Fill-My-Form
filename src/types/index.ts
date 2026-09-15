export const NodeEnv = {
  DEVELOPMENT: "development",
  PRODUCTION: "production",
} as const;

export const AppEnv = {
  DEVELOPMENT: "development",
  TEST: "test",
  PRODUCTION: "production",
} as const;

export type NodeEnv = (typeof NodeEnv)[keyof typeof NodeEnv];
export type AppEnv = (typeof AppEnv)[keyof typeof AppEnv];
