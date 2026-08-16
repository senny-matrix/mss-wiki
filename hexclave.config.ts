import type { HexclaveConfig } from "@hexclave/next";

export const config: HexclaveConfig = {
  apps: {
    installed: {
      authentication: {
        enabled: true,
      },
      emails: {
        enabled: true,
      },
    },
  },
  auth: {
    password: {
      allowSignIn: true,
    },
    otp: {
      allowSignIn: false,
    },
    passkey: {
      allowSignIn: false,
    },
    oauth: {
      accountMergeStrategy: "link_method",
      providers: {
        google: {
          type: "google",
          allowSignIn: true,
          allowConnectedAccounts: true,
        },
      },
    },
  },
  emails: {
    selectedThemeId: "1df07ae6-abf3-4a40-83a5-a1a2cbe336ac",
  },
};
