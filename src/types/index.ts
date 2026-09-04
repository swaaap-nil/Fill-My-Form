export const Theme = {
  LIGHT: "light",
  DARK: "dark",
  SYSTEM: "system",
} as const;

export const NodeEnv = {
  DEVELOPMENT: "development",
  PRODUCTION: "production",
} as const;

export const AppEnv = {
  DEVELOPMENT: "development",
  TEST: "test",
  PRODUCTION: "production",
} as const;

export type Theme = (typeof Theme)[keyof typeof Theme];
export type NodeEnv = (typeof NodeEnv)[keyof typeof NodeEnv];
export type AppEnv = (typeof AppEnv)[keyof typeof AppEnv];
