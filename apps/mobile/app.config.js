/* eslint-disable @typescript-eslint/no-require-imports -- Expo loads dynamic app configuration through CommonJS. */
const productionRelease = require("./production-release.json");
const {
  assertProductionReleaseInputs,
} = require("./release-inputs");

module.exports = ({
  config,
}) => {
  const allowsDevelopmentCleartext =
    process.env.EAS_BUILD_PROFILE
    === "development";

  const plugins = [
    ...(config.plugins ?? []),
    [
      "expo-build-properties",
      {
        android: {
          usesCleartextTraffic:
            allowsDevelopmentCleartext,
        },
      },
    ],
  ];

  const productionIdentity =
    process.env.EAS_BUILD_PROFILE === "production"
      ? assertProductionReleaseInputs(
        productionRelease,
        process.env,
      )
      : null;

  return {
    ...config,
    ...(productionIdentity ? {
      owner: productionIdentity.owner,
      extra: {
        ...(config.extra ?? {}),
        eas: {
          ...(config.extra?.eas ?? {}),
          projectId: productionIdentity.projectId,
        },
      },
    } : {}),
    plugins,
  };
};
