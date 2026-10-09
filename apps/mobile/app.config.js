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

  return {
    ...config,
    plugins,
  };
};
