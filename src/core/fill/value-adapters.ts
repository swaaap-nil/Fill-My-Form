import { FieldKind, type FormField } from "../form/types";
import type { MemoryValue } from "../memory/types";
import { normaliseLabel } from "../ontology";

export interface ProfessionalExperienceEntry {
  readonly [key: string]: MemoryValue | undefined;
  readonly organization?: string;
  readonly role?: string;
  readonly description?: string;
  readonly startDate?: string;
  readonly endDate?: string | null;
  readonly isCurrent?: boolean;
}

interface SocialProfileService {
  readonly key: string;
  readonly baseUrl: string;
  readonly pathPrefix?: string;
  usernameFromUrl(url: URL): string | undefined;
}

const segment = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const decoded = decodeURIComponent(value).trim();
  return decoded || undefined;
};

const firstPathSegment = (url: URL): string | undefined =>
  segment(url.pathname.split("/").filter(Boolean)[0]);

const prefixedPathSegment =
  (prefix: string) =>
  (url: URL): string | undefined => {
    const parts = url.pathname.split("/").filter(Boolean);
    const index = parts.findIndex((part) => normaliseLabel(part) === prefix);
    return segment(index >= 0 ? parts[index + 1] : undefined);
  };

const SOCIAL_SERVICES: readonly SocialProfileService[] = [
  {
    key: "contact.leetcode_url",
    baseUrl: "https://leetcode.com/u/",
    usernameFromUrl: (url) =>
      prefixedPathSegment("u")(url) ?? firstPathSegment(url),
  },
  {
    key: "contact.geeksforgeeks_url",
    baseUrl: "https://www.geeksforgeeks.org/user/",
    usernameFromUrl: (url) =>
      prefixedPathSegment("user")(url) ??
      prefixedPathSegment("auth")(url) ??
      firstPathSegment(url),
  },
  {
    key: "contact.codeforces_url",
    baseUrl: "https://codeforces.com/profile/",
    usernameFromUrl: prefixedPathSegment("profile"),
  },
  {
    key: "contact.codechef_url",
    baseUrl: "https://www.codechef.com/users/",
    usernameFromUrl: prefixedPathSegment("users"),
  },
  {
    key: "contact.github_url",
    baseUrl: "https://github.com/",
    usernameFromUrl: firstPathSegment,
  },
  {
    key: "contact.stackoverflow_url",
    baseUrl: "https://stackoverflow.com/users/",
    usernameFromUrl: prefixedPathSegment("users"),
  },
];

const serviceForConcept = (key: string): SocialProfileService | undefined =>
  SOCIAL_SERVICES.find((service) => service.key === key);

export const isSocialProfileConcept = (key: string): boolean =>
  serviceForConcept(key) !== undefined;

const parseLooseUrl = (input: string): URL | undefined => {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed);
  } catch {
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
      try {
        return new URL(`https://${trimmed}`);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
};

const cleanUsername = (input: string): string | undefined => {
  const trimmed = input.trim().replace(/^@+/, "");
  if (!trimmed) return undefined;
  const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
  const parts = withoutQuery.split("/").filter(Boolean);
  return segment(parts[parts.length - 1] ?? withoutQuery);
};

export const canonicalizeSocialProfile = (
  conceptKey: string,
  value: string,
): string => {
  const service = serviceForConcept(conceptKey);
  if (!service) return value;

  const parsed = parseLooseUrl(value);
  const username = parsed
    ? service.usernameFromUrl(parsed)
    : cleanUsername(value);
  return username ? `${service.baseUrl}${encodeURIComponent(username)}` : value;
};

export const socialUsernameFromProfile = (
  conceptKey: string,
  value: string,
): string | undefined => {
  const service = serviceForConcept(conceptKey);
  if (!service) return undefined;

  const canonical = canonicalizeSocialProfile(conceptKey, value);
  const parsed = parseLooseUrl(canonical);
  return parsed ? service.usernameFromUrl(parsed) : cleanUsername(canonical);
};

const USERNAME_HINTS = new Set([
  "username",
  "user name",
  "handle",
  "profile id",
  "profile identifier",
  "user id",
  "userid",
  "coding id",
]);

export const fieldWantsSocialUsername = (field: FormField): boolean => {
  const text = normaliseLabel(
    [
      field.label,
      field.name,
      field.placeholder,
      field.description,
      ...(field.nearbyText ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
  return Array.from(USERNAME_HINTS).some((hint) => text.includes(hint));
};

export const adaptSocialProfileForField = (
  conceptKey: string,
  value: string,
  field: FormField,
): { readonly value: string; readonly canonicalValue: string } => {
  const canonicalValue = canonicalizeSocialProfile(conceptKey, value);
  if (fieldWantsSocialUsername(field) && field.kind !== FieldKind.URL) {
    return {
      value: socialUsernameFromProfile(conceptKey, canonicalValue) ?? value,
      canonicalValue,
    };
  }
  return { value: canonicalValue, canonicalValue };
};

export const canonicalizeMemoryValue = (
  key: string,
  value: MemoryValue,
): MemoryValue =>
  typeof value === "string" && isSocialProfileConcept(key)
    ? canonicalizeSocialProfile(key, value)
    : value;

export const calculateAge = (dateOfBirth: string, nowIso: string): string => {
  const dob = new Date(`${dateOfBirth}T00:00:00.000Z`);
  const now = new Date(nowIso);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(now.getTime())) return "";

  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const birthdayThisYear = Date.UTC(
    now.getUTCFullYear(),
    dob.getUTCMonth(),
    dob.getUTCDate(),
  );
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  if (today < birthdayThisYear) age -= 1;
  return age >= 0 && Number.isFinite(age) ? String(age) : "";
};

export const isProfessionalExperienceList = (
  value: unknown,
): value is readonly ProfessionalExperienceEntry[] =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      ("organization" in entry ||
        "role" in entry ||
        "description" in entry ||
        "startDate" in entry ||
        "endDate" in entry ||
        "isCurrent" in entry),
  );

const preferCurrent = (
  entries: readonly ProfessionalExperienceEntry[],
): ProfessionalExperienceEntry | undefined =>
  entries.find((entry) => entry.isCurrent || !entry.endDate) ?? entries[0];

const preferPrevious = (
  entries: readonly ProfessionalExperienceEntry[],
): ProfessionalExperienceEntry | undefined =>
  entries.find((entry) => entry.endDate && !entry.isCurrent) ??
  entries.find((entry) => !entry.isCurrent) ??
  entries[0];

export const valueFromProfessionalExperience = (
  conceptKey: string,
  value: MemoryValue,
): string | undefined => {
  if (!isProfessionalExperienceList(value)) return undefined;
  const current = preferCurrent(value);
  const previous = preferPrevious(value);

  switch (conceptKey) {
    case "employment.current.company":
      return current?.organization;
    case "employment.current.title":
      return current?.role;
    case "employment.current.start_year":
      return current?.startDate?.slice(0, 4);
    case "employment.history.company":
      return previous?.organization;
    case "employment.history.title":
      return previous?.role;
    case "employment.history.start_date":
      return previous?.startDate;
    case "employment.history.end_date":
      return previous?.endDate ?? undefined;
    case "employment.history.description":
      return previous?.description ?? current?.description;
    case "experience.professional.roles":
      return value
        .map((entry) =>
          [
            entry.role,
            entry.organization,
            entry.startDate || entry.endDate
              ? `(${[entry.startDate, entry.endDate ?? "Present"].filter(Boolean).join(" - ")})`
              : undefined,
            entry.description,
          ]
            .filter(Boolean)
            .join(" "),
        )
        .filter(Boolean)
        .join("\n");
    default:
      return undefined;
  }
};
