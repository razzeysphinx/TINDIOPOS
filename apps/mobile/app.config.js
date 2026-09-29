module.exports = ({
  config,
}) => {
  const isProduction =
    process.env.EAS_BUILD_PROFILE
    === "production";

  const plugins = [
    ...(config.plugins ?? []),
  ];

  if (isProduction) {
    plugins.push([
      "expo-build-properties",
      {
        android: {
          usesCleartextTraffic: false,
        },
      },
    ]);
  }

  return {
    ...config,
    plugins,
  };
};