import { describe, expect, it } from "bun:test";
import {
  adaptSocialProfileForField,
  calculateAge,
  canonicalizeSocialProfile,
  socialUsernameFromProfile,
  valueFromProfessionalExperience,
} from "~/core/fill/value-adapters";
import { FieldKind, type FormField } from "~/core/form/types";

const field = (overrides: Partial<FormField>): FormField => ({
  id: "f1",
  kind: FieldKind.TEXT,
  required: false,
  hasValue: false,
  constraints: [],
  disabled: false,
  readOnly: false,
  ...overrides,
});

describe("social profile value adapters", () => {
  it("canonicalizes usernames for known coding profile services", () => {
    expect(canonicalizeSocialProfile("contact.leetcode_url", "swapnil")).toBe(
      "https://leetcode.com/u/swapnil",
    );
    expect(
      canonicalizeSocialProfile("contact.geeksforgeeks_url", "swapnil"),
    ).toBe("https://www.geeksforgeeks.org/user/swapnil");
    expect(canonicalizeSocialProfile("contact.codeforces_url", "tourist")).toBe(
      "https://codeforces.com/profile/tourist",
    );
    expect(canonicalizeSocialProfile("contact.codechef_url", "chef")).toBe(
      "https://www.codechef.com/users/chef",
    );
    expect(canonicalizeSocialProfile("contact.github_url", "@octocat")).toBe(
      "https://github.com/octocat",
    );
    expect(
      canonicalizeSocialProfile("contact.stackoverflow_url", "12345/swapnil"),
    ).toBe("https://stackoverflow.com/users/swapnil");
  });

  it("extracts usernames from full links", () => {
    expect(
      socialUsernameFromProfile(
        "contact.codeforces_url",
        "https://codeforces.com/profile/tourist",
      ),
    ).toBe("tourist");
    expect(
      socialUsernameFromProfile(
        "contact.github_url",
        "https://github.com/octocat?tab=repositories",
      ),
    ).toBe("octocat");
  });

  it("fills username-like fields with the username and URL fields with the full link", () => {
    const username = adaptSocialProfileForField(
      "contact.github_url",
      "https://github.com/octocat",
      field({ label: "GitHub username" }),
    );
    expect(username.value).toBe("octocat");
    expect(username.canonicalValue).toBe("https://github.com/octocat");

    const url = adaptSocialProfileForField(
      "contact.github_url",
      "octocat",
      field({ label: "GitHub profile URL", kind: FieldKind.URL }),
    );
    expect(url.value).toBe("https://github.com/octocat");
  });
});

describe("derived values", () => {
  it("calculates age from DOB with birthday boundary handling", () => {
    expect(calculateAge("2000-10-07", "2026-10-07T00:00:00.000Z")).toBe("26");
    expect(calculateAge("2000-10-08", "2026-10-07T00:00:00.000Z")).toBe("25");
  });

  it("selects values from the professional experience list", () => {
    const entries = [
      {
        organization: "Open Source Org",
        role: "Maintainer",
        description: "Maintained core packages",
        startDate: "2024-01-01",
        endDate: null,
        isCurrent: true,
      },
      {
        organization: "Earlier Co",
        role: "Intern",
        description: "Built internal tools",
        startDate: "2023-01-01",
        endDate: "2023-06-01",
        isCurrent: false,
      },
    ];

    expect(
      valueFromProfessionalExperience("employment.current.company", entries),
    ).toBe("Open Source Org");
    expect(
      valueFromProfessionalExperience(
        "employment.history.description",
        entries,
      ),
    ).toBe("Built internal tools");
  });
});
